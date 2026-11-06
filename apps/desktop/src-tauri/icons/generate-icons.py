"""生成 HearLink 应用图标（PNG + ICO），供 Tauri 使用。

用法：
    python apps/desktop/src-tauri/icons/generate-icons.py

只依赖 Pillow。输出：
    32x32.png / 128x128.png / 128x128@2x.png / icon.png / icon.ico
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT_DIR = Path(__file__).resolve().parent
SIZE = 1024
RADIUS = 220

# 品牌蓝：上浅下深
TOP = (37, 99, 235)
BOTTOM = (23, 37, 84)
WHITE = (255, 255, 255)


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def gradient(size: int) -> Image.Image:
    image = Image.new("RGB", (size, size))
    draw = ImageDraw.Draw(image)
    for y in range(size):
        t = y / (size - 1)
        color = tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        draw.line(((0, y), (size, y)), fill=color)
    return image


def load_font(size: int):
    for candidate in (
        r"C:\Windows\Fonts\segoeuib.ttf",
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\arial.ttf",
    ):
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size)


def main() -> None:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    image.paste(gradient(SIZE), (0, 0))
    image.putalpha(rounded_mask(SIZE, RADIUS))

    draw = ImageDraw.Draw(image)

    # 字母 H：略偏左，右侧留给"听"的声波弧线
    font = load_font(520)
    text = "H"
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    width, height = right - left, bottom - top
    draw.text(
        ((SIZE - width) / 2 - 120 - left, (SIZE - height) / 2 - top - 20),
        text,
        font=font,
        fill=WHITE,
    )

    # 两道声波弧线
    for index, radius in enumerate((150, 250)):
        box = (SIZE / 2 + 60, SIZE / 2 - radius - 40, SIZE / 2 + 60 + radius * 2, SIZE / 2 + radius - 40)
        draw.arc(box, start=-60, end=60, fill=WHITE, width=46 - index * 6)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    image.save(OUT_DIR / "icon.png")
    for name, size in (
        ("32x32.png", 32),
        ("128x128.png", 128),
        ("128x128@2x.png", 256),
    ):
        image.resize((size, size), Image.LANCZOS).save(OUT_DIR / name)

    image.save(
        OUT_DIR / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"已生成图标：{OUT_DIR}")


if __name__ == "__main__":
    main()
