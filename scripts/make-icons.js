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
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const BLUE_A = hex('#5278ff');
const BLUE_B = hex('#173eae');
const BLUE_C = hex('#101a47');
const DISC = hex('#0b0f1d');
const GROOVE = hex('#26304c');
const LABEL = hex('#355fff');
const HOLE = hex('#080b14');

function gradient(t) {
  return t < 0.55 ? mix(BLUE_A, BLUE_B, t / 0.55) : mix(BLUE_B, BLUE_C, (t - 0.55) / 0.45);
}

// Returns [r,g,b,a] for a point. `disc` = { cx, cy, r } in pixels.
function sample(x, y, w, h, { radius, disc, fullBleed }) {
  // rounded-rect mask
  if (!fullBleed && radius > 0) {
    const dx = Math.max(radius - x, 0, x - (w - radius));
    const dy = Math.max(radius - y, 0, y - (h - radius));
    if (dx * dx + dy * dy > radius * radius) return [0, 0, 0, 0];
  }
  let color = gradient((x / w + y / h) / 2);
  const d = Math.hypot(x - disc.cx, y - disc.cy) / disc.r; // 0..1 inside disc
  if (d <= 1) {
    color = DISC;
    const ring = (d * 190) % 14;
    if (d > 0.5 && d < 0.95 && ring < 1.2) color = GROOVE;
    if (d <= 84 / 190) color = LABEL;
    if (d <= 12 / 190) color = HOLE;
  }
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

function icon(size, { maskable = false, fullBleed = false } = {}) {
  const scale = maskable ? 0.72 : 1; // maskable icons need a safe zone
  return render(size, size, {
    radius: size * (112 / 512),
    fullBleed: maskable || fullBleed,
    disc: { cx: size / 2, cy: size / 2, r: size * (190 / 512) * scale },
  });
}

fs.mkdirSync(OUT, { recursive: true });
const files = {
  'icon-192.png': icon(192),
  'icon-512.png': icon(512),
  'icon-maskable-512.png': icon(512, { maskable: true }),
  'apple-touch-icon.png': icon(180, { fullBleed: true }),
  'og-default.png': render(1200, 630, { radius: 0, fullBleed: true, disc: { cx: 860, cy: 315, r: 260 } }),
};
for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), data);
  console.log(`wrote public/icons/${name} (${Math.round(data.length / 1024)} KB)`);
}
