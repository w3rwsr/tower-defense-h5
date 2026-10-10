# -*- coding: utf-8 -*-
"""build_ice_assets.py —— 冰元素塔/冰弹三连图裁切·抠像·归一化构建工具

输入（assets/，横排 左→右 = 1/2/3 级）：
  ice_towers.png 3744x2496 亮绿幕 (43,235,64)：三簇冰晶（单柱/三柱/七柱）
  ice_bullets.png 2048x1152 白幕：三枚雪花弹，含【烘焙斜向拖尾】与
      底部【文字标签】——只保留雪花本体+近体光晕，拖尾/文字一律剔除，
      拖尾特效改由游戏内粒子代码生成（Projectile.js）。

输出：
  assets/ice_tower_lv1/2/3.png  透明 PNG（按高度归一化，保留长宽比）
  assets/ice_bullet_lv1/2/3.png 透明 PNG（雪花中心居中，按臂展归一化）
  js/IceTowerArtData.js  window.ICE_TOWER_ART = {1,2,3: dataURI}
  js/IceBulletData.js    window.ICE_BULLET_DATA = {1,2,3: dataURI}
  （file:// 同源干净数据，BootScene 异步注册 ice_tower_lvN / proj_ice_lvN）

运行：python build_ice_assets.py
依赖：pip install pillow numpy
"""
import base64
import os

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(ROOT, 'assets')
JS = os.path.join(ROOT, 'js')

# ---------------- 冰塔：实测元素包围盒（24px 外扩由脚本处理） ----------------
TOWER_SRC = os.path.join(ASSETS, 'ice_towers.png')
TOWER_BOXES = {
    1: (501, 1071, 832, 1878),
    2: (1367, 871, 2099, 1893),
    3: (2347, 324, 3527, 1943),
}
TOWER_SS = 4                                   # 超采样
TOWER_BASE = 48.0                              # 显示基准高度（× config.art.scale）
TOWER_SCALE = {1: 0.9, 2: 1.0, 3: 1.1}         # 与 config.towers.towerB.art.scale 一致
COMP_KEEP = 0.0025                             # 连通域保留阈值（滤 32px 孤立杂点）

# ---------------- 冰弹：实测雪花中心/臂展 R/底切 y（全局原图坐标） -------------
BULLET_SRC = os.path.join(ASSETS, 'ice_bullets.png')
BULLET_BOXES = {   # 宽松区域（含光晕与拖尾），遮罩负责剔除
    1: (180, 350, 560, 780),
    2: (700, 290, 1245, 905),
    3: (1240, 150, 1990, 905),
}
FLAKE = {   # (cx, cy), R=臂展（不含拖尾方向，用左/上方位测得）, ycut=文字条带顶
    1: ((349, 525), 135, 720),
    2: ((935, 526), 190, 850),
    3: ((1576, 501), 300, 865),
}
BULLET_SS = 3
BODY_DISPLAY = 18.0                            # 雪花臂展显示直径基准 px
BULLET_SCALE = {1: 1.0, 2: 1.05, 3: 1.1}      # 与 config iceBullet.scale 一致

# ---------------- 共用：色度键参数 ----------------
GREEN_LOW = 14 / 255.0     # 羽化带（略收缩，混色像素更快归零）
GREEN_HIGH = 40 / 255.0
GREEN_BG = (43 / 255.0, 235 / 255.0, 64 / 255.0)
GREEN_EX_FLOOD = 10 / 255.0     # flood-fill 生长条件（混色环并入背景连通区）
WHITE_LOW = 6 / 255.0           # 离白距离 d=255-min 的羽化带
WHITE_HIGH = 55 / 255.0
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


def background_mask(ex):
    """与画面四边连通的绿幕（含混色边缘）→ bool。"""
    green = ex > GREEN_EX_FLOOD
    if not green.any():
        return np.zeros_like(green)
    cur = np.zeros_like(green)
    cur[0, :] = green[0, :]
    cur[-1, :] |= green[-1, :]
    cur[:, 0] |= green[:, 0]
    cur[:, -1] |= green[:, -1]
    prev = -1
    while cur.sum() != prev:
        prev = cur.sum()
        grown = _dilate4(cur) & green
        cur = grown
    return cur


