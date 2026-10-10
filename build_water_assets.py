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
TOWER_SS = 3                                   # 超采样 = 显示尺寸整数倍率（3x，显示高 40/47/54 → 纹素 120/141/162，恰为 1/3 整数分缩放）
TOWER_DISPLAY_H = {1: 40, 2: 47, 3: 54}        # 显示高度 px（与 config.towers.towerC.art.displayHeight 同步；一级<二级<三级）
COMP_KEEP = 0.0025                             # 连通域保留阈值
# 炮口外圈（炮管端面）半径 ≈ 内部深色开口半径的倍数（三款实测 1.55~1.7）
RING_RATIO = 1.6
# 炮口端面前方再多保留的源图像素；超过此前沿平面的像素（水花水流）一律裁掉
FRONT_CLIP = 0

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


def _components(mask, min_pts=1):
    """4-邻接连通域标记，返回 [(ys 数组, xs 数组), ...]，按面积降序。"""
    from collections import deque
    h, w = mask.shape
    seen = np.zeros_like(mask)
    out = []
    ys0, xs0 = np.where(mask)
    for sy, sx in zip(ys0.tolist(), xs0.tolist()):
        if seen[sy, sx]:
            continue
        q = deque([(sy, sx)])
        seen[sy, sx] = True
        pys, pxs = [], []
        while q:
            y, x = q.popleft()
            pys.append(y); pxs.append(x)
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        if len(pys) >= min_pts:
            out.append((np.array(pys), np.array(pxs)))
    out.sort(key=lambda c: len(c[0]), reverse=True)
    return out


def detect_bore(rgba, side):
    """检测炮口【深色开口】：暗（rgb 均值<0.5）、近圆/椭圆（填充率≥0.35、
    bbox 宽高比 0.45~2）、面积达标（≥总不透明像素 0.12%）的连通域。
    源图三款水枪的炮口全部朝左 → side='left' 取最左候选（已用调试图确认：
    其余深色圆为护圈内拨轮/握把铆钉，均在炮口右侧）；旋转后 side='right'
    取最右候选。返回 (cx, cy, r)，r 为开口半径（bbox 四分之一边长均值）；
    检测不到返回 None。"""
    alpha = rgba[..., 3]
    opaque = alpha * 255 >= ALPHA_CUT
    total = int(opaque.sum())
    mask = opaque & (rgba[..., :3].mean(axis=2) < 0.5)
    cands = []
    for pys, pxs in _components(mask):
        n = len(pys)
        if n < max(12, int(total * 0.0012)):
            continue
        x0, x1, y0, y1 = int(pxs.min()), int(pxs.max()), int(pys.min()), int(pys.max())
        bw, bh = x1 - x0 + 1, y1 - y0 + 1
        ar = bw / max(bh, 1)
        if ar < 0.45 or ar > 2.0:
            continue
        if n / float(bw * bh) < 0.35:
            continue
        cands.append((pxs.mean(), pys.mean(), (bw + bh) * 0.25, n))
    if not cands:
        return None
    cands.sort(key=lambda c: c[0], reverse=(side == 'right'))
    cx, cy, r, _ = cands[0]
    return float(cx), float(cy), float(r)


def erase_front_splash(rgba, bore):
    """几何清除炮口环【外侧】的水花（应对水流与炮口环相连、无法按连通域
    分离的情况，如三级）。炮口朝右，仅处理开口中心前 1.0r 到环前沿区域：
      · 保留：炮口环椭圆面（长短轴均 1.6r）+ 环后方 1.7r 高的炮管条带；
      · 椭圆外（环上/下方及 2~5 点钟方向贴边的飞溅水滴）一律透明；
      · 炮口环前沿（1.6r+FRONT_CLIP）以右整列硬裁。
    环后 2r 内用炮管条带保护套筒（条带半高 1.55r，套筒最粗约 1.35r）；
    扳机护圈等枪身部件在 2r 以外，不受影响；对一/二级无副作用。"""
    alpha = rgba[..., 3]
    H, W = alpha.shape
    yy, xx = np.mgrid[0:H, 0:W]
    cx, cy, r = bore
    rr = RING_RATIO * r
    x0 = cx - 2.0 * r
    x1 = cx + rr + FRONT_CLIP
    region = (xx >= x0) & (xx < x1)
    ring_face = (((xx - cx) / rr) ** 2 + ((yy - cy) / rr) ** 2) <= 1.0
    tube = (xx < cx - 0.9 * r) & (np.abs(yy - cy) <= 1.55 * r)
    alpha[region & ~(ring_face | tube)] = 0.0
    front_x = int(round(x1))
    if 0 < front_x < W:
        alpha[:, front_x:] = 0.0


