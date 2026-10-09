# -*- coding: utf-8 -*-
"""build_fire_assets_data.py —— 火塔资产 data URI 数据模块构建脚本

背景：file:// 协议下 Chromium 把本地文件媒体/图片视为跨域数据，
WebGL texImage2D 与 2D 画布 getImageData 均抛 SecurityError：
  1. 火塔燃烧视频（assets/fire_burn_lvN.mp4）无法上传 WebGL 纹理；
  2. 火塔美术贴图（assets/fire_tower_lvN.png）运行时抠图失败。
解决：把两者内嵌为 base64 data URI（同源干净数据，全环境可上传 WebGL）。

本脚本做两件事（可重复运行，产物直接覆盖）：
  A. 用 PIL/numpy 离线复刻 BootScene.chromaKeyTexture 的抠图算法
     （绿幕 lv1/lv3、白幕 lv2；边缘去晕；alpha<40 清零；alpha 包围盒
     裁剪；12% 边距；高质量缩放到 168/192/224），输出
     assets/fire_tower_lvN_keyed.png；
  B. 生成 js/FireBurnData.js（视频 base64）与
     js/FireTowerArtData.js（抠图后贴图 base64 data URI）。

运行：python build_fire_assets_data.py
依赖：pip install pillow numpy
"""
import base64
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(ROOT, 'assets')
JS = os.path.join(ROOT, 'js')

LEVELS = [1, 2, 3]
BG = {1: 'green', 2: 'white', 3: 'green'}          # 与 BootScene 的 bgs 数组一致
OUT_SIZE = {1: 168, 2: 192, 3: 224}                 # 与 BootScene 的输出尺寸一致


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def chroma_key(raw_path, bg, out_size):
    """复刻 BootScene.chromaKeyTexture：抠图→去晕→bbox 裁剪→缩放。"""
    img = Image.open(raw_path).convert('RGBA')
    a = np.asarray(img).astype(np.float64)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]

    if bg == 'green':
        excess = g - np.maximum(r, b)
        key = np.clip(excess / 50.0, 0.0, 1.0)
    else:
        m = np.minimum(np.minimum(r, g), b)
        key = np.clip((m - 165.0) / 70.0, 0.0, 1.0)

    alpha = 255.0 * (1.0 - key)
    inv = 1.0 / (1.0 - key + 1e-12)

    # 边缘去晕：un-premultiply 反算去除背景色溢出（与 BootScene 一致）
    if bg == 'green':
        g2 = np.clip((g - 255.0 * key) * inv, 0, 255)
        a_out = np.stack([r, g2, b, alpha], axis=-1)
    else:
        r2 = np.clip((r - 255.0 * key) * inv, 0, 255)
        g2 = np.clip((g - 255.0 * key) * inv, 0, 255)
        b2 = np.clip((b - 255.0 * key) * inv, 0, 255)
        a_out = np.stack([r2, g2, b2, alpha], axis=-1)

    # 残边清除：过淡的半透明像素直接全透明（<40），防虚影
    alpha_u8 = np.round(a_out[..., 3]).astype(np.int32)
    a_out[..., 3] = np.where(alpha_u8 < 40, 0, alpha_u8)

    out = np.round(a_out).astype(np.uint8)
    pil = Image.fromarray(out, 'RGBA')

    # alpha>16 包围盒（与运行时一致：隔行隔列扫描，这里全扫差异可忽略）
    alpha_ch = np.asarray(pil)[..., 3]
    ys, xs = np.where(alpha_ch > 16)
    if len(xs) == 0:
        raise RuntimeError('抠图后全透明: ' + raw_path)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    cw, ch = x1 - x0 + 1, y1 - y0 + 1
    pil = pil.crop((x0, y0, x0 + cw, y0 + ch))

    side = int(np.ceil(max(cw, ch) * 1.12))       # 12% 边距（与运行时一致）
    O = out_size
    draw_w = int(round(O * (cw / side)))
    draw_h = int(round(O * (ch / side)))
    canvas = Image.new('RGBA', (O, O), (0, 0, 0, 0))
    resized = pil.resize((draw_w, draw_h), Image.LANCZOS)  # 高质量平滑
    canvas.paste(resized, ((O - draw_w) // 2, (O - draw_h) // 2))
    return canvas


def to_b64(path):
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('ascii')


def main():
    art_lines = []
    for lv in LEVELS:
        raw = os.path.join(ASSETS, 'fire_tower_lv%d.png' % lv)
        keyed = os.path.join(ASSETS, 'fire_tower_lv%d_keyed.png' % lv)
        canvas = chroma_key(raw, BG[lv], OUT_SIZE[lv])
        canvas.save(keyed, optimize=True)
        art_lines.append("  %d: 'data:image/png;base64,%s'" % (lv, to_b64(keyed)))
        print('lv%d keyed -> %s (%d bytes)' % (lv, os.path.basename(keyed), os.path.getsize(keyed)))

    vid_lines = []
    # 一级、三级使用用户重新制作的 _new 视频；二级保持原视频
    VID_FILE = {1: 'fire_burn_lv1_new.mp4', 2: 'fire_burn_lv2.mp4', 3: 'fire_burn_lv3_new.mp4'}
    for lv in LEVELS:
        vid = os.path.join(ASSETS, VID_FILE[lv])
        vid_lines.append("  %d: '%s'" % (lv, to_b64(vid)))
        print('lv%d video -> %s (%d bytes raw)' % (lv, os.path.basename(vid), os.path.getsize(vid)))

    hdr = ('/* ============================================================\n'
           ' * %s\n'
           ' * 由 build_fire_assets_data.py 自动生成，请勿手改。\n'
           ' * ============================================================ */\n')

    with open(os.path.join(JS, 'FireBurnData.js'), 'w', encoding='utf-8') as f:
        f.write(hdr % 'FireBurnData.js —— 火塔燃烧视频 base64 内嵌（黑底 H.264，ADD 混合用）\n'
                ' * 目的：file:// 下本地视频上传 WebGL 会因源不透明被拦截，data URI 通用。')
        f.write('\nconst FIRE_BURN_DATA = {\n' + ',\n'.join(vid_lines) + '\n};\n')

    with open(os.path.join(JS, 'FireTowerArtData.js'), 'w', encoding='utf-8') as f:
        f.write(hdr % 'FireTowerArtData.js —— 火塔美术贴图（离线抠图+透明）base64 data URI\n'
                ' * 目的：file:// 下本地图片无法上传 WebGL 且 getImageData 被禁，\n'
                ' * 离线抠图后内嵌，运行时无需 canvas 像素级处理。')
        f.write('\nconst FIRE_TOWER_ART = {\n' + ',\n'.join(art_lines) + '\n};\n')

    for name in ('FireBurnData.js', 'FireTowerArtData.js'):
        p = os.path.join(JS, name)
        print('%s written, %d bytes' % (name, os.path.getsize(p)))


if __name__ == '__main__':
    main()
