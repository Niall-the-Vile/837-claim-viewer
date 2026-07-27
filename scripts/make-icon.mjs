/*
 * Generates build/icon.ico (+ a build/icon-preview.png to eyeball) for the
 * Windows app icon, with no image dependencies — shapes are rasterized here,
 * PNG-encoded with node's zlib, and packed into a multi-resolution .ico.
 *
 * This is a PLACEHOLDER Brotherhood-style mark: a forest-green rounded square
 * with a white claim page. It is deliberately bold and low-detail so it still
 * reads at 16x16 in the taskbar, where fine line-art disappears.
 *
 * To replace it with real artwork: either drop a real `build/icon.ico` in
 * place (electron-builder picks it up; this script is then unnecessary), or
 * edit the shapes below and re-run `node scripts/make-icon.mjs`.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'build');

// Brotherhood forest green (matches the app's --accent) on white.
const GREEN = [0x00, 0x6e, 0x47];
const WHITE = [0xff, 0xff, 0xff];

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SS = 4; // supersampling factor for anti-aliasing

/** Signed-distance-ish inside test for a rounded rectangle in unit (0..1) space. */
function inRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * The mark, described in unit space so every size renders identically.
 * Returns [r,g,b,a] for a point, or null for transparent.
 */
function sample(x, y, size) {
  // Background: full-bleed rounded square.
  if (!inRoundedRect(x, y, 0, 0, 1, 1, 0.22)) return null;

  // Claim page: upright rectangle with a clipped top-right corner (the fold).
  const pl = 0.3;
  const pr = 0.7;
  const pt = 0.22;
  const pb = 0.78;
  const fold = 0.16; // fold size along each edge
  const onPage =
    x >= pl && x <= pr && y >= pt && y <= pb &&
    // cut the corner: everything above the fold diagonal is not page
    !(x > pr - fold && y < pt + fold && x - (pr - fold) > pt + fold - y);

  if (onPage) {
    // Text lines, only at sizes where they'd actually resolve (below 32px
    // they turn to mush and muddy the silhouette).
    if (size >= 32) {
      const lineX0 = pl + 0.06;
      const lineX1 = pr - 0.06;
      const lines = [0.42, 0.53, 0.64];
      const half = size >= 64 ? 0.018 : 0.022;
      for (const ly of lines) {
        // shorten the last line for a document-y look
        const x1 = ly === 0.64 ? lineX1 - 0.1 : lineX1;
        if (x >= lineX0 && x <= x1 && Math.abs(y - ly) <= half) return [...GREEN, 255];
      }
    }
    return [...WHITE, 255];
  }

  return [...GREEN, 255];
}

/** Renders one square RGBA buffer at `size`, supersampled for smooth edges. */
function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SS);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px * SS + sx + 0.5) * step;
          const y = (py * SS + sy + 0.5) * step;
          const c = sample(x, y, size);
          if (c) {
            // premultiplied accumulation so edges don't halo
            r += c[0]; g += c[1]; b += c[2]; a += c[3];
          }
        }
      }
      const n = SS * SS;
      const alpha = a / n;
      const i = (py * size + px) * 4;
      if (alpha > 0) {
        // un-premultiply against the accumulated coverage
        const cover = a / 255 || 1;
        buf[i] = Math.round(r / cover);
        buf[i + 1] = Math.round(g / cover);
        buf[i + 2] = Math.round(b / cover);
        buf[i + 3] = Math.round(alpha);
      }
    }
  }
  return buf;
}

// --- PNG encoding ----------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- ICO packing -----------------------------------------------------------

function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size; // 0 means 256
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0; // palette
    dir[o + 3] = 0; // reserved
    dir.writeUInt16LE(1, o + 4); // colour planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32BE(0, o + 8);
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// --- main ------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
const entries = SIZES.map((size) => ({ size, png: encodePng(render(size), size) }));
const ico = buildIco(entries);
writeFileSync(join(OUT_DIR, 'icon.ico'), ico);
// electron-builder also likes a large PNG around for non-Windows/installer use,
// and it doubles as the file to eyeball when tweaking the shapes above.
writeFileSync(join(OUT_DIR, 'icon.png'), entries[entries.length - 1].png);
console.log(`[make-icon] wrote build/icon.ico (${SIZES.join(', ')}px, ${ico.length} bytes) + build/icon.png`);
