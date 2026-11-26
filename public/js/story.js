// Story share card: a 1080×1920 image (Instagram / TikTok / Facebook stories)
// with the cover, title, an LED meter made from the track's waveform and the link.

const W = 1080;
const H = 1920;

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous'; // Supabase allows this, so the canvas stays exportable
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function wrap(g, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (g.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s+\S*$/, '')}…`;
  }
  return lines;
}

function seeded(seed) {
  let x = 0;
  for (const c of String(seed)) x = (x * 31 + c.charCodeAt(0)) | 0;
  return () => {
    x = (x * 1103515245 + 12345) | 0;
    return ((x >>> 16) & 0x7fff) / 0x7fff;
  };
}

export async function makeStoryCard(track, { artist = 'Surgthflur', url, fire = false } = {}) {
  const c = fire
    ? { bg1: '#140603', bg2: '#2a0b05', glow: 'rgba(255,98,26,', accent: '#ffb37a', leds: ['#7a1205', '#a3200b', '#d1340f', '#ff5a1f', '#ff7d2e', '#ffa443', '#ffc46b', '#fff1c4'], art: ['#ff8a3d', '#c2310c'] }
    : { bg1: '#080b14', bg2: '#0d1638', glow: 'rgba(66,107,255,', accent: '#9db4ff', leds: ['#1d3fd6', '#2449e6', '#2f5bff', '#3f6cff', '#5b86ff', '#7aa4ff', '#9fd0ff', '#dff4ff'], art: ['#5278ff', '#173eae'] };

  await Promise.all([
    document.fonts?.load('700 92px "Space Grotesk"'),
    document.fonts?.load('700 36px "DM Sans"'),
  ].filter(Boolean)).catch(() => {});
  const cover = await loadImage(track.coverUrl);
  const flame = cover ? null : await loadImage('/media/flame-cover.jpg');

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');

  // Background + glow
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, c.bg1);
  bg.addColorStop(1, c.bg2);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, 760, 50, W / 2, 760, 900);
  glow.addColorStop(0, `${c.glow}0.45)`);
  glow.addColorStop(1, `${c.glow}0)`);
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // Brand
  g.textAlign = 'center';
  g.fillStyle = c.accent;
  g.font = '700 34px "DM Sans", sans-serif';
  g.letterSpacing = '10px';
  g.fillText('SURGTHFLUR - MUSIC', W / 2, 170);
  g.letterSpacing = '0px';

  // Cover with glow
  const size = 840;
  const x = (W - size) / 2;
  const y = 300;
  g.save();
  g.shadowColor = `${c.glow}0.8)`;
  g.shadowBlur = 90;
  roundRect(g, x, y, size, size, 40);
  g.fillStyle = '#000';
  g.fill();
  g.restore();
  g.save();
  roundRect(g, x, y, size, size, 40);
  g.clip();
  if (cover) {
    const scale = Math.max(size / cover.width, size / cover.height);
    const w = cover.width * scale;
    const h = cover.height * scale;
    g.drawImage(cover, x + (size - w) / 2, y + (size - h) / 2, w, h);
  } else if (flame) {
    g.filter = fire ? 'saturate(1.1)' : 'hue-rotate(195deg) saturate(1.15)'; // blue flames unless fire mode
    g.drawImage(flame, x, y, size, size);
    g.filter = 'none';
  } else {
    const art = g.createLinearGradient(x, y, x + size, y + size);
    art.addColorStop(0, c.art[0]);
    art.addColorStop(1, c.art[1]);
    g.fillStyle = art;
    g.fillRect(x, y, size, size);
    // vinyl record
    for (let r = 380; r > 120; r -= 10) {
      g.beginPath();
      g.arc(x + size * 0.68, y + size * 0.42, r, 0, Math.PI * 2);
      g.fillStyle = r % 20 ? '#0d1221' : '#222c48';
      g.fill();
    }
    g.beginPath();
    g.arc(x + size * 0.68, y + size * 0.42, 120, 0, Math.PI * 2);
    g.fillStyle = c.art[0];
    g.fill();
  }
  g.restore();
  g.lineWidth = 4;
  g.strokeStyle = `${c.glow}0.9)`;
  roundRect(g, x, y, size, size, 40);
  g.stroke();

  // Title + details
  g.fillStyle = '#ffffff';
  g.font = '700 92px "Space Grotesk", sans-serif';
  const lines = wrap(g, track.title, 920, 2);
  lines.forEach((line, i) => g.fillText(line, W / 2, 1270 + i * 100));
  g.fillStyle = c.accent;
  g.font = '700 32px "DM Sans", sans-serif';
  g.letterSpacing = '6px';
  g.fillText(`${(track.category || 'MUSIC').toUpperCase()} · ${artist.toUpperCase()}`, W / 2, 1270 + lines.length * 100 + 10);
  g.letterSpacing = '0px';

  // LED meter from the real waveform (or a pattern if there isn't one)
  const cols = 34;
  const rows = 8;
  const cell = 22;
  const gap = 6;
  const meterW = cols * cell + (cols - 1) * gap;
  const mx = (W - meterW) / 2;
  const my = 1560;
  const rand = seeded(track.id);
  const peaks = track.waveform?.length ? track.waveform : null;
  for (let col = 0; col < cols; col += 1) {
    const value = peaks ? peaks[Math.floor((col / cols) * peaks.length)] / 100 : 0.25 + rand() * 0.75;
    const lit = Math.max(1, Math.round(value * rows));
    for (let r = 0; r < rows; r += 1) {
      g.fillStyle = r < lit ? c.leds[r] : 'rgba(120,140,220,0.10)';
      roundRect(g, mx + col * (cell + gap), my + (rows - 1 - r) * (14 + 5), cell, 14, 3);
      g.fill();
    }
  }

  // Listen pill + link
  const pillW = 420;
  roundRect(g, (W - pillW) / 2, 1755, pillW, 84, 42);
  g.fillStyle = fire ? '#ff5a1f' : '#426bff';
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = '700 36px "DM Sans", sans-serif';
  g.fillText('▶  Listen now', W / 2, 1810);
  if (url) {
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.font = '500 26px "DM Sans", sans-serif';
    g.fillText(url.replace(/^https?:\/\//, ''), W / 2, 1885);
  }

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
