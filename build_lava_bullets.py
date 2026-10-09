# -*- coding: utf-8 -*-
"""build_lava_bullets.py —— 熔岩弹三连图裁切/抠像/旋转校正/归一化构建工具

输入：assets/lava_bullets.png（2176x1088，亮绿幕 (6,243,2)，三颗熔岩弹
      横排，球在左、拖尾火星朝右下）。
输出：
  assets/lava_bullet_lv1.png / lv2.png / lv3.png  —— 抠像旋转后透明 PNG
  js/LavaBulletData.js                            —— base64 data URI 模块
      （file:// 同源干净数据，BootScene 异步替换 proj_fire_lvN 纹理）

关键规则（经人工标注核对）：
  1. 按每颗【实际内容包围盒】裁切，非三等分（三等分会把 lv3 球边
     切进 lv2）：列投影区间 lv1 x209..477、lv2 x728..1158、
     lv3 x1307..1961；
  2. 球心/球源直径人工标注：
       lv1 (323,526) D228；lv2 (895,528) D336；lv3 (1488,497) D392；
  3. 素材拖尾主轴斜向下（实测 +38.5°/+36.3°/+31.7°），烘焙时绕
     【球心】反向旋转，使拖尾严格朝 +x——运行时 rotation=atan2
     朝向目标，球心即旋转轴心；
  4. 绿幕去除采用 un-premultiply 三通道反算（不只是压 g）：拖尾
     软边缘是橙焰与绿幕的半透明混合，简单压绿会留黄绿毛边；
  5. 三颗按球径等比归一化到 BALL_NATIVE（显示基准 15px × SS=3），
     游戏内 setScale(1/3) 再乘 config 的 1.00/1.05/1.10，三颗大小
     接近，差异只靠裂纹/拖尾/火星。

运行：python build_lava_bullets.py
依赖：pip install pillow numpy
"""
import base64
import math
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(ROOT, 'assets')
JS = os.path.join(ROOT, 'js')
SRC = os.path.join(ASSETS, 'lava_bullets.png')

# 裁切内容区（内容 bbox 外扩 6px）
CUT = {
    1: (203, 405, 483, 651),
    2: (722, 352, 1164, 715),
    3: (1301, 288, 1967, 816),
}
# 球心（原图坐标）、球源直径、拖尾主轴角（度，正=水平向下）
BALL = {
    1: ((323, 526), 228, 38.5),
    2: ((895, 528), 336, 36.3),
    3: ((1488, 497), 392, 31.7),
}
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


def build_one(lv, keyed):
    x0, y0, x1, y1 = CUT[lv]
    (bcx0, bcy0), ball_d, axis_deg = BALL[lv]
    sub = keyed[y0:y1, x0:x1, :]
    sh, sw = sub.shape[:2]
    bcx, bcy = bcx0 - x0, bcy0 - y0

    # 放进以球心为中心的方形画布（容得下旋转后的内容）
    half = int(math.ceil(max(bcx, sw - bcx, bcy, sh - bcy) * 1.45)) + 4
    S = half * 2
    canvas = np.zeros((S, S, 4), dtype=np.float32)
    canvas[half - bcy:half - bcy + sh, half - bcx:half - bcx + sw, :] = sub
    img = Image.fromarray((np.round(canvas * 255)).astype(np.uint8), 'RGBA')
    # 绕画布中心（=球心）反向旋转，拖尾校正为 +x
    img = img.rotate(axis_deg, resample=Image.BICUBIC, center=(half, half))

    # 裁到 alpha bbox，记录球心新位置
    arr = np.asarray(img)
    ys, xs = np.where(arr[..., 3] > 0)
    ax0, ay0, ax1, ay1 = xs.min(), ys.min(), xs.max(), ys.max()
    img = img.crop((ax0, ay0, ax1 + 1, ay1 + 1))
    nbcx, nbcy = half - ax0, half - ay0

    # 按球径归一化
    s = BALL_NATIVE / ball_d
    nw, nh = max(1, int(round(img.width * s))), max(1, int(round(img.height * s)))
    img = img.resize((nw, nh), Image.LANCZOS)
    fbcx, fbcy = nbcx * s, nbcy * s
    out_half = int(math.ceil(max(fbcx, nw - fbcx, fbcy, nh - fbcy))) + PAD
    out = Image.new('RGBA', (out_half * 2, out_half * 2), (0, 0, 0, 0))
    out.paste(img, (int(round(out_half - fbcx)), int(round(out_half - fbcy))), img)

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
           ' * LavaBulletData.js —— 熔岩弹弹幕贴图（离线裁切+绿幕抠像+旋转校正）\n'
           ' * 由 build_lava_bullets.py 自动生成，请勿手改。\n'
           ' * 源：assets/lava_bullets.png；纹理键 proj_fire_lv1/2/3；球心居中。\n'
           ' * file:// 下 data URI 为同源干净数据，可直接上传 WebGL。\n'
           ' * ============================================================ */\n')
    p = os.path.join(JS, 'LavaBulletData.js')
    with open(p, 'w', encoding='utf-8') as f:
        f.write(hdr + 'const LAVA_BULLET_DATA = {\n' + ',\n'.join(lines) + '\n};\n')
    print('%s written, %d bytes' % (os.path.basename(p), os.path.getsize(p)))


if __name__ == '__main__':
    main()
