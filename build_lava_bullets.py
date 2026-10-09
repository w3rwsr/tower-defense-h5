# -*- coding: utf-8 -*-
"""build_lava_bullets.py —— 熔岩弹三连图裁切/抠像/球体提取/归一化构建工具

输入：assets/lava_bullets.png（2176x1088，亮绿幕 (6,243,2)，三颗熔岩弹
      横排，球在左、拖尾火星朝右下）。
输出：
  assets/lava_bullet_lv1.png / lv2.png / lv3.png  —— 仅球体本体的透明 PNG
  js/LavaBulletData.js                            —— base64 data URI 模块
      （file:// 同源干净数据，BootScene 异步替换 proj_fire_lvN 纹理）

关键规则（经人工标注核对）：
  1. 只保留熔岩球本体：以球心为圆心、半径=球半径+3px 圆形蒙版提取，
     蒙版外 4px 羽化到透明——原图拖尾/火星/散落残留一律不进入贴图，
     拖尾特效改由游戏内粒子代码生成（Projectile.js）；
  2. 球心/球源直径人工标注：
       lv1 (323,526) D228；lv2 (895,528) D336；lv3 (1488,497) D392；
  3. 绿幕去除采用 un-premultiply 三通道反算（不只是压 g）：球体
     软边缘是橙焰与绿幕的半透明混合，简单压绿会留黄绿毛边；
  4. 三颗按球径等比归一化到 BALL_NATIVE（显示基准 15px × SS=3），
     游戏内 setScale(1/3) 再乘 config 的 1.00/1.05/1.10，三颗大小
     接近，等级差异只靠裂纹细节与代码拖尾强度。

运行：python build_lava_bullets.py
依赖：pip install pillow numpy
"""
import base64
import os

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(ROOT, 'assets')
JS = os.path.join(ROOT, 'js')
SRC = os.path.join(ASSETS, 'lava_bullets.png')

# 球心（原图坐标）、球源直径；⚠ 之前人工标注直径含拖尾根部（偏大），
# 实际球体半径≈中位扫描值：lv1≈113 lv2≈143 lv3≈171。
# 径向对扫发现 lv2/lv3 球心偏左（左半径比右小 30~45px），修正后：
#   lv2 球心 (895+15, 528+0)=(910,528)；lv3 球心 (1488+15, 497+8)=(1503,505)。
# 取 中位+4 作为球面硬截断半径（保留球面亮边缘），再用标注直径做归一化。
BALL = {
    1: ((323, 526), 228),
    2: ((910, 528), 336),
    3: ((1503, 505), 392),
}
REAL_R = {1: 117, 2: 140, 3: 170}  # 中位扫描值；lv2/lv3 减 7/5px 截掉边缘拖尾根
BALL_KEEP = 3        # 球半径外额外保留 px（抗锯齿边）
BALL_FEATHER = 4     # 圆形蒙版羽化宽度 px
SS = 3
BALL_DISPLAY = 15
BALL_NATIVE = BALL_DISPLAY * SS
# 色度键（源图 excess≈226；阈值远低于背景）
KEY_LOW = 25 / 255.0
KEY_HIGH = 95 / 255.0
BG_RGB = (6 / 255.0, 243 / 255.0, 2 / 255.0)   # 绿幕底色（un-premultiply 用）
ALPHA_CUT = 20
PAD = 2


