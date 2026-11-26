'use strict';
// Generates the PNG app icons and the default social-share image.
// Run with: npm run icons   (only needed if you change the design)

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');

// ---------------------------------------------------------------- PNG writer
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ drawing
// The Surgthflur - Music mark: a ring of 56 waveform bars around an 8-bar
// equalizer (same geometry as public/brand/logo-mark.svg, centre 400,340).
const BG = [5, 5, 16];
const RING = [46, 91, 255];
const EQ = [92, 134, 255];
const RING_TOPS = [152, 143.03, 134.4, 126.44, 119.47, 113.75, 109.5, 106.88, 106, 106.88, 109.5, 113.75, 119.47, 126.44, 134.4, 143.03, 152, 143.03, 134.4, 126.44, 119.47, 113.75, 109.5, 106.88, 106, 106.88, 109.5, 113.75, 119.47, 126.44, 134.4, 143.03, 152, 143.03, 134.4, 126.44, 119.47, 113.75, 109.5, 106.88, 106, 106.88, 109.5, 113.75, 119.47, 126.44, 134.4, 143.03, 152, 143.03, 134.4, 126.44, 119.47, 113.75, 109.5, 106.88];
const EQ_BARS = [[337, 325, 30], [355, 312.5, 55], [373, 295, 90], [391, 310, 60], [409, 320, 40], [427, 305, 70], [445, 315, 50], [463, 325, 30]];
const STEP = (2 * Math.PI) / 56;

// Distance from point to a capsule (rounded bar) along one axis.
function inCapsule(along, across, from, to, r) {
  const a = Math.min(Math.max(along, from + r), to - r);
  return Math.hypot(along - a, across) <= r;
}

// Colour of the logo at logo-space point (u, v); null = background.
function logoAt(u, v) {
  for (const [x, y, h] of EQ_BARS) {
    if (inCapsule(v, u - (x + 3.5), y, y + h, 3.5)) return EQ;
  }
  const dx = u - 400;
  const dy = v - 340;
  const r = Math.hypot(dx, dy);
  if (r < 160 || r > 240) return null;
  let theta = Math.atan2(dx, -dy);
  if (theta < 0) theta += 2 * Math.PI;
  const i = Math.round(theta / STEP) % 56;
  const off = theta - i * STEP;
  const along = r * Math.cos(off);
  const across = r * Math.sin(off);
  return inCapsule(along, across, 170, 340 - RING_TOPS[i], 3.5) ? RING : null;
}

// opts: { radius (corner, px), scale (logo size vs canvas), cx, cy (logo centre in px), unit (logo units per px) }
function sample(x, y, w, h, { radius, cx, cy, unit }) {
  if (radius > 0) {
    const ddx = Math.max(radius - x, 0, x - (w - radius));
    const ddy = Math.max(radius - y, 0, y - (h - radius));
    if (ddx * ddx + ddy * ddy > radius * radius) return [0, 0, 0, 0];
  }
  const u = 400 + (x - cx) * unit;
  const v = 340 + (y - cy) * unit;
  // soft blue halo behind the mark
  const d = Math.hypot(u - 400, v - 340) / 260;
  const halo = Math.max(0, 0.35 * (1 - d));
  let color = BG.map((c, k) => c + (RING[k] - c) * halo);
  const hit = logoAt(u, v);
  if (hit) color = hit;
  return [...color, 255];
}

function render(w, h, opts) {
  const buf = Buffer.alloc(w * h * 4);
  const ss = 3; // 3x3 supersampling for smooth edges
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const c = sample(x + (sx + 0.5) / ss, y + (sy + 0.5) / ss, w, h, opts);
          acc[0] += c[0] * c[3]; acc[1] += c[1] * c[3]; acc[2] += c[2] * c[3]; acc[3] += c[3];
        }
      }
      const i = (y * w + x) * 4;
      const a = acc[3] / (ss * ss);
      buf[i] = a ? Math.round(acc[0] / acc[3]) : 0;
      buf[i + 1] = a ? Math.round(acc[1] / acc[3]) : 0;
      buf[i + 2] = a ? Math.round(acc[2] / acc[3]) : 0;
      buf[i + 3] = Math.round(a);
    }
  }
  return png(w, h, buf);
}

// The mark spans about 480 logo units; "fill" is how much of the icon it covers.
function icon(size, { maskable = false, rounded = true } = {}) {
  const fill = maskable ? 0.62 : 0.86;
  return render(size, size, { radius: rounded && !maskable ? size * 0.22 : 0, cx: size / 2, cy: size / 2, unit: 480 / (size * fill) });
}

fs.mkdirSync(OUT, { recursive: true });
const files = {
  'icon-192.png': icon(192),
  'icon-512.png': icon(512),
  'icon-maskable-512.png': icon(512, { maskable: true }),
  'apple-touch-icon.png': icon(180, { rounded: false }),
  'og-default.png': render(1200, 630, { radius: 0, cx: 600, cy: 315, unit: 480 / 520 }),
};
for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), data);
  console.log(`wrote public/icons/${name} (${Math.round(data.length / 1024)} KB)`);
}
