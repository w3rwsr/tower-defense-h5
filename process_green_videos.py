# -*- coding: utf-8 -*-
"""process_green_videos.py —— 火塔绿幕视频【离线抠像转黑底】工具

为什么需要它：
  lv1/lv3 燃烧视频是亮绿幕 H.264（无 alpha）。实时 shader 色度键虽能在
  新代码里抠干净（实测背景 excess>=0.55、边缘 alpha=0），但依赖浏览器
  加载到最新 JS 与自定义 WebGL pipeline——file:// 顽固缓存混搭旧 ADD
  代码时，绿幕会被 ADD 叠成白/绿矩形框；个别 GPU 上自定义管线行为也
  可能差异。离线把绿幕逐帧物理抠成纯黑底后：
    1. 像素层面不存在任何绿/白背景，矩形框不可能出现；
    2. 与 lv2 完全同构（黑底 + FireVideo 亮度键 NORMAL，iOS 全兼容）；
    3. 即使极端环境回退 ADD 混合，黑底相加仍透明。
  （iOS Safari 不支持 VP9 alpha WebM，黑底 H.264 是本项目既定跨平台方案）

做什么：
  assets/fire_burn_lv1_new.mp4 / fire_burn_lv3_new.mp4（绿幕母带）
  → 逐帧 green-excess 色度键 + despill + smoothstep 羽化 + 黑底合成
  → 原地覆盖输出（处理前自动把绿幕母带备份到 _video_raw/）
  之后请运行 build_fire_assets_data.py 重新生成内嵌 data URI。

运行：python process_green_videos.py
依赖：pip install pillow numpy imageio-ffmpeg
"""
import os
import shutil
import subprocess
import tempfile

import numpy as np
from PIL import Image
import imageio_ffmpeg

ROOT = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(ROOT, 'assets')
RAW = os.path.join(ROOT, '_video_raw')

# 待处理：等级 -> (assets 内文件名, 母带备份名)
JOBS = {
    1: ('fire_burn_lv1_new.mp4', 'fire_lv1_green_raw_20261009.mp4'),
    3: ('fire_burn_lv3_new.mp4', 'fire_lv3_green_raw_20261009.mp4'),
}
FPS = 24                # 项目约定 24fps（源 24.15fps，98 帧差异 <1%）
CRF = '14'              # 高质量压环铃：残留归因实测 crf17 的 DCT 环铃是
                        # 黑底晕圈来源之一，降 CRF + 密集关键帧抑制块效应
GOP = '12'
# 色度键（与 FireVideoGK shader 的 0.10/0.42、spill 0.03 同源，255 量化）
KEY_LOW = 0.10 * 255    # flood-fill 生长条件（混色边缘并入背景连通区）
KEY_HIGH = 0.42 * 255   # flood-fill 种子阈值（可靠绿幕）
FEATHER_LOW = 0.14 * 255   # 连通区外羽化带略收缩：混色像素更快归零，
FEATHER_HIGH = 0.40 * 255  # 火焰本体（excess<=0）完全不受影响
SPILL = 0.03 * 255
EDGE_KEEP = 2           # 边缘 N 像素环强制纯黑（双保险，物理杜绝矩形边）


def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def background_mask(ex):
    """与画面四边连通的绿幕区（含混色边缘）-> bool mask。

    残留归因：母带 4:2:0 色度抽样在绿/火交界产生数百~上千个
    "半绿半火"混色像素/帧，旧全局羽化只给半透明 -> 预乘黑底后
    成为火焰外一圈暗色晕圈。连通性判定把绿幕本体与混色环一并
    归零（纯 numpy 迭代传播，无 scipy 依赖），火焰内部偏色不动。
    """
    green = ex > KEY_LOW
    if not green.any():
        return np.zeros_like(green)
    seed = np.zeros_like(green)
    seed[0, :] = green[0, :]
    seed[-1, :] |= green[-1, :]
    seed[:, 0] |= green[:, 0]
    seed[:, -1] |= green[:, -1]
    cur = seed
    prev = -1
    while cur.sum() != prev:
        prev = cur.sum()
        grown = cur.copy()
        grown[1:, :] |= cur[:-1, :]
        grown[:-1, :] |= cur[1:, :]
        grown[:, 1:] |= cur[:, :-1]
        grown[:, :-1] |= cur[:, 1:]
        cur = grown & green
    return cur


def key_frame(rgb):
    """一帧绿幕 RGB(uint8) -> 黑底合成 RGB(uint8)。"""
    f = rgb.astype(np.float32)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    ex = g - np.maximum(r, b)
    alpha = 1.0 - smoothstep(FEATHER_LOW, FEATHER_HIGH, ex)
    alpha[background_mask(ex)] = 0.0     # 连通绿幕+混色环彻底归零
    # despill：压掉火焰轮廓溢出的绿色
    g2 = np.minimum(g, np.maximum(r, b) + SPILL)
    out = np.stack([r, g2, b], axis=-1) * alpha[..., None]
    out = np.clip(np.round(out), 0, 255)
    if EDGE_KEEP:
        out[:EDGE_KEEP, :, :] = 0
        out[-EDGE_KEEP:, :, :] = 0
        out[:, :EDGE_KEEP, :] = 0
        out[:, -EDGE_KEEP:, :] = 0
    return out.astype(np.uint8)


def run_ffmpeg(args):
    p = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-loglevel', 'error'] + args,
                       capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError('ffmpeg failed: ' + p.stderr[-800:])


def process_one(lv, name, backup_name):
    src = os.path.join(ASSETS, name)
    if not os.path.exists(src):
        print('lv%d 跳过：找不到 %s' % (lv, src))
        return
    os.makedirs(RAW, exist_ok=True)
    bak = os.path.join(RAW, backup_name)
    if not os.path.exists(bak):
        shutil.copy2(src, bak)
        print('lv%d 母带备份 -> %s' % (lv, bak))

    tmp = tempfile.mkdtemp(prefix='td_key_%d_' % lv)
    fin = os.path.join(tmp, 'in')
    fout = os.path.join(tmp, 'out')
    os.makedirs(fin, exist_ok=True)
    os.makedirs(fout, exist_ok=True)
    try:
        run_ffmpeg(['-y', '-i', src, '-vsync', '0', os.path.join(fin, 'f%05d.png')])
        frames = sorted(os.listdir(fin))
        print('lv%d 解码 %d 帧，逐帧抠像…' % (lv, len(frames)))
        for i, fn in enumerate(frames, 1):
            im = Image.open(os.path.join(fin, fn)).convert('RGB')
            arr = np.asarray(im)
            Image.fromarray(key_frame(arr), 'RGB').save(os.path.join(fout, fn), optimize=False)
            if i % 25 == 0:
                print('  %d/%d' % (i, len(frames)))
        tmp_out = os.path.join(tmp, name)
        run_ffmpeg(['-y', '-framerate', str(FPS), '-i', os.path.join(fout, 'f%05d.png'),
                    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
                    '-crf', CRF, '-g', GOP, '-an', '-movflags', '+faststart', tmp_out])
        shutil.copy2(tmp_out, src)
        print('lv%d 完成 -> %s (%d bytes)' % (lv, name, os.path.getsize(src)))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    for lv, (name, bak) in JOBS.items():
        process_one(lv, name, bak)


if __name__ == '__main__':
    main()
