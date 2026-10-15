# -*- coding: utf-8 -*-
"""compress_art_data.py —— 压缩 js/ 内嵌 ArtData 图片（移动端加载优化）

原理（视觉无损的依据）：
  运行时 BootScene 裁切管线 outH = max(targetH, h) —— 源内容盒高于
  targetH（= superSample × baseHeight × scale[lv]）时不做任何缩放，
  直接把整段内容注册成纹理，再经 setDisplaySize 缩回 ~40-67 世界单位。
  屏幕实际采样需求 ≤ 显示高 × 4（1080p DPR2 / 4K DPR1），targetH 本身
  已 4~8 倍超采，因此只要把源内容高降到 targetH × 安全余量（1.25~1.4），
  输出纹理逐像素不变、屏幕观感完全一致。
  尖端/装饰偏移 = 源纹素 × s（s = targetH/boxH），源图与 boxH 同步缩放
  时乘积不变 —— 管线对整体等比降采样【尺度不变】，对齐不受影响。
  雷塔 body/deco 强制同一缩放因子（运行时 deco 按 body 段坐标裁切）。

用法：
  python compress_art_data.py probe   # 列出内嵌图/键名上下文/分段测算，不写盘
  python compress_art_data.py run     # 执行降采样 + 重编码并回写 JS 文件
"""
import re
import os
import sys
import base64
import io
from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # 信任本地生成图

ROOT = os.path.dirname(os.path.abspath(__file__))

DATA_RE = re.compile(rb'data:image/png;base64,([A-Za-z0-9+/=]+)')

# ---------- 运行时 BootScene 同款逻辑复刻（阈值/步长逐行对齐） ----------

def detect_bg(px, w, h):
    corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    transparent = 0
    samples = []
    for cx, cy in corners:
        p = px[cx, cy]
        a = p[3] if len(p) > 3 else 255
        if a < 16:
            transparent += 1
        else:
            samples.append(p[:3])
    if transparent >= 3 or not samples:
        return {'type': 'transparent'}
    r = sum(s[0] for s in samples) / len(samples)
    g = sum(s[1] for s in samples) / len(samples)
    b = sum(s[2] for s in samples) / len(samples)
    dev = max(max(abs(s[0] - r), abs(s[1] - g), abs(s[2] - b)) for s in samples)
    if dev <= 24:
        return {'type': 'solid', 'r': round(r), 'g': round(g), 'b': round(b)}
    return {'type': 'transparent'}


def is_content(p, bg):
    a = p[3] if len(p) > 3 else 255
    if a < 16:
        return False
    if bg['type'] == 'transparent':
        return True
    return abs(p[0] - bg['r']) + abs(p[1] - bg['g']) + abs(p[2] - bg['b']) > 60


def _content_cols(px, w, h, bg):
    cols = [False] * w
    for x in range(w):
        for y in range(0, h, 2):
            if is_content(px[x, y], bg):
                cols[x] = True
                break
    return cols


def _runs(cols):
    segs = []
    start = -1
    for x in range(len(cols) + 1):
        if x < len(cols) and cols[x]:
            if start < 0:
                start = x
        elif start >= 0:
            segs.append([start, x - 1])
            start = -1
    return segs


def find_segments_thunder(px, w, h, bg):
    cols = _content_cols(px, w, h, bg)
    segs = _runs(cols)
    if len(segs) == 3:
        return segs
    cmin, cmax = w, -1
    for x in range(w):
        if cols[x]:
            cmin = min(cmin, x)
            cmax = max(cmax, x)
    if cmax < 0:
        return []
    step = (cmax - cmin + 1) / 3
    return [
        [cmin, round(cmin + step) - 1],
        [round(cmin + step), round(cmin + 2 * step) - 1],
        [round(cmin + 2 * step), cmax],
    ]


def main_segments_tower(px, w, h, bg):
    cols = _content_cols(px, w, h, bg)
    runs = _runs(cols)
    if len(runs) < 3:
        return []
    counts = []
    for x0, x1 in runs:
        n = 0
        for y in range(0, h, 2):
            for x in range(x0, x1 + 1, 2):
                if is_content(px[x, y], bg):
                    n += 1
        counts.append(n)
    mx = max(counts)
    main = [s for s, n in zip(runs, counts) if n >= mx * 0.08]
    main.sort(key=lambda s: s[0])
    if len(main) < 3:
        return []
    return main[:3]


def content_box(px, w, h, bg, x0, x1):
    minx, maxx, miny, maxy = x1 + 1, x0 - 1, h, -1
    for y in range(0, h, 2):
        for x in range(x0, x1 + 1, 2):
            if is_content(px[x, y], bg):
                minx = min(minx, x)
                maxx = max(maxx, x)
                miny = min(miny, y)
                maxy = max(maxy, y)
    if maxy < 0:
        return None
    minx = max(x0, minx - 1)
    maxx = min(x1, maxx + 1)
    miny = max(0, miny - 1)
    maxy = min(h - 1, maxy + 1)
    return (minx, miny, maxx - minx + 1, maxy - miny + 1)