def repair_nozzle_rim(rgba, bore):
    """修复与炮口环【重叠】的水花（如三级 3~5 点钟方向贴在白环沿上的
    水团，几何遮罩无法分离）。仅在确实检测到环外亮色水花时执行，一/二级
    无此类水花会原样返回：
      1) 在环口前侧小盒内，以椭圆环外的高亮像素（mean>0.65）为种子，
         4-邻接泛洪过高亮像素 → 水团掩膜（被炮口深色描边/暗带挡住，
         不会扩散到枪身；白环沿虽亮但重绘结果仍是白色环沿）；
      2) 水团在椭圆外的部分透明，椭圆内的部分按炮口环径向结构重绘：
         深色开口 / 青色环身 / 白色环沿。"""
    from collections import deque
    H, W = rgba.shape[:2]
    cx, cy, r = bore
    rr = RING_RATIO * r
    xL, xR = int(cx + 1.25 * r), int(cx + rr + 0.6 * r)
    yL, yR = int(cy - 0.6 * r), int(cy + 0.6 * r)
    xL, xR = max(0, xL), min(W, xR)
    yL, yR = max(0, yL), min(H, yR)
    if xR <= xL or yR <= yL:
        return
    rgbm = rgba[..., :3].mean(axis=2)
    alpha = rgba[..., 3]
    op = alpha * 255 >= ALPHA_CUT
    yy, xx = np.mgrid[0:H, 0:W]
    ell = (((xx - cx) / rr) ** 2 + ((yy - cy) / rr) ** 2)
    seeds = op & (rgbm > 0.65) & (ell > 1.0)
    seeds[:yL, :] = False; seeds[yR:, :] = False
    seeds[:, :xL] = False; seeds[:, xR:] = False
    if not seeds.any():
        return
    blob = np.zeros_like(op)
    q = deque([(int(y), int(x)) for y, x in zip(*np.where(seeds))])
    for y, x in q:
        blob[y, x] = True
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if not (yL <= ny < yR and xL <= nx < xR) or blob[ny, nx] or not op[ny, nx]:
                continue
            if rgbm[ny, nx] > 0.65:
                blob[ny, nx] = True
                q.append((ny, nx))
    # 环外透明
    alpha[blob & (ell > 1.0)] = 0.0
    # 环口前侧盒内、1.55r~1.6r 贴边环带上的暗/中色残根（水花根部，
    # 亮度低于泛洪阈值）也清除；白色环沿很亮（>0.72）不会被误删
    rim_band = (ell > (1.55 / RING_RATIO) ** 2) & (ell <= 1.0) & (rgbm < 0.72)
    rim_band[:yL, :] = False; rim_band[yR:, :] = False
    rim_band[:, :xL] = False; rim_band[:, xR:] = False
    alpha[rim_band] = 0.0
    # 环内按径向环结构重绘（仅覆盖水团像素）
    inside = blob & (ell <= 1.0)
    rgba[inside & (ell <= 0.70 ** 2), 0:3] = (0.06, 0.18, 0.32)
    rgba[inside & (ell > 0.70 ** 2) & (ell <= 0.92 ** 2), 0:3] = (0.22, 0.62, 0.82)
    rgba[inside & (ell > 0.92 ** 2), 0:3] = (0.93, 0.99, 1.0)
    alpha[inside] = 1.0


def remove_splash(rgba, bore, where):
    """删除炮口处的水花（亮色水滴/水流，与枪体断开的小连通域）。
    where='pre' （源图，炮口朝左）：小分量质心位于炮口平面
       （x < 开口中心 + 0.3r）即视为前方水花删除；
    where='post'（炮口已朝右）：面积 < 主体 4% 且贴在炮口前半球
       （dx > -r，且距开口中心 3.2r × 2.4r 范围内）的分量删除。
    面积 ≥ 主体 4% 的分量绝不删除（保护水箱/把手等大部件）。"""
    alpha = rgba[..., 3]
    opaque = alpha * 255 >= ALPHA_CUT
    comps = _components(opaque)
    if not comps:
        return
    main_n = len(comps[0][0])
    bcx, bcy, br = bore
    for pys, pxs in comps[1:]:
        if len(pys) >= main_n * 0.04:
            continue
        cx, cy = float(pxs.mean()), float(pys.mean())
        if where == 'pre':
            kill = cx < bcx + br * 0.3
        else:
            kill = (cx - bcx > -br) and (abs(cx - bcx) < 3.2 * br) and (abs(cy - bcy) < 2.4 * br)
        if kill:
            alpha[pys, pxs] = 0.0


