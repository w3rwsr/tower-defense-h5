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
TOWER_SS = 6                                   # 超采样（提升清晰度）
TOWER_BASE = 48.0                              # 显示基准高度（× config.art.scale）
TOWER_SCALE = {1: 0.88, 2: 1.0, 3: 1.12}       # 等级差异明显但不过大
COMP_KEEP = 0.0025                             # 连通域保留阈值
# 各等级炮口相对贴图中心的角度（度，数学坐标系：0=右，90=下，180=左，-90=上）。
# 由原图目测定标：lv1 炮口左上、lv2 炮口右下、lv3 炮口左。
# 旋转 -BARREL_ANGLE 度（PIL 逆时针为正）使炮口统一朝右。
BARREL_ANGLE = {1: 138.0, 2: 52.0, 3: 176.0}

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


def find_nozzle(rgba):
    """检测水枪炮口（炮管末端深色开口）的像素坐标。
    策略：
      1. 找到离质心最远的不透明点 → 炮管末端方向（炮管是最长的突出物）。
      2. 找到所有深色圆形连通域（炮口开口、水箱球体都是深色圆）。
      3. 选离"最远点"最近的深色圆 → 炮口开口（水箱球体在主体上，离末端远）。
    """
    from collections import deque
    alpha = rgba[..., 3]
    opaque = alpha * 255 >= ALPHA_CUT
    if not opaque.any():
        return rgba.shape[1] // 2, rgba.shape[0] // 2
    ys, xs = np.where(opaque)
    com = np.array([xs.mean(), ys.mean()])
    pts = np.column_stack([xs, ys]).astype(float)
    d = np.linalg.norm(pts - com, axis=1)
    tip_idx = np.argmax(d)
    tip = pts[tip_idx]   # 炮管末端轮廓点

    # 找深色圆形连通域
    rgb = rgba[..., :3].mean(axis=2)
    dark_mask = opaque & (rgb < 0.4)
    comps = []
    if dark_mask.any():
        h, w = dark_mask.shape
        seen = np.zeros_like(dark_mask)
        for sy, sx in zip(*np.where(dark_mask)):
            if seen[sy, sx]:
                continue
            q = deque([(sy, sx)]); seen[sy, sx] = True
            cpts = []
            while q:
                y, x = q.popleft(); cpts.append((y, x))
                for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
                    ny, nx = y+dy, x+dx
                    if 0<=ny<h and 0<=nx<w and dark_mask[ny,nx] and not seen[ny,nx]:
                        seen[ny,nx]=True; q.append((ny,nx))
            if len(cpts) < 15:
                continue
            cys = [p[0] for p in cpts]; cxs = [p[1] for p in cpts]
            cy, cx = sum(cys)/len(cys), sum(cxs)/len(cpts)
            bw = max(cxs)-min(cxs)+1; bh = max(cys)-min(cys)+1
            circ = len(cpts) / (bw*bh)
            comps.append((cx, cy, len(cpts), circ))
    if comps:
        # 炮口开口位于细长炮管的末端：选深色圆中【其方向上最靠近轮廓边界】的。
        # 对每个深色圆，计算从质心到它的方向上的最远不透明点距离；
        # 若深色圆距该边界 < 30% 半径，则它在末端（炮口）。
        ys_arr, xs_arr = np.where(opaque)
        pts_all = np.column_stack([xs_arr, ys_arr]).astype(float)
        tip_candidates = []
        for cx, cy, area, circ in comps:
            dx, dy = cx - com[0], cy - com[1]
            dlen = math.hypot(dx, dy)
            if dlen < 1:
                continue
            ux, uy = dx / dlen, dy / dlen
            # 该方向上最远的不透明点
            proj = pts_all[:, 0] * ux + pts_all[:, 1] * uy
            max_proj = proj.max()
            my_proj = cx * ux + cy * uy
            if (max_proj - my_proj) < max_proj * 0.35:  # 距边界 < 35% 半径
                tip_candidates.append((cx, cy, dlen))
        if tip_candidates:
            best = max(tip_candidates, key=lambda c: c[2])
            return (best[0], best[1])
        # 回退：选最远的深色圆
        best = max(comps, key=lambda c: math.hypot(c[0]-com[0], c[1]-com[1]))
        return (best[0], best[1])
    # 无深色圆：直接用末端点作为炮口
    return (float(tip[0]), float(tip[1]))