def green_key(rgb):
    """RGB uint8 → RGBA float(0~1)：un-premultiply 反算 + despill + 连通区归零。"""
    f = rgb.astype(np.float32) / 255.0
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    ex = g - np.maximum(r, b)
    k = smoothstep((ex - GREEN_LOW) / (GREEN_HIGH - GREEN_LOW))
    inv = 1.0 / (1.0 - k + 1e-6)
    r2 = np.clip((r - k * GREEN_BG[0]) * inv, 0, 1)
    g2 = np.clip((g - k * GREEN_BG[1]) * inv, 0, 1)
    b2 = np.clip((b - k * GREEN_BG[2]) * inv, 0, 1)
    g2 = np.minimum(g2, np.maximum(r2, b2) + 4 / 255.0)   # 强制 despill
    alpha = 1.0 - k
    alpha[background_mask(ex)] = 0.0
    return np.stack([r2, g2, b2, alpha], axis=-1)


def components_keep(alpha):
    """保留最大连通域及 ≥ COMP_KEEP 倍大小的分量（滤孤立杂点/小碎片）。"""
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
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def save_normalized_height(rgba, lv, out_png):
    """塔：按显示高度×SS 归一化（保长宽比），底部对齐到统一基线。"""
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
    print('冰塔源图 %dx%d' % (frame.shape[1], frame.shape[0]))
    arts = {}
    for lv in (1, 2, 3):
        bx0, by0, bx1, by1 = TOWER_BOXES[lv]
        pad = 24
        h, w = frame.shape[:2]
        c = frame[max(0, by0 - pad):min(h, by1 + pad),
                  max(0, bx0 - pad):min(w, bx1 + pad), :]
        rgba = green_key(c)
        rgba[..., 3] = components_keep(rgba[..., 3])
        p = os.path.join(ASSETS, 'ice_tower_lv%d.png' % lv)
        size = save_normalized_height(rgba, lv, p)
        with open(p, 'rb') as f:
            arts[lv] = base64.b64encode(f.read()).decode('ascii')
        print('  lv%d -> %s %dx%d' % (lv, os.path.basename(p), size[0], size[1]))
    write_js('IceTowerArtData.js', 'ICE_TOWER_ART', 'ice_tower_lv', arts,
             '冰元素塔美术贴图（绿幕三连图离线裁切，冰晶本体+底座雪雾）')


def hole_filled_alpha(d, box):
    """白幕上抠【白色本体】：雪花自身也是白色，单靠离白距离会把雪花
    抠成空心。策略——青色描边/暗部（d≥12）围成封闭屏障，从【裁切块
    四边】泛洪"近白背景"，淹不进去的封闭区（白色雪花本体）置前景。
    box=(x0,y0,x1,y1)，仅该矩形区域参与；返回二值前景（不含外光晕）。"""
    x0, y0, x1, y1 = box
    barrier = d >= 12 / 255.0
    allowed = ~barrier
    cur = np.zeros_like(barrier)
    cur[y0, x0:x1] = allowed[y0, x0:x1]
    cur[y1 - 1, x0:x1] |= allowed[y1 - 1, x0:x1]
    cur[y0:y1, x0] |= allowed[y0:y1, x0]
    cur[y0:y1, x1 - 1] |= allowed[y0:y1, x1 - 1]
    prev = -1
    while cur.sum() != prev:
        prev = cur.sum()
        cur = _dilate4(cur) & allowed
    fg = (~cur)
    fg[:y0, :] = False; fg[y1:, :] = False; fg[:, :x0] = False; fg[:, x1:] = False
    return fg.astype(np.float32)


