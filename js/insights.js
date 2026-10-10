// Derived stats, calibrated to the user's profile and goals (shred, strength, cardio, sleep).
import { maxHr, zScore } from './calc.js';

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sd = (a) => { const m = mean(a); return a.length > 1 ? Math.sqrt(mean(a.map((v) => (v - m) ** 2))) : null; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const sortedDays = (days) => Object.keys(days).sort();

// Series of [date, value] for one key, last n days.
export function series(days, key, n = 30) {
  return sortedDays(days).slice(-n).map((d) => [d, days[d][key]]).filter(([, v]) => v != null);
}

// Summary for a metric series: latest, averages, extremes, spread and weekly trend (least squares).
export function stats(s) {
  if (!s.length) return null;
  const vals = s.map((x) => x[1]);
  const last = s.at(-1);
  const prev7 = s.slice(-8, -1).map((x) => x[1]);
  let lo = s[0], hi = s[0];
  for (const x of s) { if (x[1] < lo[1]) lo = x; if (x[1] > hi[1]) hi = x; }
  let trend = null;
  if (s.length >= 5) {
    const t0 = Date.parse(s[0][0]);
    const xs = s.map((x) => (Date.parse(x[0]) - t0) / 864e5), mx = mean(xs), my = mean(vals);
    const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    if (den) trend = (xs.reduce((a, x, i) => a + (x - mx) * (vals[i] - my), 0) / den) * 7;
  }
  return { latest: last[1], date: last[0], avg7: mean(prev7), avg: mean(vals), sd: sd(vals), min: lo, max: hi, trend, n: s.length };
}

// ---------- Readiness: HRV and resting HR against your baseline, plus last night's sleep score
export function readiness(days, p) {
  const dates = sortedDays(days);
  const latest = [...dates].reverse().find((d) => days[d].hrv != null && days[d].rhr != null);
  if (!latest) return null;
  const prior = dates.filter((d) => d < latest).slice(-30);
  const zh = zScore(days[latest].hrv, prior.map((d) => days[d].hrv).filter((v) => v != null));
  const zr = zScore(days[latest].rhr, prior.map((d) => days[d].rhr).filter((v) => v != null));
  const sleep = sleepScore(days[latest], p)?.score;
  if (zh == null || zr == null) return { date: latest, score: null, sleep, need: 5 - prior.length };
  const score = Math.round(clamp(60 + 13 * zh - 13 * zr + (sleep != null ? (sleep - 75) * 0.3 : 0), 0, 100));
  const advice = score >= 75 ? 'Ready to push: heavy lifts or intervals'
    : score >= 55 ? 'Train normally: planned session at normal intensity'
      : score >= 40 ? 'Go lighter: technique work or easy Zone 2 cardio'
        : 'Rest day: walk, mobility, early night';
  return { date: latest, score, zh, zr, sleep, advice };
}

// ---------- Sleep score (0-100): duration vs your target, deep and REM share, efficiency, timing
export function sleepScore(d, p) {
  if (!d?.sleepMin) return null;
  const target = p.sleepTarget * 60;
  const dur = clamp(100 - Math.max(0, target - d.sleepMin) * 0.5 - Math.max(0, d.sleepMin - target - 90) * 0.2, 0, 100);
  const parts = [{ name: 'Duration', score: dur, w: 0.45 }];
  if (d.deepMin != null && d.remMin != null) {
    const deepPct = d.deepMin / d.sleepMin, remPct = d.remMin / d.sleepMin;
    parts.push({ name: 'Deep sleep', score: clamp((deepPct / 0.17) * 100, 0, 100), w: 0.2, detail: `${Math.round(deepPct * 100)}% (aim 15-20%)` });
    parts.push({ name: 'REM sleep', score: clamp((remPct / 0.22) * 100, 0, 100), w: 0.2, detail: `${Math.round(remPct * 100)}% (aim 20-25%)` });
  }
  if (d.inBedMin) {
    const eff = d.sleepMin / d.inBedMin;
    parts.push({ name: 'Efficiency', score: clamp(((eff - 0.75) / 0.17) * 100, 0, 100), w: 0.15, detail: `${Math.round(eff * 100)}% (aim 90%+)` });
  }
  const w = parts.reduce((a, x) => a + x.w, 0);
  return { score: Math.round(parts.reduce((a, x) => a + x.score * x.w, 0) / w), parts };
}

// Bedtime consistency: spread of bedtimes over the last 14 nights, in minutes.
export function bedtimeSpread(days) {
  const mins = sortedDays(days).slice(-14).map((d) => days[d].bedtime).filter((t) => t != null)
    .map((t) => { const x = new Date(t); let m = x.getHours() * 60 + x.getMinutes(); if (m < 12 * 60) m += 24 * 60; return m; });
  if (mins.length < 4) return null;
  const avg = mean(mins);
  const hh = Math.floor((avg / 60) % 24), mm = Math.round(avg % 60);
  return { sd: Math.round(sd(mins)), avg: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` };
}

// ---------- Training load: Banister TRIMP per workout, acute (7 d) vs chronic (28 d) ratio
export function trimp(w, p) {
  if (!w.avgHr || !w.duration) return 0;
  const hrr = clamp((w.avgHr - p.restHr) / (maxHr(p) - p.restHr), 0, 1);
  return (w.duration / 60) * hrr * 0.64 * Math.exp(1.92 * hrr);
}

export function trainingLoad(workouts, p) {
  const now = Date.now();
  const sum = (from) => workouts.filter((w) => w.start >= now - from * 864e5).reduce((a, w) => a + trimp(w, p), 0);
  const acute = sum(7), chronic = sum(28) / 4;
  const ratio = chronic > 0 ? acute / chronic : null;
  const status = ratio == null ? 'Needs a few weeks of workouts'
    : ratio < 0.8 ? 'Detraining: you can add volume'
      : ratio <= 1.3 ? 'Sweet spot: building fitness safely'
        : ratio <= 1.5 ? 'High: watch recovery'
          : 'Spike: injury and overreaching risk, back off';
  return { acute: Math.round(acute), chronic: Math.round(chronic), ratio, status };
}

// Weekly cardio minutes (moderate and harder) from Fitbit zones and Pulse live sessions.
export function cardioMinutes(workouts, from = 7) {
  const since = Date.now() - from * 864e5;
  let s = 0;
  for (const w of workouts.filter((x) => x.start >= since)) {
    if (w.fitbitZones) s += w.fitbitZones.Moderate + w.fitbitZones.Vigorous + w.fitbitZones.Peak;
    else if (w.summary?.zones) s += w.summary.zones.slice(3).reduce((a, b) => a + b, 0);
  }
  return Math.round(s / 60);
}

// ---------- Shred plan: from current body fat to target at a muscle-sparing pace
export function shredPlan(p, days) {
  const weight = p.weight, bf = p.bodyFat / 100, target = p.targetBodyFat / 100;
  const lean = weight * (1 - bf);
  const goalWeight = lean / (1 - target);
  const toLose = Math.max(0, weight - goalWeight);
  const weekly = weight * 0.005; // 0.5% of body weight per week keeps strength while cutting
  const weeks = toLose / weekly;
  const deficit = Math.round((weekly * 7700) / 7);
  const burns = sortedDays(days).filter((d) => d < isoToday()).slice(-7).map((d) => days[d].kcal).filter(Boolean);
  const burn = burns.length ? Math.round(mean(burns)) : null;
  return {
    lean: +lean.toFixed(1), goalWeight: +goalWeight.toFixed(1), toLose: +toLose.toFixed(1), weekly: +weekly.toFixed(2),
    weeks: Math.ceil(weeks), deficit, burn, eat: burn ? Math.round((burn - deficit) / 10) * 10 : null,
    protein: Math.round(lean * 2.4), // ~2.2-2.6 g per kg lean mass while cutting
  };
}

// ---------- Cardio fitness: Fitbit's VO2 max if available, else an HR-ratio estimate (Uth et al.)
export function vo2(days, p) {
  const fit = series(days, 'vo2', 90).at(-1);
  if (fit) return { value: fit[1], source: 'Fitbit' };
  const rhr = series(days, 'rhr', 7).map((x) => x[1]);
  if (!rhr.length) return null;
  return { value: +(15.3 * (maxHr(p) / mean(rhr))).toFixed(1), source: 'Estimate from max/resting HR' };
}

// VO2 max bands for men 20-29 (ACSM-style).
export function vo2Band(v) {
  return v >= 55 ? 'Excellent' : v >= 49 ? 'Good' : v >= 43 ? 'Average' : v >= 38 ? 'Fair' : 'Poor';
}

const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Goal-specific targets and how to read each metric.
export const METRICS = {
  rhr: { label: 'Resting HR', unit: 'bpm', dec: 0, better: 'down', note: 'Lower over weeks means your heart is getting fitter. A jump of 5+ bpm above your baseline often means poor recovery, stress, alcohol or illness.' },
  hrv: { label: 'HRV', unit: 'ms', dec: 1, better: 'up', note: 'Higher than your baseline means you recovered well. Compare only to yourself; a drop for 2-3 days in a row is a signal to ease off.' },
  sleepMin: { label: 'Sleep', unit: '', dec: 0, better: 'up', note: 'Muscle repair, fat loss and strength gains all depend on sleep. Under 7 hours raises hunger and makes a cut harder.' },
  steps: { label: 'Steps', unit: '', dec: 0, better: 'up', note: 'Daily steps are the easiest fat-loss lever: 10k+ adds about 300-400 kcal a day without hurting lifting recovery.' },
  kcal: { label: 'Calories burned', unit: 'kcal', dec: 0, better: 'up', note: 'Total daily burn from the Air (resting + activity). The shred plan subtracts your deficit from your recent average.' },
  spo2: { label: 'SpO2', unit: '%', dec: 1, better: 'up', note: 'Blood oxygen during sleep. 95-100% is normal; repeated nights under 93% are worth checking with a doctor.' },
  resp: { label: 'Breathing rate', unit: '/min', dec: 1, better: 'down', note: 'Very stable for most people. A rise of 1+ breaths/min above your baseline can be an early sign of illness or overtraining.' },
};
