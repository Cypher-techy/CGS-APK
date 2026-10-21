#!/usr/bin/env python3
"""Generates every app-icon and splash asset from the CGS logo.

Source: brand/logo-source.png (transparent PNG lockup: CGS emblem + wordmark + "PORTAL").
Outputs:
  CGS-native/assets/            -> @capacitor/assets sources (adaptive icon + splash, light/dark)
  CGS-native/brand/             -> app logo used inside the app (loader, offline screen)
  CGS-portal-main/public/icons/ -> PWA / favicon set for the web + TWA build
  CGS-portal-main/android/...   -> legacy launcher mipmaps for the TWA APK
  brand/preview-*.png           -> contact sheet to eyeball the result
"""
import pathlib
from PIL import Image, ImageDraw
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent
CGS = ROOT.parent
SRC = ROOT / "logo-source.png"

DARK = (23, 51, 40)         # #173328
BRIGHT = (32, 133, 28)      # #20851c
CANVAS = (11, 11, 11)       # #0b0b0b app canvas


# ---------------------------------------------------------------- source prep
def load_parts():
    im = Image.open(SRC).convert("RGBA")
    a = np.array(im)
    rows = (a[:, :, 3] > 10).sum(axis=1)
    idx = [i for i, v in enumerate(rows) if v > 0]
    segs, prev = [[idx[0]]], idx[0]
    for i in idx[1:]:
        if i - prev > 6:
            segs.append([])
        segs[-1].append(i)
        prev = i
    spans = [(s[0], s[-1]) for s in segs]

    def crop(span):
        y0, y1 = span
        band = a[y0:y1 + 1]
        cols = (band[:, :, 3] > 10).sum(axis=0)
        xs = [i for i, v in enumerate(cols) if v > 0]
        return im.crop((xs[0], y0, xs[-1] + 1, y1 + 1))

    emblem = crop(spans[0])                      # CGS + globe
    lockup = crop((spans[0][0], spans[-1][1]))   # everything
    return emblem, lockup


