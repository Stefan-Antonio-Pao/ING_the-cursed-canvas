from __future__ import annotations

import os
import shutil
import struct
import subprocess
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "desktop" / "assets"
ICON_PNG = ASSET_DIR / "icon.png"
ICON_ICNS = ASSET_DIR / "icon.icns"
ICON_ICO = ASSET_DIR / "icon.ico"


def _clamp(value: int) -> int:
    return max(0, min(255, value))


def _blend(dst: tuple[int, int, int, int], src: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    sr, sg, sb, sa = src
    dr, dg, db, da = dst
    alpha = sa / 255
    out_alpha = alpha + da / 255 * (1 - alpha)
    if out_alpha == 0:
        return 0, 0, 0, 0
    return (
        _clamp(round((sr * alpha + dr * da / 255 * (1 - alpha)) / out_alpha)),
        _clamp(round((sg * alpha + dg * da / 255 * (1 - alpha)) / out_alpha)),
        _clamp(round((sb * alpha + db * da / 255 * (1 - alpha)) / out_alpha)),
        _clamp(round(out_alpha * 255)),
    )


def _rounded_rect_mask(x: int, y: int, left: int, top: int, right: int, bottom: int, radius: int) -> bool:
    if x < left or x >= right or y < top or y >= bottom:
        return False
    cx = left + radius if x < left + radius else right - radius - 1 if x >= right - radius else x
    cy = top + radius if y < top + radius else bottom - radius - 1 if y >= bottom - radius else y
    return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= radius * radius


def _fill_rounded(
    pixels: list[list[tuple[int, int, int, int]]],
    box: tuple[int, int, int, int],
    radius: int,
    color: tuple[int, int, int, int],
) -> None:
    left, top, right, bottom = box
    for y in range(max(0, top), min(len(pixels), bottom)):
        row = pixels[y]
        for x in range(max(0, left), min(len(row), right)):
            if _rounded_rect_mask(x, y, left, top, right, bottom, radius):
                row[x] = _blend(row[x], color)


def _fill_rect(
    pixels: list[list[tuple[int, int, int, int]]],
    box: tuple[int, int, int, int],
    color: tuple[int, int, int, int],
) -> None:
    left, top, right, bottom = box
    for y in range(max(0, top), min(len(pixels), bottom)):
        row = pixels[y]
        for x in range(max(0, left), min(len(row), right)):
            row[x] = _blend(row[x], color)


def _draw_line(
    pixels: list[list[tuple[int, int, int, int]]],
    start: tuple[int, int],
    end: tuple[int, int],
    width: int,
    color: tuple[int, int, int, int],
) -> None:
    x1, y1 = start
    x2, y2 = end
    dx = x2 - x1
    dy = y2 - y1
    steps = max(abs(dx), abs(dy), 1)
    radius = width // 2
    for step in range(steps + 1):
        x = round(x1 + dx * step / steps)
        y = round(y1 + dy * step / steps)
        for yy in range(y - radius, y + radius + 1):
            if yy < 0 or yy >= len(pixels):
                continue
            row = pixels[yy]
            for xx in range(x - radius, x + radius + 1):
                if 0 <= xx < len(row) and (xx - x) * (xx - x) + (yy - y) * (yy - y) <= radius * radius:
                    row[xx] = _blend(row[xx], color)


def _write_png(path: Path, pixels: list[list[tuple[int, int, int, int]]]) -> None:
    height = len(pixels)
    width = len(pixels[0])
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for rgba in row:
            raw.extend(rgba)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = bytearray(b"\x89PNG\r\n\x1a\n")
    png.extend(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
    png.extend(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
    png.extend(chunk(b"IEND", b""))
    path.write_bytes(png)


def _make_icon_png(size: int = 1024) -> None:
    pixels: list[list[tuple[int, int, int, int]]] = []
    center = size / 2
    for y in range(size):
        row: list[tuple[int, int, int, int]] = []
        for x in range(size):
            distance = ((x - center) ** 2 + (y - center) ** 2) ** 0.5 / center
            shade = max(0, min(1, 1 - distance))
            row.append((18 + round(20 * shade), 28 + round(42 * shade), 34 + round(38 * shade), 255))
        pixels.append(row)

    _fill_rounded(pixels, (64, 64, 960, 960), 180, (24, 33, 38, 255))
    _fill_rounded(pixels, (138, 116, 886, 918), 74, (173, 133, 58, 255))
    _fill_rounded(pixels, (174, 152, 850, 882), 54, (82, 58, 45, 255))
    _fill_rounded(pixels, (220, 196, 804, 836), 30, (232, 222, 196, 255))
    _fill_rounded(pixels, (252, 232, 772, 800), 18, (196, 202, 190, 95))
    _fill_rect(pixels, (272, 252, 752, 780), (238, 231, 207, 170))

    _draw_line(pixels, (294, 324), (676, 696), 42, (118, 24, 32, 225))
    _draw_line(pixels, (332, 650), (692, 354), 24, (41, 55, 59, 205))
    _draw_line(pixels, (382, 272), (488, 404), 14, (56, 45, 45, 190))
    _draw_line(pixels, (624, 536), (722, 742), 16, (56, 45, 45, 180))
    _draw_line(pixels, (438, 444), (590, 482), 12, (56, 45, 45, 170))

    _fill_rounded(pixels, (430, 472, 594, 560), 40, (34, 42, 45, 210))
    _fill_rounded(pixels, (462, 490, 504, 532), 18, (226, 216, 188, 220))
    _fill_rounded(pixels, (520, 490, 562, 532), 18, (226, 216, 188, 220))

    _write_png(ICON_PNG, pixels)


def _run_sips(source: Path, target: Path, size: int) -> None:
    subprocess.run(["sips", "-z", str(size), str(size), str(source), "--out", str(target)], check=True, stdout=subprocess.DEVNULL)


def _make_icns() -> None:
    temp_dir = ASSET_DIR / "icns-pngs"
    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True)

    chunks: list[tuple[bytes, bytes]] = []
    for chunk_type, size in (
        (b"icp4", 16),
        (b"icp5", 32),
        (b"icp6", 64),
        (b"ic07", 128),
        (b"ic08", 256),
        (b"ic09", 512),
        (b"ic10", 1024),
    ):
        png_path = temp_dir / f"icon-{size}.png"
        _run_sips(ICON_PNG, png_path, size)
        chunks.append((chunk_type, png_path.read_bytes()))

    total_length = 8 + sum(8 + len(data) for _, data in chunks)
    payload = bytearray(b"icns" + struct.pack(">I", total_length))
    for chunk_type, data in chunks:
        payload.extend(chunk_type)
        payload.extend(struct.pack(">I", 8 + len(data)))
        payload.extend(data)
    ICON_ICNS.write_bytes(payload)
    shutil.rmtree(temp_dir)


def _make_ico() -> None:
    entries: list[tuple[int, bytes]] = []
    temp_dir = ASSET_DIR / "ico-pngs"
    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True)
    for size in (16, 24, 32, 48, 64, 128, 256):
        png_path = temp_dir / f"icon-{size}.png"
        _run_sips(ICON_PNG, png_path, size)
        entries.append((size, png_path.read_bytes()))

    header = bytearray(struct.pack("<HHH", 0, 1, len(entries)))
    offset = 6 + 16 * len(entries)
    payload = bytearray()
    for size, data in entries:
        width = 0 if size == 256 else size
        header.extend(struct.pack("<BBBBHHII", width, width, 0, 0, 1, 32, len(data), offset))
        payload.extend(data)
        offset += len(data)
    ICON_ICO.write_bytes(header + payload)
    shutil.rmtree(temp_dir)


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    legacy_iconset = ASSET_DIR / "icon.iconset"
    if legacy_iconset.exists():
        shutil.rmtree(legacy_iconset)
    _make_icon_png()
    if shutil.which("sips"):
        _make_icns()
        _make_ico()
    else:
        raise SystemExit("sips is required to generate desktop icons on macOS.")
    print(f"Generated {os.fspath(ICON_PNG)}")
    print(f"Generated {os.fspath(ICON_ICNS)}")
    print(f"Generated {os.fspath(ICON_ICO)}")


if __name__ == "__main__":
    main()
