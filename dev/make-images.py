"""Builds the web images in assets/img/ from the photos in assets/photos/.

Usage:  pip install pillow && python3 dev/make-images.py

Replace assets/photos/<id>-original.* with a new photo and adjust the crop
boxes below (left, top, right, bottom in pixels of the original).
"""
from pathlib import Path
from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
PHOTOS = ROOT / "assets" / "photos"
OUT = ROOT / "assets" / "img"
PORTRAIT_MIN_WIDTH = 600

PROPERTIES = {
    "mallorca": {
        "src": "mallorca-original.jpg",
        "wide": (150, 90, 1448, 901),     # house and mountains, less road
        "portrait": (300, 20, 1155, 920),
        "grade": {"color": 1.0, "contrast": 1.02, "brightness": 1.0, "warm": 1.0},
    },
    "odde": {
        "src": "odde-original.jpg",
        "wide": (0, 40, 1125, 744),
        "portrait": (712, 160, 1125, 595),  # the cabin on the right (the family's house), centred
        "upscale": True,
        "grade": {"color": 1.0, "contrast": 1.02, "brightness": 1.0, "warm": 1.0},
    },
}


def grade(im, g):
    im = ImageEnhance.Color(im).enhance(g["color"])
    im = ImageEnhance.Contrast(im).enhance(g["contrast"])
    im = ImageEnhance.Brightness(im).enhance(g["brightness"])
    r, gr, b = im.split()
    r = r.point(lambda v: min(255, int(v * g["warm"])))
    b = b.point(lambda v: int(v / g["warm"]))
    im = Image.merge("RGB", (r, gr, b))
    return im.filter(ImageFilter.UnsharpMask(radius=1.0, percent=45, threshold=2))


def save(im, name, width=None, quality=88):
    if width and im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    path = OUT / name
    im.save(path, "WEBP", quality=quality, method=6)
    print(f"{path.relative_to(ROOT)}  {im.width}x{im.height}  {path.stat().st_size // 1024} KB")
    return im


def cover(im, size):
    """Crop-to-fill like CSS object-fit: cover (centered)."""
    tw, th = size
    scale = max(tw / im.width, th / im.height)
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    left = (im.width - tw) // 2
    top = (im.height - th) // 2
    return im.crop((left, top, left + tw, top + th))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    portraits = {}
    for pid, cfg in PROPERTIES.items():
        src = grade(Image.open(PHOTOS / cfg["src"]).convert("RGB"), cfg["grade"])
        wide = src.crop(cfg["wide"])
        portrait = src.crop(cfg["portrait"])
        if cfg.get("upscale") and portrait.width < PORTRAIT_MIN_WIDTH:  # tight crop: keep cards sharp on phones
            h = round(portrait.height * PORTRAIT_MIN_WIDTH / portrait.width)
            portrait = portrait.resize((PORTRAIT_MIN_WIDTH, h), Image.LANCZOS)
            portrait = portrait.filter(ImageFilter.UnsharpMask(radius=1.2, percent=40, threshold=2))
        save(wide, f"{pid}.webp")
        save(wide, f"{pid}-sm.webp", width=640, quality=80)
        save(portrait, f"{pid}-portrait.webp")
        portraits[pid] = portrait

    # Link preview (Open Graph) for SMS/WhatsApp/Messenger: the two houses side by side.
    og = Image.new("RGB", (1200, 630), (247, 243, 236))
    og.paste(cover(portraits["mallorca"], (597, 630)), (0, 0))
    og.paste(cover(portraits["odde"], (597, 630)), (603, 0))
    og.save(OUT / "og.jpg", "JPEG", quality=82, optimize=True, progressive=True)
    print("assets/img/og.jpg  1200x630")


if __name__ == "__main__":
    main()