def save_tower_normalized(rgba, nozzle, lv, out_png):
    """塔：裁 alpha 包围盒 → 按显示高度×SS 归一化（保长宽比，仅一次 LANCZOS
    缩放，无二次缩放）。nozzle = 炮口端面中心点（旋转前画布坐标，炮口朝右）。
    返回 (size, (muzzleDx, muzzleDy))：炮口相对【贴图中心】的纹素偏移，
    供游戏内 getMuzzlePos 按旋转角换算枪口世界坐标。"""
    x0, y0, x1, y1 = alpha_bbox(rgba[..., 3])
    crop = rgba[y0:y1, x0:x1, :]
    target_h = TOWER_DISPLAY_H[lv] * TOWER_SS
    s = target_h / crop.shape[0]
    nw = max(1, int(round(crop.shape[1] * s)))
    img = Image.fromarray((np.round(crop * 255)).astype(np.uint8), 'RGBA')
    img = img.resize((nw, target_h), Image.LANCZOS)
    # 轻微 alpha 羽化仅 0.4px（去锯齿但不糊边），之前 0.8px 过强导致发虚
    img.putalpha(img.getchannel('A').filter(ImageFilter.GaussianBlur(0.4)))
    img.save(out_png, optimize=True)
    # 归一化后炮口相对贴图中心的双轴偏移（纹素坐标）
    ncx = (nozzle[0] - x0) * s
    ncy = (nozzle[1] - y0) * s
    muzzle_dx = ncx - nw / 2.0
    muzzle_dy = ncy - target_h / 2.0
    return (nw, target_h), (muzzle_dx, muzzle_dy)


def rotate_by_angle(rgba, deg):
    """按指定角度旋转（PIL 逆时针为正），expand=True 保留全部内容。"""
    img = Image.fromarray((np.round(rgba * 255)).astype(np.uint8), 'RGBA')
    rot = img.rotate(deg, resample=Image.BICUBIC, expand=True)
    return np.asarray(rot).astype(np.float32) / 255.0


def _tube_tilt(ra):
    """炮口朝右后，检测炮口并最小二乘拟合其后方炮管中线的倾角。
    取炮口环后 1.2r~4.2r 的水平条带，逐列取不透明像素中点拟合直线。
    返回 (倾角度数, 炮口(cx,cy,r), 有效列数)；无法判定返回 None。"""
    H, W = ra.shape[:2]
    bore = detect_bore(ra, 'right')
    if not bore or bore[0] < W * 0.55:
        return None
    cx, cy, r = bore
    op = ra[..., 3] * 255 >= ALPHA_CUT
    xs, mids = [], []
    xlo, xhi = int(cx - 4.2 * r), int(cx - 1.2 * r)
    for x in range(max(0, xlo), min(W, xhi)):
        col = np.where(op[:, x])[0]
        col = col[(col > cy - 2.3 * r) & (col < cy + 2.3 * r)]
        if len(col) >= r * 0.6:
            xs.append(x)
            mids.append((float(col.min()) + float(col.max())) * 0.5)
    need = max(6, int((xhi - xlo) * 0.5))
    if len(xs) < need:
        return None
    A = np.vstack([np.asarray(xs), np.ones(len(xs))]).T
    slope = float(np.linalg.lstsq(A, np.asarray(mids), rcond=None)[0][0])
    return math.degrees(math.atan(slope)), bore, len(xs)


def _far_centroid(rgba, bore):
    """距炮口 > 2.5r 的不透明像素质心（枪身/水箱/握把总质量），
    作为炮轴的粗估后方参考点。"""
    op = rgba[..., 3] * 255 >= ALPHA_CUT
    ys, xs = np.where(op)
    d = np.hypot(xs - bore[0], ys - bore[1])
    sel = d > bore[2] * 2.5
    if sel.sum() < 100:
        return xs.mean(), ys.mean()
    return float(xs[sel].mean()), float(ys[sel].mean())


