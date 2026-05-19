#!/usr/bin/env python3
"""Generate the four PNG icons the manifest references.

Design: purple rounded square with white "NR" text, matching the extension's
selection-rectangle and overlay accent (#9147ff). Re-runnable; output goes to
src/icons/.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "src" / "icons"
SIZES = [16, 32, 48, 128]
BG = (145, 71, 255, 255)        # purple #9147ff
BG_DARK = (51, 19, 102, 255)    # accent border
FG = (255, 255, 255, 255)


def find_font(size: int) -> ImageFont.ImageFont:
    """Pick a bold sans-serif if available; fall back to PIL's default."""
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def render(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = max(2, size // 6)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=BG, outline=BG_DARK, width=max(1, size // 32))

    # "NR" text centered. Pick a font size that fills ~55% of the icon height.
    text = "NR"
    font_size = max(6, int(size * 0.55))
    font = find_font(font_size)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (size - tw) // 2 - bbox[0]
    ty = (size - th) // 2 - bbox[1] - max(1, size // 32)
    draw.text((tx, ty), text, fill=FG, font=font)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        out = OUT / f"icon-{size}.png"
        render(size).save(out)
        print(f"wrote {out} ({size}x{size})")


if __name__ == "__main__":
    main()
