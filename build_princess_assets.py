# -*- coding: utf-8 -*-
"""build_princess_assets.py —— 公主窗口图片 data URI 生成

输入：
  assets/princess.png  1024x1024 场景图（蓝天+城堡背景，非绿幕，整图展示，不抠图）。

输出：
  js/PrincessArtData.js  const PRINCESS_ART = { data, w, h }

点击城堡大门弹出的半透明窗口里居中【完整】显示这张图，因此保留整幅方图、
不裁剪不抠图；仅缩放到 512x512 JPEG（窗口显示 240 世界单位 × DPR2 = 480px，
512 足够清晰），data URI 同源干净，file:// 下也可上传 WebGL。
运行：python build_princess_assets.py
依赖：pip install pillow
"""
import base64
import io
import os

from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'assets', 'princess.png')
OUT_JS = os.path.join(ROOT, 'js', 'PrincessArtData.js')

SIZE = 512
QUALITY = 86


def main():
    img = Image.open(SRC).convert('RGB')
    print('公主源图 %dx%d' % (img.width, img.height))
    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=QUALITY, optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    hdr = ('/* ============================================================\n'
           ' * PrincessArtData.js —— 城堡大门弹窗内的公主图片（整图，不抠图）\n'
           ' * 由 build_princess_assets.py 自动生成，请勿手改。\n'
           ' * 纹理键 princess；%dx%d JPEG data URI，file:// 下可上传 WebGL。\n'
           ' * ============================================================ */\n') % (SIZE, SIZE)
    with open(OUT_JS, 'w', encoding='utf-8') as f:
        f.write(hdr + "const PRINCESS_ART = {\n  data: 'data:image/jpeg;base64,%s',\n  w: %d,\n  h: %d\n};\n"
                % (b64, SIZE, SIZE))
    print('PrincessArtData.js written, %d bytes' % os.path.getsize(OUT_JS))


if __name__ == '__main__':
    main()