def build_bullets():
    frame = np.asarray(Image.open(BULLET_SRC).convert('RGB')).astype(np.float32) / 255.0
    h, w = frame.shape[:2]
    r0, g0, b0 = frame[..., 0], frame[..., 1], frame[..., 2]
    print('冰弹源图 %dx%d' % (w, h))
    arts = {}
    yy0, xx0 = np.mgrid[0:h, 0:w]
    for lv in (1, 2, 3):
        (cx, cy), R, ycut = FLAKE[lv]
        bx0, by0, bx1, by1 = BULLET_BOXES[lv]
        block = np.zeros((h, w), dtype=np.float32)
        block[by0:by1, bx0:bx1] = 1.0

        # 1) 白幕键拆两层：
        #    a_soft —— 离白距离软 alpha：青色描边/暗部/外光晕，随光晕自然衰减
        #    a_fill —— 泛洪填洞二值：白色雪花本体（自身白色在白底上会被镂空），
        #              但泛洪会把"拖尾亮芯围成的封闭口袋"也填成实心，必须按半径收紧
        d = 1.0 - frame.min(axis=2)
        a_soft = smoothstep((d - 5 / 255.0) / (30 / 255.0))
        a_fill = hole_filled_alpha(d, (bx0, by0, bx1, by1))

        # 2) 底部文字条带整条归零（文字与远端拖尾均在此带）
        a_soft[ycut:, :] = 0.0
        a_fill[ycut:, :] = 0.0

        # 3) 分别按半径整形（六出雪花臂尖止于 r=R）：
        #    本体 r≤R 全保、R→1.12R 收掉填洞前沿锯齿/拖尾口袋；
        #    光晕保留自然外扩，1.05→1.35R 渐隐。
        dist = np.hypot(xx0 - cx, yy0 - cy)
        body = a_fill * (1.0 - smoothstep((dist - R) / (0.12 * R)))
        glow = a_soft * (1.0 - smoothstep((dist - 1.05 * R) / (0.30 * R)))
        alpha = np.maximum(body, glow) * block

        # 4) 斜向锥切：烘焙拖尾从雪花右下（+45°，0°/60°两臂空隙）伸出。
        #    ±35°锥内 0.95R→1.15R 归零：锥内残余的拖尾青白光（含亮芯口袋
        #    在软层里的部分）被切净；60°臂尖仅最外缘约 16% 羽化，18px 下不可见。
        vx = (xx0 - cx) / np.maximum(dist, 1e-6)
        vy = (yy0 - cy) / np.maximum(dist, 1e-6)
        in_cone = ((vx + vy) * 0.7071 > 0.819)    # 与 (1,1)/√2 夹角 <35°
        cone = np.where(in_cone,
                        1.0 - smoothstep((dist - 0.95 * R) / (0.20 * R)), 1.0)
        alpha *= cone
        # 边缘硬环防溢
        alpha[:2, :] = 0; alpha[-2:, :] = 0; alpha[:, :2] = 0; alpha[:, -2:] = 0

        # 颜色去边：白幕半透明像素做 un-premultiply（淡青边不发灰）
        k = 1.0 - alpha
        inv = 1.0 / (1.0 - k + 1e-6)
        rr = np.clip((r0 - k) * inv, 0, 1)
        gg = np.clip((g0 - k) * inv, 0, 1)
        bb = np.clip((b0 - k) * inv, 0, 1)

        x0, y0, x1, y1 = alpha_bbox(alpha)
        sub = np.stack([rr, gg, bb, alpha], axis=-1)[y0:y1, x0:x1, :]
        # 归一化：2R（雪花臂展）→ BODY_DISPLAY*SS，雪花中心居中
        s = (BODY_DISPLAY * BULLET_SCALE[lv] * BULLET_SS) / (2 * R)
        nw = max(1, int(round(sub.shape[1] * s)))
        nh = max(1, int(round(sub.shape[0] * s)))
        img = Image.fromarray((np.round(sub * 255)).astype(np.uint8), 'RGBA')
        img = img.resize((nw, nh), Image.LANCZOS)
        img.putalpha(img.getchannel('A').filter(ImageFilter.GaussianBlur(0.8)))
        fcx, fcy = (cx - x0) * s, (cy - y0) * s
        half = int(max(fcx, nw - fcx, fcy, nh - fcy)) + 2
        out = Image.new('RGBA', (half * 2, half * 2), (0, 0, 0, 0))
        out.paste(img, (int(round(half - fcx)), int(round(half - fcy))), img)
        p = os.path.join(ASSETS, 'ice_bullet_lv%d.png' % lv)
        out.save(p, optimize=True)
        with open(p, 'rb') as f:
            arts[lv] = base64.b64encode(f.read()).decode('ascii')
        print('  lv%d -> %s %dx%d  scale=%.4f' %
              (lv, os.path.basename(p), out.width, out.height, s))
    write_js('IceBulletData.js', 'ICE_BULLET_DATA', 'proj_ice_lv', arts,
             '冰弹贴图（仅雪花本体+近体光晕；烘焙拖尾与文字标签已剔除，拖尾由代码粒子生成）')


def write_js(fname, var, tex_prefix, arts, desc):
    lines = ["  %d: 'data:image/png;base64,%s'" % (lv, b64) for lv, b64 in arts.items()]
    hdr = ('/* ============================================================\n'
           ' * %s —— %s\n'
           ' * 由 build_ice_assets.py 自动生成，请勿手改。\n'
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