def fit(content, size, frac_w=0.8, frac_h=None, bg=None):
    """Centre `content` on a size x size canvas, scaled to occupy frac_w of the width."""
    canvas = Image.new("RGBA", (size, size), bg + (255,) if bg else (0, 0, 0, 0))
    w, h = content.size
    scale = (size * frac_w) / w
    if frac_h and h * scale > size * frac_h:
        scale = (size * frac_h) / h
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    resized = content.resize((nw, nh), Image.LANCZOS)
    canvas.alpha_composite(resized, ((size - nw) // 2, (size - nh) // 2))
    return canvas


def recolor(content, mapping, tol=70):
    """Map one brand colour to another, keeping anti-aliasing intact."""
    a = np.array(content).astype(np.int16)
    rgb, alpha = a[:, :, :3], a[:, :, 3]
    for src, dst in mapping.items():
        dist = np.abs(rgb - np.array(src)).sum(axis=2)
        hit = (dist < tol) & (alpha > 0)
        rgb[hit] = dst
    out = np.dstack([np.clip(rgb, 0, 255), alpha]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def silhouette(content, color=(255, 255, 255, 255)):
    a = np.array(content)
    out = np.zeros_like(a)
    out[:, :, :3] = color[:3]
    out[:, :, 3] = a[:, :, 3]
    return Image.fromarray(out, "RGBA")


def rounded(img, radius_frac=0.22):
    size = img.size[0]
    mask = Image.new("L", (size * 2, size * 2), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size * 2 - 1, size * 2 - 1], radius=int(size * 2 * radius_frac), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img.convert("RGBA"), (0, 0), mask.resize((size, size), Image.LANCZOS))
    return out


def save(img, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    print(f"  {path.relative_to(CGS)}  {img.size[0]}x{img.size[1]}")


# ---------------------------------------------------------------- build
def main():
    emblem, lockup = load_parts()
    print(f"source: emblem {emblem.size}, lockup {lockup.size}")

    # Lockup reversed for dark backgrounds: dark-green -> white, bright green kept.
    lockup_dark = recolor(lockup, {DARK: (255, 255, 255)})
    emblem_dark = recolor(emblem, {DARK: (255, 255, 255)})

    # ---- @capacitor/assets sources -------------------------------------
    print("\n@capacitor/assets sources (native shell):")
    nat = CGS / "CGS-native" / "assets"
    # The emblem is only ~2.7:1, so it is set nearly edge-to-edge; the wordmark part of the lockup
    # is unreadable at launcher sizes and is only used on the splash screen.
    icon = fit(emblem, 1024, frac_w=0.92, frac_h=0.92, bg=(255, 255, 255))
    save(icon.convert("RGB"), nat / "icon.png")
    save(Image.new("RGB", (1024, 1024), (255, 255, 255)), nat / "icon-background.png")
    # capacitor-assets insets the adaptive foreground by 16.7%, so draw it oversized.
    save(fit(emblem, 1024, frac_w=0.94), nat / "icon-foreground.png")
    save(fit(silhouette(emblem), 1024, frac_w=0.90), nat / "icon-monochrome.png")

    splash = Image.new("RGB", (2732, 2732), (255, 255, 255))
    splash.paste(fit(lockup, 2732, frac_w=0.56).convert("RGB"), (0, 0),
                 fit(lockup, 2732, frac_w=0.56).split()[3])
    save(splash, nat / "splash.png")

    splash_dark = Image.new("RGB", (2732, 2732), CANVAS)
    lay = fit(lockup_dark, 2732, frac_w=0.56)
    splash_dark.paste(lay.convert("RGB"), (0, 0), lay.split()[3])
    save(splash_dark, nat / "splash-dark.png")

    # ---- in-app logo ---------------------------------------------------
    print("\nIn-app logo (loader / offline screen):")
    bdir = CGS / "CGS-native" / "brand"
    save(fit(emblem_dark, 512, frac_w=0.86), bdir / "logo-mark.png")
    save(fit(lockup_dark, 1600, frac_w=0.92), bdir / "logo-lockup.png")

    # ---- PWA / favicon set --------------------------------------------
    print("\nPWA + favicon (web / TWA):")
    pub = CGS / "CGS-portal-main" / "public" / "icons"
    base = fit(emblem, 512, frac_w=0.92, frac_h=0.92, bg=(255, 255, 255))
    for s in (48, 72, 96, 144, 192, 384, 512):
        save(base.resize((s, s), Image.LANCZOS), pub / f"icon-{s}.png")
    save(fit(emblem, 512, frac_w=0.64, bg=(255, 255, 255)), pub / "maskable-512.png")
    save(base.resize((180, 180), Image.LANCZOS), pub / "apple-touch-icon.png")
    save(base.resize((32, 32), Image.LANCZOS), pub / "favicon-32.png")

    # ---- TWA legacy launcher mipmaps -----------------------------------
    print("\nTWA launcher icons:")
    res = CGS / "CGS-portal-main" / "android" / "app" / "src" / "main" / "res"
    sq = fit(emblem, 192, frac_w=0.92, frac_h=0.92, bg=(255, 255, 255))
    rnd = rounded(sq.convert("RGBA"), 0.5)
    for dens, size in [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96),
                       ("xxhdpi", 144), ("xxxhdpi", 192)]:
        save(sq.resize((size, size), Image.LANCZOS), res / f"mipmap-{dens}" / "ic_launcher.png")
        save(rnd.resize((size, size), Image.LANCZOS), res / f"mipmap-{dens}" / "ic_launcher_round.png")
        save(fit(emblem, size * 4, frac_w=0.94).resize((size, size), Image.LANCZOS),
             res / f"drawable-{dens}" / "ic_launcher_foreground.png")
    (res / "values").mkdir(parents=True, exist_ok=True)
    (res / "values" / "colors.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        '    <color name="ic_launcher_background">#FFFFFF</color>\n</resources>\n')

    # ---- contact sheet -------------------------------------------------
    print("\nPreview sheets:")
    sheet = Image.new("RGB", (980, 300), (232, 232, 232))
    tiles = [("192", fit(emblem, 192, 0.92, bg=(255, 255, 255))),
             ("96", fit(emblem, 96, 0.92, bg=(255, 255, 255))),
             ("48", fit(emblem, 48, 0.92, bg=(255, 255, 255))),
             ("circle", rounded(fit(emblem, 192, 0.92, bg=(255, 255, 255)), 0.5)),
             ("maskable", fit(emblem, 192, 0.64, bg=(255, 255, 255)))]
    x, y = 30, 54
    for label, t in tiles:
        sheet.paste(t.convert("RGB"), (x, y), t.split()[3] if t.mode == "RGBA" else None)
        d = ImageDraw.Draw(sheet)
        d.text((x, y + 200), label, fill=(60, 60, 60))
        x += 190
    sheet.save(ROOT / "preview-icons.png")

    dark_sheet = Image.new("RGB", (1200, 620), CANVAS)
    lay = fit(lockup_dark, 1100, 0.9)
    dark_sheet.paste(lay.convert("RGB"), (50, 150), lay.split()[3])
    dark_sheet.save(ROOT / "preview-splash-dark.png")
    print("  brand/preview-icons.png\n  brand/preview-splash-dark.png")


if __name__ == "__main__":
    main()
