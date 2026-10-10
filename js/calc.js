// Heart-rate maths: zones (heart-rate reserve), calories (Keytel 2005), HRV (RMSSD).

// Tanaka formula unless the user set their own max.
export const maxHr = (p) => p.maxHr || Math.round(208 - 0.7 * p.age);

// Lower bound of each zone as a fraction of heart-rate reserve (Karvonen).
export const ZONES = [
  { name: 'Light', lo: 0 },
  { name: 'Warm-up', lo: 0.5 },
  { name: 'Easy', lo: 0.6 },
  { name: 'Aerobic', lo: 0.7 },
  { name: 'Threshold', lo: 0.8 },
  { name: 'Max', lo: 0.9 },
];

export function zoneIndex(hr, p) {
  const r = (hr - p.restHr) / Math.max(1, maxHr(p) - p.restHr);
  let i = 0;
  ZONES.forEach((z, k) => { if (r >= z.lo) i = k; });
  return i;
}

export const zoneBpm = (i, p) => Math.round(p.restHr + ZONES[i].lo * (maxHr(p) - p.restHr));

export function kcalPerMin(hr, p) {
  const { weight: w, age: a, sex } = p;
  const v = sex === 'female'
    ? -20.4022 + 0.4472 * hr - 0.1263 * w + 0.074 * a
    : -55.0969 + 0.6309 * hr + 0.1988 * w + 0.2017 * a;
  return Math.max(0, v / 4.184);
}

// RMSSD in ms from beat-to-beat (RR) intervals.
export function rmssd(rr) {
  if (rr.length < 10) return null;
  let s = 0;
  for (let i = 1; i < rr.length; i++) s += (rr[i] - rr[i - 1]) ** 2;
  return Math.round(Math.sqrt(s / (rr.length - 1)));
}

// samples: [[secondsFromStart, bpm], ...]. Gaps over 5 s count as 5 s so a dropout doesn't inflate zones.
export function summarize(samples, p) {
  if (!samples.length) return null;
  let sum = 0, max = 0, min = Infinity, kcal = 0;
  const zones = ZONES.map(() => 0);
  samples.forEach(([t, hr], i) => {
    const dt = i ? Math.min(5, t - samples[i - 1][0]) : 1;
    sum += hr; max = Math.max(max, hr); min = Math.min(min, hr);
    kcal += (kcalPerMin(hr, p) * dt) / 60;
    zones[zoneIndex(hr, p)] += dt;
  });
  return { avg: Math.round(sum / samples.length), max, min, kcal: Math.round(kcal), zones, duration: samples.at(-1)[0] };
}

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Today's value against a baseline: z-score, so "normal for you" is 0.
export function zScore(value, series) {
  if (value == null || series.length < 5) return null;
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const sd = Math.sqrt(series.reduce((a, b) => a + (b - mean) ** 2, 0) / series.length) || 1;
  return (value - mean) / sd;
}
