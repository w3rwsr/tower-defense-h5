# -*- coding: utf-8 -*-
"""build_water_assets.py —— 水元素塔三连图裁切·抠像 + 水弹贴图离线生成

输入（assets/，横排 左→右 = 1/2/3 级）：
  water_towers.png 2816x1584 近白幕：三款水枪塔（一级小巧 / 二级中等 / 三级大型）。

输出：
  assets/water_tower_lv1/2/3.png  透明 PNG（按高度归一化，保留长宽比）
  assets/water_bullet_lv1/2/3.png 透明 PNG（程序生成：水珠/水柱/水球本体）
  js/WaterTowerArtData.js  window.WATER_TOWER_ART = {1,2,3: dataURI}
  js/WaterBulletData.js    window.WATER_BULLET_DATA = {1,2,3: dataURI}

水弹只含本体（无拖尾/水雾），拖尾由游戏内粒子代码生成（Projectile.js）。
运行：python build_water_assets.py
依赖：pip install pillow numpy
"""
import base64
import math
import os

import numpy as np
from PIL import Image, ImageFilter, ImageDraw

ROOT = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(ROOT, 'assets')
JS = os.path.join(ROOT, 'js')

# ---------------- 水塔：实测元素 x 段（按列投影分离，y 取整图高，抠图后裁 alpha 包围盒） ----------------
TOWER_SRC = os.path.join(ASSETS, 'water_towers.png')
TOWER_XRANGES = {
    1: (0, 747),
    2: (872, 1665),
    3: (1685, 2796),
}
TOWER_SS = 4                                   # 超采样
TOWER_BASE = 48.0                              # 显示基准高度（× config.art.scale）
TOWER_SCALE = {1: 0.88, 2: 1.0, 3: 1.12}       # 等级差异明显但不过大
COMP_KEEP = 0.0025                             # 连通域保留阈值

# ---------------- 水弹：程序生成（无原始素材） ----------------
BULLET_SS = 3
BODY_DISPLAY = 18.0                            # 水弹显示直径基准 px
BULLET_SCALE = {1: 0.92, 2: 1.0, 3: 1.08}      # 三级大小接近，差异靠造型/拖尾

# ---------------- 共用：白幕色度键参数 ----------------
# d = 1 - min(r,g,b)：0=纯白背景，1=深色主体。
# WHITE_LOW/WHITE_HIGH 是 d 的羽化带：d<LOW 全背景(α=0)，d>HIGH 全主体(α=1)。
WHITE_LOW = 10 / 255.0
WHITE_HIGH = 60 / 255.0
FLOOD_MAX_D = 0.18              # 泛洪连通：仅 d 小于此值（近白）的像素才与四边连通
ALPHA_CUT = 12


