#!/usr/bin/env python3
"""生成纯净课表 PWA 图标（无第三方依赖）。
用法: python tools/make-icons.py [输出目录]
输出: icons/icon-512.png  icon-192.png  apple-touch-icon.png(180)
"""
import math
import os
import struct
import sys
import zlib


def sdf_rrect(x, y, cx, cy, hw, hh, r):
    """圆角矩形有向距离（<=0 在内）。"""
    qx = abs(x - cx) - (hw - r)
    qy = abs(y - cy) - (hh - r)
    ox = max(qx, 0.0)
    oy = max(qy, 0.0)
    return math.hypot(ox, oy) + min(max(qx, qy), 0.0) - r


def make_icon(size):
    TOP = (92, 136, 255)
    BOT = (74, 111, 247)

    def bg(y):
        t = y
        return tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOT))

    CARD = (0.30, 0.30, 0.70, 0.70)          # 白色圆角卡
    CELL = (0.335, 0.335, 0.665, 0.665)      # 卡片内网格
    NCOL, NROW = 3, 2
    COLORS = ( (92, 136, 255), (110, 176, 255), (240, 244, 255) )

    def cover(x, y):
        # 画布圆角
        if sdf_rrect(x, y, 0.5, 0.5, 0.5, 0.5, 0.205) > 0:
            return None  # 透明
        # 白卡
        if sdf_rrect(x, y, (CARD[0]+CARD[2])/2, (CARD[1]+CARD[3])/2,
                     (CARD[2]-CARD[0])/2, (CARD[3]-CARD[1])/2, 0.06) > 0:
            return bg(y)
        # 网格单元格
        cw = (CELL[2] - CELL[0]) / NCOL
        ch = (CELL[3] - CELL[1]) / NROW
        cx = int((x - CELL[0]) / cw)
        cy = int((y - CELL[1]) / ch)
        if cx < 0 or cx >= NCOL or cy < 0 or cy >= NROW:
            return (255, 255, 255)
        m = 0.010
        if sdf_rrect(x, y, CELL[0] + (cx + 0.5) * cw, CELL[1] + (cy + 0.5) * ch,
                     cw / 2 - m, ch / 2 - m, 0.012) > 0:
            return (255, 255, 255)
        fill = (cx <= 1) if cy == 0 else (cx >= 1)
        if fill:
            idx = cy * 2 + (cx % 2)  # 0..3
            return COLORS[idx % 3]
        return (225, 232, 248)

    SAMPLES = 4
    raw_rows = []
    for py in range(size):
        row = bytearray(b'\x00')
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(SAMPLES):
                for sx in range(SAMPLES):
                    x = (px + (sx + 0.5) / SAMPLES) / size
                    y = (py + (sy + 0.5) / SAMPLES) / size
                    c = cover(x, y)
                    if c is None:
                        continue
                    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 255
            n = SAMPLES * SAMPLES
            row.extend((round(acc[0] / n), round(acc[1] / n), round(acc[2] / n), round(acc[3] / n)))
        raw_rows.append(bytes(row))

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) +
            chunk(b'IDAT', zlib.compress(b''.join(raw_rows), 9)) + chunk(b'IEND', b''))


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.normpath(os.path.join(here, '..', 'icons'))
    os.makedirs(out, exist_ok=True)
    for name, size in (('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180)):
        with open(os.path.join(out, name), 'wb') as f:
            f.write(make_icon(size))
        print('写入', os.path.join(out, name))


if __name__ == '__main__':
    main()
