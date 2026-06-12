#!/usr/bin/env node
/**
 * Regenerate PWA icons: flat sampled background, crystal only (no outer ring).
 * Requires Pillow in a venv: python3 -m venv .venv-icons && .venv-icons/bin/pip install pillow
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'assets/treasurebox-icon-source.png');
if (!existsSync(src)) {
  console.error('Missing assets/treasurebox-icon-source.png');
  process.exit(1);
}

const script = `
from PIL import Image
from pathlib import Path
SRC = Path(${JSON.stringify(src)})
OUT = Path(${JSON.stringify(join(root, 'public/icons'))})
APP = Path(${JSON.stringify(root)})

img = Image.open(SRC).convert("RGBA")
w, h = img.size

def sample_corners(im, box=24):
    pixels = []
    for x0, y0 in [(0,0), (w-box,0), (0,h-box), (w-box,h-box)]:
        crop = im.crop((x0, y0, x0+box, y0+box))
        for r,g,b,a in crop.getdata():
            if a > 200:
                pixels.append((r,g,b))
    n = len(pixels)
    return (sum(p[0] for p in pixels)//n, sum(p[1] for p in pixels)//n, sum(p[2] for p in pixels)//n)

def lighten(rgb, amount=0.62):
    r,g,b = rgb
    return (
        min(255, int(r + (255 - r) * amount)),
        min(255, int(g + (255 - g) * amount)),
        min(255, int(b + (255 - b) * amount)),
    )

orig_bg = sample_corners(img)
BG = lighten(orig_bg)

def color_dist(c1, c2):
    return sum((a-b)**2 for a,b in zip(c1,c2))**0.5

def isolate_crystal(im, bg, tol=32):
    out = im.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r,g,b,a = px[x,y]
            if color_dist((r,g,b), bg) <= tol:
                px[x,y] = (r,g,b,0)
    return out

crystal = isolate_crystal(img, orig_bg, 34)

def make_icon(size, scale, name):
    canvas = Image.new("RGBA", (size, size), BG + (255,))
    inner = int(round(size * scale))
    layer = crystal.resize((inner, inner), Image.Resampling.LANCZOS)
    o = (size - inner) // 2
    canvas.paste(layer, (o, o), layer)
    canvas.convert("RGB").save(OUT / name, "PNG", optimize=True)
    print("wrote", name)

for size, scale, name in [
    (512, 0.97, "treasurebox-pwa-512.png"),
    (512, 0.90, "treasurebox-pwa-512-maskable.png"),
    (192, 0.97, "treasurebox-pwa-192.png"),
    (180, 0.97, "treasurebox-pwa-180.png"),
    (32, 0.98, "treasurebox-favicon-32.png"),
    (16, 0.98, "treasurebox-favicon-16.png"),
]:
    make_icon(size, scale, name)

Image.open(OUT / "treasurebox-pwa-180.png").save(APP / "app/apple-icon.png", "PNG")
Image.open(OUT / "treasurebox-favicon-32.png").save(APP / "app/icon.png", "PNG")
print("BG", f"#{BG[0]:02x}{BG[1]:02x}{BG[2]:02x}")
`;

const venvPy = join(root, '.venv-icons/bin/python3');
const python = existsSync(venvPy) ? venvPy : 'python3';
execSync(`${python} -c ${JSON.stringify(script)}`, { stdio: 'inherit', cwd: root });