def align_barrel(rgba, bore0):
    """自动旋转使炮管水平朝右。
    1) 粗估炮轴角 = 炮口→远身质心方向（PIL 旋转符号两种假设都纳入搜索）；
    2) 在 ±14° 网格内试转，用炮管中线拟合倾角 |tilt| 择优；
    3) ±2° 细搜（0.5° 步进）。
    最终只按总角度旋转【一次】，避免二次 BICUBIC 软化。
    返回 (总角度, 旋转后 RGBA, 炮口)。"""
    fx, fy = _far_centroid(rgba, bore0)
    axis = math.degrees(math.atan2(bore0[1] - fy, bore0[0] - fx))

    def evaluate(total):
        ra = rotate_by_angle(rgba, total)
        met = _tube_tilt(ra)
        return ra, met

    best = None  # (|tilt|, total, ra, bore, cols)
    for hyp in (axis, -axis):
        for d in range(-12, 13, 4):
            ra, met = evaluate(hyp + d)
            if met and (best is None or abs(met[0]) < abs(best[0])):
                best = (met[0], hyp + d, ra, met[1], met[2])
    if best is None:
        ra = rotate_by_angle(rgba, 180.0)
        bore = detect_bore(ra, 'right') or (ra.shape[1] / 2, ra.shape[0] / 2, 10)
        return 180.0, ra, bore
    coarse = best[1]
    for d10 in range(-40, 41, 5):
        total = coarse + d10 / 10.0
        ra, met = evaluate(total)
        if met and abs(met[0]) < abs(best[0]):
            best = (met[0], total, ra, met[1], met[2])
    return best[1], best[2], best[3]


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
        # 1) 源图炮口全部朝左：检测深色开口，先删枪口前方水花，再自动炮轴对齐
        bore0 = detect_bore(rgba, 'left')
        if bore0 is None:
            print('  lv%d 警告：未检测到炮口开口，保持原朝向' % lv)
            deg = 0.0
            rgba = rotate_by_angle(rgba, deg)
            bore = detect_bore(rgba, 'right')
        else:
            remove_splash(rgba, bore0, 'pre')
            # 2) 远身质心粗估 + 炮管中线拟合网格寻优，单次旋转，炮口精确朝右
            deg, rgba, bore = align_barrel(rgba, bore0)
        rgba[..., 3] = components_keep(rgba[..., 3])   # 旋转后边缘重新清杂
        # 3) 清残余水花：先删断开的小水滴分量，再几何清除环外侧飞溅
        #    （三级水流与环相连，分量法分离不了）+ 硬裁炮口端面外水流
        if bore is not None:
            remove_splash(rgba, bore, 'post')
            # 先修复与环沿重叠的水花（需借环外亮色像素做种子，必须在几何清除前）
            repair_nozzle_rim(rgba, bore)
            erase_front_splash(rgba, bore)
            # 炮口发射点 = 外圈端面中心（非开口内部），出弹恰在管口
            nozzle = (bore[0] + RING_RATIO * bore[2], bore[1])
        else:
            ys, xs = np.where(rgba[..., 3] * 255 >= ALPHA_CUT)
            nozzle = (float(xs.max()), float(ys[np.argmax(xs)]))
        p = os.path.join(ASSETS, 'water_tower_lv%d.png' % lv)
        size, (mdx, mdy) = save_tower_normalized(rgba, nozzle, lv, p)
        with open(p, 'rb') as f:
            arts[lv] = base64.b64encode(f.read()).decode('ascii')
        muzzles[lv] = (round(mdx, 2), round(mdy, 2))
        print('  lv%d -> %s %dx%d  muzzle=(%.1f, %.1f)px  rot=%.1f' %
              (lv, os.path.basename(p), size[0], size[1], mdx, mdy, deg))
    write_tower_js('WaterTowerArtData.js', 'WATER_TOWER_ART', 'water_tower_lv', arts, muzzles,
                   '水元素塔美术贴图（白幕三连图裁切；炮口自动检测并统一朝右；水花已剔除；muzzleX/Y 为炮口端面相对贴图中心的纹素偏移）')


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
    """水塔数据：{level: {data, muzzleX, muzzleY}}（炮口端面相对贴图中心纹素偏移）。"""
    lines = ["  %d: { data: 'data:image/png;base64,%s', muzzleX: %s, muzzleY: %s }" %
             (lv, b64, muzzles[lv][0], muzzles[lv][1]) for lv, b64 in arts.items()]
    hdr = ('/* ============================================================\n'
           ' * %s —— %s\n'
           ' * 由 build_water_assets.py 自动生成，请勿手改。\n'
           ' * 纹理键 %s1/2/3；炮口统一朝右；muzzleX/muzzleY 为炮口端面相对\n'
           ' * 贴图中心的纹素偏移，游戏内乘显示缩放后按旋转角换算枪口世界坐标。\n'
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
