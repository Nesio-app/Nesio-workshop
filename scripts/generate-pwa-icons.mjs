#!/usr/bin/env node
/**
 * Regenerate square PWA icons from assets/treasurebox-icon-source.png
 * Requires: python3 venv with pillow (see README) or run once via project maintainer.
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

const py = `
from PIL import Image
from pathlib import Path
SRC = Path(${JSON.stringify(src)})
OUT = Path(${JSON.stringify(join(root, 'public/icons'))})
BG = (205, 222, 252)
img = Image.open(SRC).convert("RGBA")

def make_icon(size, scale, name):
    canvas = Image.new("RGBA", (size, size), BG + (255,))
    inner = int(round(size * scale))
    resized = img.resize((inner, inner), Image.Resampling.LANCZOS)
    o = (size - inner) // 2
    canvas.paste(resized, (o, o), resized)
    canvas.convert("RGB").save(OUT / name, "PNG", optimize=True)
    print("wrote", name)

make_icon(512, 0.78, "treasurebox-pwa-512.png")
make_icon(512, 0.72, "treasurebox-pwa-512-maskable.png")
make_icon(192, 0.78, "treasurebox-pwa-192.png")
make_icon(180, 0.78, "treasurebox-pwa-180.png")
make_icon(32, 0.85, "treasurebox-favicon-32.png")
make_icon(16, 0.85, "treasurebox-favicon-16.png")
`;

execSync(`python3 -c ${JSON.stringify(py)}`, { stdio: 'inherit', cwd: root });