def smoothstep(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _dilate4(m):
    d = m.copy()
    d[1:, :] |= m[:-1, :]
    d[:-1, :] |= m[1:, :]
    d[:, 1:] |= m[:, :-1]
    d[:, :-1] |= m[:, 1:]
    return d


def background_mask(d):
    """与画面四边连通的近白区（d < FLOOD_MAX_D）→ bool。
    用严格阈值泛洪，避免彩色主体被误并入背景。"""
    near_white = d < FLOOD_MAX_D
    if not near_white.any():
        return np.zeros_like(near_white, dtype=bool)
    cur = np.zeros_like(near_white, dtype=bool)
    cur[0, :] = near_white[0, :]
    cur[-1, :] |= near_white[-1, :]
    cur[:, 0] |= near_white[:, 0]
    cur[:, -1] |= near_white[:, -1]
    prev = -1
    while cur.sum() != prev:
        prev = cur.sum()
        grown = _dilate4(cur) & near_white
        cur = grown
    return cur


def white_key(rgb):
    """RGB uint8 → RGBA float(0~1)：白幕键控 + un-premultiply + 连通区归零。
    d=1-min(r,g,b)：d 小=白背景→α=0；d 大=彩色主体→α=1。"""
    f = rgb.astype(np.float32) / 255.0
    m = f.min(axis=2)
    d = 1.0 - m
    alpha = smoothstep((d - WHITE_LOW) / (WHITE_HIGH - WHITE_LOW))
    k = 1.0 - alpha                    # k=背景占比，用于 un-premultiply
    inv = 1.0 / (alpha + 1e-6)
    r2 = np.clip((f[..., 0] - k) * inv, 0, 1)
    g2 = np.clip((f[..., 1] - k) * inv, 0, 1)
    b2 = np.clip((f[..., 2] - k) * inv, 0, 1)
    alpha[background_mask(d)] = 0.0
    return np.stack([r2, g2, b2, alpha], axis=-1)


def components_keep(alpha):
    """保留最大连通域及 ≥ COMP_KEEP 倍大小的分量（滤孤立杂点）。"""
    from collections import deque
    h, w = alpha.shape
    lab = alpha * 255 >= ALPHA_CUT
    seen = np.zeros_like(lab)
    keep = np.zeros_like(lab)
    comps = []
    ys, xs = np.where(lab)
    for sy, sx in zip(ys.tolist(), xs.tolist()):
        if seen[sy, sx]:
            continue
        q = deque([(sy, sx)])
        seen[sy, sx] = True
        pts = []
        while q:
            y, x = q.popleft()
            pts.append((y, x))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and lab[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        comps.append(pts)
    if not comps:
        return alpha
    comps.sort(key=len, reverse=True)
    thresh = len(comps[0]) * COMP_KEEP
    for pts in comps:
        if len(pts) < thresh:
            break
        for y, x in pts:
            keep[y, x] = True
    return np.where(keep, alpha, 0.0)


def alpha_bbox(a):
    ys, xs = np.where(a * 255 >= ALPHA_CUT)
    if len(ys) == 0:
        return 0, 0, a.shape[1], a.shape[0]
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def save_normalized_height(rgba, lv, out_png):
    """塔：按显示高度×SS 归一化（保长宽比），居中输出。"""
    x0, y0, x1, y1 = alpha_bbox(rgba[..., 3])
    crop = rgba[y0:y1, x0:x1, :]
    target_h = int(round(TOWER_BASE * TOWER_SCALE[lv] * TOWER_SS))
    s = target_h / crop.shape[0]
    nw = max(1, int(round(crop.shape[1] * s)))
    img = Image.fromarray((np.round(crop * 255)).astype(np.uint8), 'RGBA')
    img = img.resize((nw, target_h), Image.LANCZOS)
    img.putalpha(img.getchannel('A').filter(ImageFilter.GaussianBlur(0.8)))
    img.save(out_png, optimize=True)
    return img.size


def build_towers():
    frame = np.asarray(Image.open(TOWER_SRC).convert('RGB'))
    h, w = frame.shape[:2]
    print('水塔源图 %dx%d' % (w, h))
    arts = {}
    for lv in (1, 2, 3):
        bx0, bx1 = TOWER_XRANGES[lv]
        pad = 16
        c = frame[:, max(0, bx0 - pad):min(w, bx1 + pad), :]
        rgba = white_key(c)
        rgba[..., 3] = components_keep(rgba[..., 3])
        p = os.path.join(ASSETS, 'water_tower_lv%d.png' % lv)
        size = save_normalized_height(rgba, lv, p)
        with open(p, 'rb') as f:
            arts[lv] = base64.b64encode(f.read()).decode('ascii')
        print('  lv%d -> %s %dx%d' % (lv, os.path.basename(p), size[0], size[1]))
    write_js('WaterTowerArtData.js', 'WATER_TOWER_ART', 'water_tower_lv', arts,
             '水元素塔美术贴图（白幕三连图离线裁切，水枪塔本体）')


# ---------------- 水弹贴图：程序生成（水滴/水柱/水球本体，无拖尾） ----------------
def _radial_gradient(cx, cy, radius, inner_color, outer_color, size):
    """生成圆形径向渐变（float 0~1 RGBA）。"""
    h, w = size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dist = np.hypot(xx - cx, yy - cy)
    t = np.clip(dist / radius, 0, 1)
    t = t * t * (3 - 2 * t)            # smoothstep
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    for ch in range(3):
        rgba[..., ch] = inner_color[ch] * (1 - t) + outer_color[ch] * t
    rgba[..., 3] = 1.0 - t              # 边缘渐隐
    return rgba


def _draw_droplet(cx, cy, rx, ry, inner, outer, size):
    """绘制水滴形（上尖下圆）本体 + 高光。返回 float RGBA 数组。"""
    h, w = size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # 水滴形状：下半圆 + 上尖，用参数化距离函数
    dx = (xx - cx) / rx
    dy = (yy - cy) / ry
    # 尖顶在上方，用 (1 - dy) 控制上半部分收窄
    tip = np.clip((-dy + 0.4) / 1.4, 0, 1)        # dy<-0.4 时开始收尖
    shape_x = dx / (1.0 - 0.55 * tip)
    shape = shape_x * shape_x + dy * dy
    t = np.clip(shape, 0, 1)
    t = t * t * (3 - 2 * t)
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    for ch in range(3):
        rgba[..., ch] = inner[ch] * (1 - t * 0.7) + outer[ch] * (t * 0.7)
    rgba[..., 3] = (1.0 - t) ** 1.3
    # 高光：左上小亮点
    hl_cx, hl_cy = cx - rx * 0.3, cy - ry * 0.35
    hl_d = np.hypot(xx - hl_cx, yy - hl_cy)
    hl = np.clip(1.0 - hl_d / (rx * 0.35), 0, 1) ** 2
    for ch in range(3):
        rgba[..., ch] = np.minimum(rgba[..., ch] + hl * 0.6, 1.0)
    rgba[..., 3] = np.maximum(rgba[..., 3], hl * 0.9)
    return rgba


def _draw_column(cx, cy, rx, ry, inner, outer, size):
    """绘制水柱弹（横向椭球 + 两端收窄）本体 + 高光。"""
    h, w = size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = (xx - cx) / rx
    dy = (yy - cy) / ry
    # 横向拉长椭球，两端略尖
    shape = dx * dx * 1.05 + dy * dy * 1.3
    t = np.clip(shape, 0, 1)
    t = t * t * (3 - 2 * t)
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    for ch in range(3):
        rgba[..., ch] = inner[ch] * (1 - t * 0.65) + outer[ch] * (t * 0.65)
    rgba[..., 3] = (1.0 - t) ** 1.4
    # 高光：沿轴向的亮带
    hl = np.exp(-((dy) ** 2) * 6.0) * np.clip(1.0 - abs(dx) * 0.8, 0, 1)
    for ch in range(3):
        rgba[..., ch] = np.minimum(rgba[..., ch] + hl * 0.5, 1.0)
    # 左侧尖端小高光
    hl2 = np.clip(1.0 - np.hypot(xx - (cx - rx * 0.7), yy - cy) / (rx * 0.25), 0, 1) ** 2
    for ch in range(3):
        rgba[..., ch] = np.minimum(rgba[..., ch] + hl2 * 0.7, 1.0)
    rgba[..., 3] = np.maximum(rgba[..., 3], hl2 * 0.85)
    return rgba


def _draw_ball(cx, cy, r, inner, outer, size):
    """绘制水球弹（正圆 + 周围小水花点）本体。"""
    h, w = size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dist = np.hypot(xx - cx, yy - cy)
    t = np.clip(dist / r, 0, 1)
    t = t * t * (3 - 2 * t)
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    for ch in range(3):
        rgba[..., ch] = inner[ch] * (1 - t * 0.6) + outer[ch] * (t * 0.6)
    rgba[..., 3] = (1.0 - t) ** 1.2
    # 高光：左上大高光 + 右下小反光
    hl1 = np.clip(1.0 - np.hypot(xx - cx - r * 0.3, yy - cy + r * 0.35) / (r * 0.4), 0, 1) ** 2
    for ch in range(3):
        rgba[..., ch] = np.minimum(rgba[..., ch] + hl1 * 0.7, 1.0)
    rgba[..., 3] = np.maximum(rgba[..., 3], hl1 * 0.9)
    hl2 = np.clip(1.0 - np.hypot(xx - cx + r * 0.35, yy - cy - r * 0.25) / (r * 0.2), 0, 1) ** 2
    for ch in range(3):
        rgba[..., ch] = np.minimum(rgba[..., ch] + hl2 * 0.4, 1.0)
    # 周围小水花点（仅本体附带的近体水点，不算拖尾）
    splash = [(0.85, -0.15, 0.12), (-0.7, -0.55, 0.1), (0.6, 0.6, 0.09), (-0.75, 0.4, 0.11)]
    for sx, sy, sr in splash:
        sd = np.hypot(xx - (cx + r * sx), yy - (cy + r * sy))
        sp = np.clip(1.0 - sd / (r * sr), 0, 1) ** 2
        for ch in range(3):
            rgba[..., ch] = np.minimum(rgba[..., ch] + sp * 0.6, 1.0)
        rgba[..., 3] = np.maximum(rgba[..., 3], sp * 0.8)
    return rgba


def build_bullets():
    """生成三级水弹贴图（程序绘制，居中，按直径归一化）。"""
    # 配色：水蓝 / 青色 / 白色高光（与水塔协调）
    INNER = (0xe8 / 255.0, 0xf7 / 255.0, 0xff / 255.0)   # 近白亮蓝
    OUTER = (0x2a / 255.0, 0x9e / 255.0, 0xd8 / 255.0)   # 深水蓝
    OUTER2 = (0x1e / 255.0, 0x7f / 255.0, 0xc4 / 255.0)  # 更深（lv3）
    arts = {}
    S = 96               # 绘制画布边长（超采样，后缩到 BODY_DISPLAY×SS）
    for lv in (1, 2, 3):
        cx = cy = S / 2
        if lv == 1:
            # 一级：小巧水珠弹（上尖下圆的水滴）
            rgba = _draw_droplet(cx, cy + 6, S * 0.28, S * 0.34, INNER, OUTER, (S, S))
        elif lv == 2:
            # 二级：中等水柱弹（横向椭球，两端略尖）
            rgba = _draw_column(cx, cy, S * 0.40, S * 0.26, INNER, OUTER, (S, S))
        else:
            # 三级：较大水球弹（正圆 + 近体水花点）
            rgba = _draw_ball(cx, cy, S * 0.34, INNER, OUTER2, (S, S))
        # 裁剪到 alpha 包围盒
        x0, y0, x1, y1 = alpha_bbox(rgba[..., 3])
        sub = rgba[y0:y1, x0:x1, :]
        # 归一化：最大边 → BODY_DISPLAY * SCALE * SS
        max_side = max(sub.shape[0], sub.shape[1])
        s = (BODY_DISPLAY * BULLET_SCALE[lv] * BULLET_SS) / max_side
        nw = max(1, int(round(sub.shape[1] * s)))
        nh = max(1, int(round(sub.shape[0] * s)))
        img = Image.fromarray((np.round(sub * 255)).astype(np.uint8), 'RGBA')
        img = img.resize((nw, nh), Image.LANCZOS)
        img.putalpha(img.getchannel('A').filter(ImageFilter.GaussianBlur(0.6)))
        # 居中到正方形输出
        half = max(nw, nh) // 2 + 2
        out = Image.new('RGBA', (half * 2, half * 2), (0, 0, 0, 0))
        out.paste(img, (half - nw // 2, half - nh // 2), img)
        p = os.path.join(ASSETS, 'water_bullet_lv%d.png' % lv)
        out.save(p, optimize=True)
        with open(p, 'rb') as f:
            arts[lv] = base64.b64encode(f.read()).decode('ascii')
        print('  lv%d -> %s %dx%d  scale=%.4f' %
              (lv, os.path.basename(p), out.width, out.height, s))
    write_js('WaterBulletData.js', 'WATER_BULLET_DATA', 'proj_water_lv', arts,
             '水弹贴图（仅水珠/水柱/水球本体；拖尾与水雾由代码粒子生成）')


def write_js(fname, var, tex_prefix, arts, desc):
    lines = ["  %d: 'data:image/png;base64,%s'" % (lv, b64) for lv, b64 in arts.items()]
    hdr = ('/* ============================================================\n'
           ' * %s —— %s\n'
           ' * 由 build_water_assets.py 自动生成，请勿手改。\n'
           ' * 纹理键 %s1/2/3；file:// 下 data URI 为同源干净数据，可上传 WebGL。\n'
           ' * ============================================================ */\n') % (
        fname, desc, tex_prefix)
    p = os.path.join(JS, fname)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(hdr + 'const %s = {\n' % var + ',\n'.join(lines) + '\n};\n')
    print('%s written, %d bytes' % (fname, os.path.getsize(p)))


if __name__ == '__main__':
    build_towers()
    build_bullets()
