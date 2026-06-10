"""Generate BingeBreak extension icons (pure stdlib, no Pillow).

Draws a rounded dark tile with green pause bars at 256px, box-downsamples to
16/48/128, and writes minimal RGBA PNGs. Rerun after design changes:
    python3 gen_icons.py
"""

import struct
import zlib
from pathlib import Path

SIZE = 256
BG = (30, 32, 48, 255)        # #1e2030
BAR = (76, 175, 125, 255)     # #4caf7d
TRANSPARENT = (0, 0, 0, 0)


def in_rounded_rect(x, y, x0, y0, x1, y1, r):
    if not (x0 <= x < x1 and y0 <= y < y1):
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r or (
        x0 + r <= x < x1 - r or y0 + r <= y < y1 - r
    )


def draw_base():
    pixels = []
    bar_w, bar_h, gap = 38, 124, 30
    bar_y0 = (SIZE - bar_h) // 2
    left_x0 = SIZE // 2 - gap // 2 - bar_w
    right_x0 = SIZE // 2 + gap // 2
    for y in range(SIZE):
        row = []
        for x in range(SIZE):
            if in_rounded_rect(x, y, left_x0, bar_y0, left_x0 + bar_w, bar_y0 + bar_h, 14) or \
               in_rounded_rect(x, y, right_x0, bar_y0, right_x0 + bar_w, bar_y0 + bar_h, 14):
                row.append(BAR)
            elif in_rounded_rect(x, y, 8, 8, SIZE - 8, SIZE - 8, 52):
                row.append(BG)
            else:
                row.append(TRANSPARENT)
        pixels.append(row)
    return pixels


def downsample(pixels, target):
    factor = SIZE // target
    out = []
    for ty in range(target):
        row = []
        for tx in range(target):
            acc = [0, 0, 0, 0]
            for dy in range(factor):
                for dx in range(factor):
                    p = pixels[ty * factor + dy][tx * factor + dx]
                    # premultiply alpha for correct edge color
                    acc[0] += p[0] * p[3]
                    acc[1] += p[1] * p[3]
                    acc[2] += p[2] * p[3]
                    acc[3] += p[3]
            n = factor * factor
            a = acc[3] // n
            if a == 0:
                row.append((0, 0, 0, 0))
            else:
                row.append((acc[0] // acc[3], acc[1] // acc[3], acc[2] // acc[3], a))
        out.append(row)
    return out


def write_png(path, pixels):
    height = len(pixels)
    width = len(pixels[0])

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data))
        )

    raw = b"".join(
        b"\x00" + b"".join(bytes(p) for p in row) for row in pixels
    )
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    Path(path).write_bytes(png)


def main():
    out_dir = Path(__file__).parent / "icons"
    out_dir.mkdir(exist_ok=True)
    base = draw_base()
    for size in (128, 48, 16):
        write_png(out_dir / f"icon{size}.png", downsample(base, size))
        print(f"wrote icons/icon{size}.png")


if __name__ == "__main__":
    main()