def alpha_box(img):
    px = img.load()
    w, h = img.size
    minx, maxx, miny, maxy = w, -1, h, -1
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            p = px[x, y]
            if (p[3] if len(p) > 3 else 255) > 16:
                minx = min(minx, x)
                maxx = max(maxx, x)
                miny = min(miny, y)
                maxy = max(maxy, y)
    if maxx < 0:
        return (0, 0, w, h)
    return (minx, miny, maxx - minx + 1, maxy - miny + 1)


# ---------- 编解码 ----------

def decode_img(b64):
    return Image.open(io.BytesIO(base64.b64decode(b64)))


def encode_png(img):
    buf = io.BytesIO()
    img.save(buf, 'PNG', optimize=True)
    return base64.b64encode(buf.getvalue()).decode('ascii')


def downsample(img, f):
    w, h = img.size
    nw, nh = max(1, round(w * f)), max(1, round(h * f))
    return img.resize((nw, nh), Image.LANCZOS)


# config 同源数值（js/config.js art 段）：
THUNDER_TARGETS = [round(8 * 54 * s) for s in (1.0, 1.12, 1.24)]   # 432/484/536
WIND_TARGETS = [round(4 * 44 * s) for s in (1.0, 1.12, 1.24)]      # 176/197/218
GRAVITY_TARGETS = [round(4 * 40 * s) for s in (1.0, 1.08, 1.15)]   # 160/173/184

MARGIN_SHEET = 1.25   # 透明底（雷塔）
MARGIN_CHROMA = 1.40  # 色度键底（风/引力）软过渡边留更多余量


def sheet_boxes(kind, img):
    px = img.load()
    w, h = img.size
    bg = detect_bg(px, w, h)
    segs = find_segments_thunder(px, w, h, bg) if kind == 'thunder' \
        else main_segments_tower(px, w, h, bg)
    if len(segs) < 3:
        raise RuntimeError('分段不足 3 段：%d' % len(segs))
    boxes = [content_box(px, w, h, bg, s[0], s[1]) for s in segs[:3]]
    if any(b is None for b in boxes):
        raise RuntimeError('段内无内容')
    return bg, segs[:3], boxes


def factor_from_boxes(targets, boxes, margin):
    f = 0.0
    for t, b in zip(targets, boxes):
        f = max(f, t * margin / b[3])
    return min(1.0, f)


def ctx_of(raw, m, n=70):
    """data URI 前的键名上下文（核对 URI 顺序）"""
    s = raw[max(0, m.start() - n):m.start()].decode('utf-8', 'replace')
    s = re.sub(r'\s+', ' ', s)
    return s[-n:]