def rotate_to_barrel_right(rgba, nozzle):
    """将贴图旋转，使炮口指向正右方（角度 0）。
    返回旋转后的 RGBA 数组与新的喷嘴坐标。
    旋转方式：以贴图中心为轴，将 喷嘴→中心 方向转到 朝左（即炮口朝右）。"""
    h, w = rgba.shape[:2]
    cx, cy = w / 2.0, h / 2.0
    nx, ny = nozzle
    ang = math.atan2(ny - cy, nx - cx)        # 喷嘴相对中心的角度
    # 要让喷嘴朝右（角度 0），需把整个贴图旋转 -ang
    deg = -math.degrees(ang)
    img = Image.fromarray((np.round(rgba * 255)).astype(np.uint8), 'RGBA')
    rot = img.rotate(deg, resample=Image.BICUBIC, expand=True)
    ra = np.asarray(rot).astype(np.float32) / 255.0
    # 计算旋转后喷嘴的新坐标
    # 旋转矩阵（PIL rotate 逆时针为正，角度 deg）：
    rad = math.radians(deg)
    cos_a, sin_a = math.cos(rad), math.sin(rad)
    # PIL rotate 以图像中心为轴；expand=True 后画布中心偏移
    nw, nh = rot.size
    # 旧中心相对旧画布左上角 (cx, cy)，新画布中心 (nw/2, nh/2)
    # 点 P 旋转后：P' = center + R*(P - center)，其中 R 为逆时针旋转矩阵
    rx = cx + (nx - cx) * cos_a - (ny - cy) * sin_a
    ry = cy + (nx - cx) * sin_a + (ny - cy) * cos_a
    # expand=True 时画布扩展，新画布左上角相对旧画布的偏移
    # PIL expand 模式下，旋转后的图像被平移到新画布左上角
    # 偏移量 = (nw/2 - cx, nh/2 - cy) 大致，但需用包围盒精确计算
    # 更稳妥：直接在旋转后的图上重新检测喷嘴
    new_nozzle = find_nozzle(ra)
    return ra, new_nozzle


def save_tower_normalized(rgba, nozzle, lv, out_png):
    """塔：裁 alpha 包围盒 → 按显示高度×SS 归一化（保长宽比）。
    返回 (size, muzzle_dist)，其中 muzzle_dist 为炮口到贴图中心的水平距离
    （像素，归一化后的纹素坐标），供游戏内计算旋转后的枪口世界坐标。"""
    x0, y0, x1, y1 = alpha_bbox(rgba[..., 3])
    crop = rgba[y0:y1, x0:x1, :]
    target_h = int(round(TOWER_BASE * TOWER_SCALE[lv] * TOWER_SS))
    s = target_h / crop.shape[0]
    nw = max(1, int(round(crop.shape[1] * s)))
    img = Image.fromarray((np.round(crop * 255)).astype(np.uint8), 'RGBA')
    img = img.resize((nw, target_h), Image.LANCZOS)
    # 轻微 alpha 羽化仅 0.4px（去锯齿但不糊边），之前 0.8px 过强导致发虚
    img.putalpha(img.getchannel('A').filter(ImageFilter.GaussianBlur(0.4)))
    img.save(out_png, optimize=True)
    # 归一化后喷嘴坐标
    ncx = (nozzle[0] - x0) * s
    ncy = (nozzle[1] - y0) * s
    # 炮口到贴图中心的水平距离（炮口已朝右，故 y 偏差忽略，取水平分量）
    muzzle_dist = ncx - nw / 2.0
    return (nw, target_h), muzzle_dist


