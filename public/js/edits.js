// Non-destructive track edits (trim start/end, cut sections, fades).
// Shared by the public player and the Studio editor.
// An edit looks like: { start, end, cuts: [[a, b], ...], fadeIn, fadeOut } in seconds.

// Turns an edit into the parts that actually play ("segments") plus helpers
// to convert between real file time and edited ("virtual") time.
export function editMap(edit, rawDuration) {
  if (!edit) return null;
  const total = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : Infinity;
  const start = Math.max(0, Number(edit.start) || 0);
  const end = Math.min(Number.isFinite(Number(edit.end)) && edit.end !== null ? Number(edit.end) : total, total);
  if (!(end > start)) return null;

  const cuts = (Array.isArray(edit.cuts) ? edit.cuts : [])
    .map(([a, b]) => [Math.max(Number(a), start), Math.min(Number(b), end)])
    .filter(([a, b]) => b - a > 0.01)
    .sort((x, y) => x[0] - y[0]);

  const segments = [];
  let t = start;
  for (const [a, b] of cuts) {
    if (a > t) segments.push([t, a]);
    t = Math.max(t, b);
  }
  if (end > t) segments.push([t, end]);
  const length = segments.reduce((sum, [a, b]) => sum + (b - a), 0);

  return {
    start,
    end,
    segments,
    length,
    fadeIn: Math.min(Number(edit.fadeIn) || 0, length / 2),
    fadeOut: Math.min(Number(edit.fadeOut) || 0, length / 2),
    // real file time -> edited time
    toVirtual(raw) {
      let v = 0;
      for (const [a, b] of segments) {
        if (raw >= b) v += b - a;
        else {
          if (raw > a) v += raw - a;
          break;
        }
      }
      return v;
    },
    // edited time -> real file time
    toRaw(v) {
      let left = Math.max(0, v);
      for (const [a, b] of segments) {
        if (left <= b - a) return a + left;
        left -= b - a;
      }
      return end;
    },
    // Where playback should jump from real time `raw`:
    // null = keep playing, a number = jump there, 'end' = the edit is over.
    jump(raw) {
      for (const [a, b] of segments) {
        if (raw < a - 0.03) return a;
        if (raw < b) return null;
      }
      return 'end';
    },
    // Volume multiplier for fades at real time `raw`.
    gain(raw) {
      const v = this.toVirtual(raw);
      let g = 1;
      if (this.fadeIn > 0 && v < this.fadeIn) g = Math.min(g, v / this.fadeIn);
      if (this.fadeOut > 0 && length - v < this.fadeOut) g = Math.min(g, (length - v) / this.fadeOut);
      return Math.max(0, Math.min(1, g));
    },
  };
}

// Waveform bars for the edited version (removes trimmed/cut parts).
export function editedPeaks(peaks, map, rawDuration, count = peaks?.length || 0) {
  if (!peaks?.length || !map || !rawDuration) return peaks;
  return Array.from({ length: count }, (_, i) => {
    const raw = map.toRaw(((i + 0.5) / count) * map.length);
    return peaks[Math.min(peaks.length - 1, Math.floor((raw / rawDuration) * peaks.length))];
  });
}