def smoothstep(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def erode_mask(m):
    """4 邻域 1px 腐蚀（布尔蒙版），去掉轮廓最外圈半透明绿晕。"""
    keep = m.copy()
    keep[1:, :] &= m[:-1, :]
    keep[:-1, :] &= m[1:, :]
    keep[:, 1:] &= m[:, :-1]
    keep[:, :-1] &= m[:, 1:]
    return keep


def key_frame(frame):
    """整帧绿幕 -> RGBA。先按绿幕底色 un-premultiply 三通道反算，
    再强制 despill（火焰任意颜色 g<=r，g 超过 max(r,b) 的余量必为
    绿幕溢色），最后蒙版 1px 腐蚀+alpha 阈值清零，彻底去绿毛边。"""
    f = frame.astype(np.float32) / 255.0
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    ex = g - np.maximum(r, b)
    k = smoothstep((ex - KEY_LOW) / (KEY_HIGH - KEY_LOW))   # 1=纯背景
    inv = 1.0 / (1.0 - k + 1e-6)
    r2 = np.clip((r - k * BG_RGB[0]) * inv, 0, 1)
    g2 = np.clip((g - k * BG_RGB[1]) * inv, 0, 1)
    b2 = np.clip((b - k * BG_RGB[2]) * inv, 0, 1)
    # 强制 despill：火焰橙/黄/红的 g 均不大于 r，超出部分压掉
    g2 = np.minimum(g2, np.maximum(r2, b2) + 4 / 255.0)
    a0 = 1.0 - k
    mask = erode_mask(a0 * 255 >= ALPHA_CUT)
    a = np.where(mask, a0, 0.0)
    return np.stack([r2, g2, b2, a], axis=-1)


def _dilate4(m):
    d = m.copy()
    d[1:, :] |= m[:-1, :]
    d[:-1, :] |= m[1:, :]
    d[:, 1:] |= m[:, :-1]
    d[:, :-1] |= m[:, 1:]
    return d


def _flood(seed, allowed):
    """从 seed 出发在 allowed 集合内做 4 邻域连通域扩张（numpy 迭代膨胀）。"""
    m = np.zeros(allowed.shape, dtype=bool)
    m[seed] = True
    return _flood_mask(m, allowed)


def _flood_mask(seeds, allowed):
    """多种子版本：seeds 为布尔蒙版。"""
    m = seeds & allowed
    while True:
        n = _dilate4(m) & allowed
        if (n & ~m).sum() == 0:
            return m
        m = n | m


def build_one(lv, keyed):
    (bcx, bcy), ball_d = BALL[lv]
    Rcut = REAL_R[lv]                    # 球面硬截断半径（真实球体）
    Rnom = ball_d / 2.0                  # 标注半径（用于归一化）
    # 以球心为中心取 1.4×Rcut 方形子区
    half = int(Rcut * 1.4) + 2
    x0 = max(0, int(bcx) - half)
    y0 = max(0, int(bcy) - half)
    x1 = min(keyed.shape[1], int(bcx) + half + 1)
    y1 = min(keyed.shape[0], int(bcy) + half + 1)
    sub = keyed[y0:y1, x0:x1, :].copy()
    cx, cy = int(round(bcx - x0)), int(round(bcy - y0))

    # 球体=暗红/暗橙（g<0.55r，r 适中）；拖尾/火星=亮橙黄（g/r 高）。
    # 从球心 flood fill 暗色连通域得球面粗区域。
    r8 = (sub[..., 0] * 255)
    g8 = (sub[..., 1] * 255)
    ballish = (sub[..., 3] > 0) & (r8 > 50) & (g8 < 0.55 * r8)
    if not ballish[cy, cx]:
        yy, xx = np.where(ballish)
        i = np.argmin((xx - cx) ** 2 + (yy - cy) ** 2)
        cx, cy = int(xx[i]), int(yy[i])
    mask = _flood((cy, cx), ballish)
    # 填洞：从子区边缘 flood fill 非球面区域，取反即球面内部（含裂纹洞）
    outside = np.zeros(mask.shape, dtype=bool)
    outside[0, :] = True; outside[-1, :] = True
    outside[:, 0] = True; outside[:, -1] = True
    outside = _flood_mask(outside, ~mask)
    mask = mask | (~outside)

    # 圆形硬性截断：拖尾根部侵入球面半径以内，因此直接用真实球径 R，
    # 不加余量——球面边缘的球体色在 R 内，亮色拖尾在 R 外被截断。
    yy, xx = np.mgrid[0:sub.shape[0], 0:sub.shape[1]]
    dist = np.hypot(xx - cx, yy - cy)
    circle = dist < Rcut

    # 亮拖尾根剔除：拖尾根是亮橙色、与球外拖尾连通；球面裂纹是亮橙但
    # 被暗色球面四面包围、不与外部连通。种子=球外所有亮像素（dist>Rcut+8），
    # 从拖尾反向 flood 进球内，侵蚀掉伸进球径内的拖尾根。
    brightish = (g8 >= 0.48 * r8) | (g8 > 85)
    bseed = brightish & (dist > Rcut + 8)
    border_bright = _flood_mask(bseed, brightish)

    # 圆形硬截断 + 亮拖尾根擦除 + 外缘羽化
    final = mask & circle & ~border_bright
    soft = np.clip((Rcut - dist) / 3.0, 0.0, 1.0)
    sub[..., 3] = np.where(final, sub[..., 3] * soft, 0.0)

    # 按真实球径归一化：2*Rcut -> BALL_NATIVE，球心置于纹理中心
    s = BALL_NATIVE / (2 * Rcut)
    nw = max(1, int(round(sub.shape[1] * s)))
    nh = max(1, int(round(sub.shape[0] * s)))
    img = Image.fromarray((np.round(sub * 255)).astype(np.uint8), 'RGBA')
    img = img.resize((nw, nh), Image.LANCZOS)
    # alpha 轻微模糊羽化边缘
    a = img.getchannel('A').filter(ImageFilter.GaussianBlur(1.0))
    img.putalpha(a)
    fcx, fcy = cx * s, cy * s
    out_half = int(max(fcx, nw - fcx, fcy, nh - fcy)) + PAD
    out = Image.new('RGBA', (out_half * 2, out_half * 2), (0, 0, 0, 0))
    out.paste(img, (int(round(out_half - fcx)), int(round(out_half - fcy))), img)

    p = os.path.join(ASSETS, 'lava_bullet_lv%d.png' % lv)
    out.save(p, optimize=True)
    print('lv%d -> %s %dx%d 球心=(%d,%d) 归一化scale=%.4f'
          % (lv, os.path.basename(p), out.width, out.height, out_half, out_half, s))
    return p


def main():
    frame = np.asarray(Image.open(SRC).convert('RGB'))
    print('源图 %s %dx%d，逐像素抠像…' % (os.path.basename(SRC), frame.shape[1], frame.shape[0]))
    keyed = key_frame(frame)
    lines = []
    for lv in (1, 2, 3):
        p = build_one(lv, keyed)
        with open(p, 'rb') as f:
            b64 = base64.b64encode(f.read()).decode('ascii')
        lines.append("  %d: 'data:image/png;base64,%s'" % (lv, b64))
    hdr = ('/* ============================================================\n'
           ' * LavaBulletData.js —— 熔岩弹弹幕贴图（仅球体本体，无拖尾）\n'
           ' * 由 build_lava_bullets.py 自动生成，请勿手改。\n'
           ' * 源：assets/lava_bullets.png；纹理键 proj_fire_lv1/2/3；球心居中；\n'
           ' * 拖尾特效由游戏内粒子代码生成（Projectile.js），不烘焙进贴图。\n'
           ' * file:// 下 data URI 为同源干净数据，可直接上传 WebGL。\n'
           ' * ============================================================ */\n')
    p = os.path.join(JS, 'LavaBulletData.js')
    with open(p, 'w', encoding='utf-8') as f:
        f.write(hdr + 'const LAVA_BULLET_DATA = {\n' + ',\n'.join(lines) + '\n};\n')
    print('%s written, %d bytes' % (os.path.basename(p), os.path.getsize(p)))


if __name__ == '__main__':
    main()
