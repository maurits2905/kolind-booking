"""Builds the app icons in assets/icons/ (split terracotta/pine with a K).

Usage:  pip install pillow fonttools brotli && python3 dev/make-icons.py
"""
from pathlib import Path
from io import BytesIO
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
TERRA, PINE, CREAM = (182, 90, 58), (52, 79, 64), (250, 244, 234)

# PIL cannot read woff2 directly, so convert the bundled font in memory.
font = TTFont(ROOT / "assets" / "fonts" / "newsreader.woff2")
font.flavor = None
TTF = BytesIO()
font.save(TTF)


def icon(size, scale, path, weight=520, opsz=24, radius=0):
    s = size * 4
    im = Image.new("RGB", (s, s), PINE)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, s // 2, s), fill=TERRA)
    TTF.seek(0)
    f = ImageFont.truetype(TTF, int(s * scale))
    f.set_variation_by_axes([weight, opsz])
    box = d.textbbox((0, 0), "K", font=f)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((s - w) / 2 - box[0], (s - h) / 2 - box[1]), "K", font=f, fill=CREAM)
    im = im.resize((size, size), Image.LANCZOS)
    if radius:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(im, (0, 0), mask)
        im = out
    im.save(ROOT / "assets" / "icons" / path)
    print(path)


icon(512, 0.6, "icon-512.png")
icon(192, 0.6, "icon-192.png")
icon(512, 0.44, "maskable-512.png")
icon(180, 0.58, "apple-touch-icon.png")
icon(64, 0.72, "favicon-64.png", weight=620, opsz=12, radius=14)