def find_nozzle_right(rgba):
    """炮口已朝右后，检测右侧炮口深色开口的 x 坐标（返回 (nx, ny)）。
    在右半部分找离右边缘最近的深色圆形连通域。"""
    from collections import deque
    rgb = rgba[..., :3].mean(axis=2)
    alpha = rgba[..., 3]
    mask = (alpha * 255 >= ALPHA_CUT) & (rgb < 0.4)
    h, w = rgba.shape[:2]
    if not mask.any():
        # 回退：右半部分最右的不透明点
        ys, xs = np.where(alpha * 255 >= ALPHA_CUT)
        right = xs >= w / 2
        if right.any():
            idx = np.argmax(xs[right])
            return float(xs[right][idx]), float(ys[right][idx])
        return w / 2, h / 2
    seen = np.zeros_like(mask)
    comps = []
    for sy, sx in zip(*np.where(mask)):
        if seen[sy, sx]:
            continue
        q = deque([(sy, sx)]); seen[sy, sx] = True
        cpts = []
        while q:
            y, x = q.popleft(); cpts.append((y, x))
            for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
                ny, nx = y+dy, x+dx
                if 0<=ny<h and 0<=nx<w and mask[ny,nx] and not seen[ny,nx]:
                    seen[ny,nx]=True; q.append((ny,nx))
        if len(cpts) < 10:
            continue
        cys = [p[0] for p in cpts]; cxs = [p[1] for p in cpts]
        cy, cx = sum(cys)/len(cys), sum(cxs)/len(cpts)
        comps.append((cx, cy, len(cpts)))
    if comps:
        # 选 x 最大的深色圆（最靠右 = 炮口）
        best = max(comps, key=lambda c: c[0])
        return (best[0], best[1])
    ys, xs = np.where(alpha * 255 >= ALPHA_CUT)
    idx = np.argmax(xs)
    return float(xs[idx]), float(ys[idx])


def rotate_by_angle(rgba, deg):
    """按指定角度旋转（PIL 逆时针为正），expand=True 保留全部内容。"""
    img = Image.fromarray((np.round(rgba * 255)).astype(np.uint8), 'RGBA')
    rot = img.rotate(deg, resample=Image.BICUBIC, expand=True)
    return np.asarray(rot).astype(np.float32) / 255.0


def build_towers():
    frame = np.asarray(Image.open(TOWER_SRC).convert('RGB'))
    h, w = frame.shape[:2]
    print('水塔源图 %dx%d' % (w, h))
    arts = {}
    muzzles = {}
    for lv in (1, 2, 3):
        bx0, bx1 = TOWER_XRANGES[lv]
        pad = 16
        c = frame[:, max(0, bx0 - pad):min(w, bx1 + pad), :]
        rgba = white_key(c)
        rgba[..., 3] = components_keep(rgba[..., 3])
        # 按定标角度旋转，使炮口统一朝右（PIL 逆时针为正，故取负角）
        rgba = rotate_by_angle(rgba, -BARREL_ANGLE[lv])
        rgba[..., 3] = components_keep(rgba[..., 3])   # 旋转后边缘重新清杂
        # 炮口已在右侧，检测右侧深色开口
        nozzle = find_nozzle_right(rgba)
        p = os.path.join(ASSETS, 'water_tower_lv%d.png' % lv)
        size, mdist = save_tower_normalized(rgba, nozzle, lv, p)
        with open(p, 'rb') as f:
            arts[lv] = base64.b64encode(f.read()).decode('ascii')
        muzzles[lv] = round(mdist, 2)
        print('  lv%d -> %s %dx%d  muzzle_dist=%.1fpx' %
              (lv, os.path.basename(p), size[0], size[1], mdist))
    write_tower_js('WaterTowerArtData.js', 'WATER_TOWER_ART', 'water_tower_lv', arts, muzzles,
                   '水元素塔美术贴图（白幕三连图裁切；炮口统一朝右；含炮口偏移 muzzleDist）')


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


def write_tower_js(fname, var, tex_prefix, arts, muzzles, desc):
    """水塔数据：{level: {data: dataURI, muzzleDist: 炮口到中心水平像素距离}}。"""
    lines = ["  %d: { data: 'data:image/png;base64,%s', muzzleDist: %s }" %
             (lv, b64, muzzles[lv]) for lv, b64 in arts.items()]
    hdr = ('/* ============================================================\n'
           ' * %s —— %s\n'
           ' * 由 build_water_assets.py 自动生成，请勿手改。\n'
           ' * 纹理键 %s1/2/3；炮口统一朝右；muzzleDist 为炮口到贴图中心的水平\n'
           ' * 纹素距离，游戏内乘以显示缩放后按旋转角换算枪口世界坐标。\n'
           ' * ============================================================ */\n') % (
        fname, desc, tex_prefix)
    p = os.path.join(JS, fname)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(hdr + 'const %s = {\n' % var + ',\n'.join(lines) + '\n};\n')
    print('%s written, %d bytes' % (fname, os.path.getsize(p)))


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