def run(do_write):
    total_old = total_new = 0

    # ============ 1) ThunderSheetData.js（body/deco 同因子） ============
    path = os.path.join(ROOT, 'js', 'ThunderSheetData.js')
    raw = open(path, 'rb').read()
    matches = list(DATA_RE.finditer(raw))
    assert len(matches) == 2, 'ThunderSheetData 期望 2 个 data URI，实际 %d' % len(matches)
    body = decode_img(matches[0].group(1))
    deco = decode_img(matches[1].group(1))
    assert body.size == deco.size, 'body/deco 尺寸不一致：%s vs %s' % (body.size, deco.size)
    print('ThunderSheetData.js  body/deco 原尺寸 %dx%d' % (body.size[0], body.size[1]))
    print('  键名上下文：[%s] / [%s]' % (ctx_of(raw, matches[0]), ctx_of(raw, matches[1])))
    bg_b, segs_b, boxes_b = sheet_boxes('thunder', body)
    f = factor_from_boxes(THUNDER_TARGETS, boxes_b, MARGIN_SHEET)
    print('  body 分段 boxH=%s target=%s f=%.4f' % ([b[3] for b in boxes_b], THUNDER_TARGETS, f))
    body_n = downsample(body, f)
    deco_n = downsample(deco, f)
    # 验证 1：body 新图 3 段、每段 boxH ≥ targetH
    bg2, segs2, boxes2 = sheet_boxes('thunder', body_n)
    for lv, (t, b) in enumerate(zip(THUNDER_TARGETS, boxes2), 1):
        assert b[3] >= t, 'body lv%d 新内容盒 %d < targetH %d' % (lv, b[3], t)
    # 验证 2：复刻运行时 —— deco 新图按 body 新段坐标裁切有内容（对齐有效）
    px_d = deco_n.load()
    bg_d = detect_bg(px_d, deco_n.size[0], deco_n.size[1])
    for lv, s in enumerate(segs2, 1):
        dbox = content_box(px_d, deco_n.size[0], deco_n.size[1], bg_d, s[0], s[1])
        assert dbox is not None, 'deco lv%d 按 body 段坐标裁切无内容' % lv
    assert body_n.size == deco_n.size
    uris = [encode_png(body_n), encode_png(deco_n)]
    old_kb = [len(m.group(0)) * 0.75 / 1024 for m in matches]
    new_kb = [len(u) * 0.75 / 1024 for u in uris]
    print('  验证 ✓ body 新 boxH=%s；deco 按 body 段裁切有内容；尺寸 %dx%d' % (
        [b[3] for b in boxes2], body_n.size[0], body_n.size[1]))
    print('  body %.0fKB→%.0fKB，deco %.0fKB→%.0fKB' % (old_kb[0], new_kb[0], old_kb[1], new_kb[1]))
    out = raw
    it = iter(uris)
    out = DATA_RE.sub(lambda m: b'data:image/png;base64,' + next(it).encode('ascii'), out)
    print('  文件 %.2fMB → %.2fMB' % (len(raw) / 1048576, len(out) / 1048576))
    total_old += len(raw)
    total_new += len(out)
    if do_write:
        open(path, 'wb').write(out)

    # ============ 2) 风 / 引力（单图三连，色度键底） ============
    for fname, targets, sheet in (
        ('WindTowersArtData.js', WIND_TARGETS, 'tower'),
        ('GravityTowersArtData.js', GRAVITY_TARGETS, 'tower'),
    ):
        path = os.path.join(ROOT, 'js', fname)
        raw = open(path, 'rb').read()
        matches = list(DATA_RE.finditer(raw))
        assert len(matches) == 1, '%s 期望 1 个 data URI，实际 %d' % (fname, len(matches))
        img = decode_img(matches[0].group(1))
        print('%s  原尺寸 %dx%d  键名上下文 [%s]' % (fname, img.size[0], img.size[1], ctx_of(raw, matches[0])))
        bg, segs, boxes = sheet_boxes(sheet, img)
        f = factor_from_boxes(targets, boxes, MARGIN_CHROMA)
        print('  分段 boxH=%s target=%s f=%.4f（背景 %s）' % ([b[3] for b in boxes], targets, f, bg))
        img_n = downsample(img, f)
        bg2, segs2, boxes2 = sheet_boxes(sheet, img_n)
        for lv, (t, b) in enumerate(zip(targets, boxes2), 1):
            assert b[3] >= t, 'lv%d 新内容盒 %d < targetH %d' % (lv, b[3], t)
        uri = encode_png(img_n)
        print('  验证 ✓ 新 boxH=%s；%.0fKB→%.0fKB' % (
            [b[3] for b in boxes2], len(matches[0].group(0)) * 0.75 / 1024, len(uri) * 0.75 / 1024))
        out = DATA_RE.sub(lambda m: b'data:image/png;base64,' + uri.encode('ascii'), raw, count=1)
        print('  文件 %.2fMB → %.2fMB' % (len(raw) / 1048576, len(out) / 1048576))
        total_old += len(raw)
        total_new += len(out)
        if do_write:
            open(path, 'wb').write(out)

    # ============ 3) EnemyArtData / CrownArtData（单体透明贴图） ============
    for fname, needs in (
        ('EnemyArtData.js', [390, 390, 390, 276, 246]),  # boss h65×6 / slime h46·41×6
        ('CrownArtData.js', [72, 72, 72]),                # crown h9×8
    ):
        path = os.path.join(ROOT, 'js', fname)
        raw = open(path, 'rb').read()
        matches = list(DATA_RE.finditer(raw))
        assert len(matches) == len(needs), '%s 期望 %d 个 data URI，实际 %d' % (
            fname, len(needs), len(matches))
        uris = []
        changed = False
        for i, (m, need) in enumerate(zip(matches, needs)):
            img = decode_img(m.group(1))
            box = alpha_box(img)
            f = min(1.0, need / box[3])
            img_n = downsample(img, f) if f < 0.999 else img
            if f < 0.999:
                changed = True
            box2 = alpha_box(img_n)
            assert box2[3] >= min(need, box[3]) * 0.98, '内容盒异常收缩'
            uris.append(encode_png(img_n))
            print('%s [%d] %dx%d boxH=%d need=%d f=%.3f → %dx%d  %.0fKB→%.0fKB  键[%s]' % (
                fname, i, img.size[0], img.size[1], box[3], need, f,
                img_n.size[0], img_n.size[1],
                len(m.group(0)) * 0.75 / 1024, len(uris[-1]) * 0.75 / 1024,
                ctx_of(raw, m, 46)))
        if not changed:
            print('  %s 全部贴图已满足尺寸需求，无变化，跳过写盘' % fname)
            continue
        it = iter(uris)
        out = DATA_RE.sub(lambda m: b'data:image/png;base64,' + next(it).encode('ascii'), raw)
        print('  文件 %.2fMB → %.2fMB' % (len(raw) / 1048576, len(out) / 1048576))
        total_old += len(raw)
        total_new += len(out)
        if do_write:
            open(path, 'wb').write(out)

    print('合计：%.2fMB → %.2fMB（省 %.2fMB）' % (
        total_old / 1048576, total_new / 1048576, (total_old - total_new) / 1048576))


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'probe'
    run(do_write=(mode == 'run'))
    if mode != 'run':
        print('（probe 模式，未写盘；确认后执行：python compress_art_data.py run）')
