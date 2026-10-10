# -*- coding: utf-8 -*-
"""即梦火焰视频后期（图生视频版）：
绿幕/白幕 chromakey 抠像 -> despill 去边 -> 叠黑底 -> 缩放到目标尺寸 -> 压黑场
-> 首尾交叉淡化(无缝循环) -> H.264/yuv420p/去音轨/faststart。
源片: fire_lv{X}_img2vid_raw.mp4 (640x640, 4.06s, 24fps, 带音轨)。
用法: python process.py lv1 [lv2 ...]"""
import subprocess, sys, os
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), 'assets')

# 等级 -> 输出边长（与静态贴图显示尺寸 42/48/56 的 4x 超采样一致）
SIZE = {'lv1': 168, 'lv2': 192, 'lv3': 224}
# 抠像配置: (chromakey颜色, similarity, blend, despill类型)
# lv1/lv3 绿幕实测 RGB(44,254,53)/(45,254,50)；lv2 白幕实测均值(252,250,251)
KEY = {
    'lv1': ('0x2CFE35', 0.22, 0.08, 'green'),
    'lv2': ('0xFFFFFF', 0.12, 0.04, None),
    'lv3': ('0x2CFE35', 0.22, 0.08, 'green'),
}
# 亮度压黑阈值（Y<该值直接归零）：新源片背景干净，低阈值即可
CRUSH_Y = {'lv1': 12, 'lv2': 12, 'lv3': 12}
SRC_W, SRC_H, FPS, DUR, XFADE = 640, 640, 24, 4.06, 0.30

def process(lv):
    size = SIZE[lv]
    src = os.path.join(HERE, f'fire_{lv}_img2vid_raw.mp4')
    dst = os.path.join(ASSETS, f'fire_burn_{lv}.mp4')
    key_color, sim, blend, despill_type = KEY[lv]
    cy = CRUSH_Y[lv]
    key_chain = f'chromakey={key_color}:{sim}:{blend}'
    if despill_type:
        key_chain += f',despill=type={despill_type}'
    # 抠像 -> 叠黑底(ADD 混合所需) -> 缩方 -> 压黑场
    base = (rf"{key_chain},format=yuva420p[cmdk];"
            rf"color=c=black:s={SRC_W}x{SRC_H}:r={FPS}[bg];"
            rf"[bg][cmdk]overlay=shortest=1,"
            rf"scale={size}:{size}:flags=lanczos,fps={FPS},"
            rf"lutyuv=y='if(lt(val\,{cy})\,0\,val)',setsar=1,format=yuv420p[base];"
            rf"[base]split=2[ba][bb];")
    tail_start = round(DUR - XFADE, 3)
    # A=整段(0..DUR)；B=只取开头 XFADE 秒（循环绕回时的头部）；
    # 在 offset=DUR-XFADE 处把 A 的尾部与 B(头部) 交叉淡化，
    # 输出总长 = offset + XFADE = DUR，形成无缝循环
    fc = (f"{base}"
          f"[ba]trim=0:{DUR},setpts=PTS-STARTPTS,fps={FPS}[a];"
          f"[bb]trim=0:{XFADE},setpts=PTS-STARTPTS,fps={FPS}[b];"
          f"[a][b]xfade=transition=fade:duration={XFADE}:offset={tail_start},"
          f"format=yuv420p[v]")
    cmd = [FF, '-y', '-i', src, '-filter_complex', fc, '-map', '[v]',
           '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
           '-movflags', '+faststart', dst]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')
    if r.returncode != 0:
        print(lv, 'FAIL'); print(r.stderr[-1500:]); return
    sz = os.path.getsize(dst)
    print(lv, 'OK', dst, f'{sz/1024:.0f}KB')

if __name__ == '__main__':
    for lv in sys.argv[1:]:
        process(lv)
