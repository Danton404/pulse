// Google Health API (successor to the Fitbit Web API). Docs: https://developers.google.com/health
// Sign-in is a full-page OAuth redirect (implicit grant): it works inside an iPhone home-screen app,
// where popups don't. It gives a 1-hour access token, with no client secret and no server.
import { healthCache } from './store.js';

const SCOPES = ['activity_and_fitness', 'health_metrics_and_measurements', 'sleep']
  .map((s) => `https://www.googleapis.com/auth/googlehealth.${s}.readonly`).join(' ');
const BASE = 'https://health.googleapis.com/v4/users/me/dataTypes/';
const TOKEN_KEY = 'pulse-google-token';
const STATE_KEY = 'pulse-oauth-state';

// Daily summaries: API type, filter field (snake_case) and the value field, as returned for the Fitbit Air.
const DAILY = [
  { id: 'rhr', type: 'daily-resting-heart-rate', field: 'dailyRestingHeartRate', filter: 'daily_resting_heart_rate', value: 'beatsPerMinute' },
  { id: 'hrv', type: 'daily-heart-rate-variability', field: 'dailyHeartRateVariability', filter: 'daily_heart_rate_variability', value: 'averageHeartRateVariabilityMilliseconds' },
  { id: 'spo2', type: 'daily-oxygen-saturation', field: 'dailyOxygenSaturation', filter: 'daily_oxygen_saturation', value: 'averagePercentage' },
  { id: 'resp', type: 'daily-respiratory-rate', field: 'dailyRespiratoryRate', filter: 'daily_respiratory_rate', value: 'breathsPerMinute' },
];

export class AuthError extends Error {
  constructor() { super('Sign in to Google again.'); }
}

const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

let token = store.get(TOKEN_KEY);
if (!(token?.exp > Date.now())) token = null;

export const signedIn = () => !!token && token.exp > Date.now();

// The page itself is the redirect URI (registered in Google Cloud for localhost and GitHub Pages).
const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

export function signIn(clientId, returnTo = 'health') {
  if (!clientId) throw new Error('Add your Google OAuth client ID in Settings.');
  const state = crypto.randomUUID();
  store.set(STATE_KEY, { state, returnTo });
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri(), response_type: 'token',
    scope: SCOPES, include_granted_scopes: 'true', state,
  });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
}

// Call before routing: Google sends us back with #access_token=... or #error=...
export function handleRedirect() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.has('access_token') && !h.has('error')) return null;
  const saved = store.get(STATE_KEY);
  store.del(STATE_KEY);
  const back = `#${saved?.returnTo || 'health'}`;
  history.replaceState(null, '', location.pathname + back);
  if (h.has('error')) return { error: h.get('error') === 'access_denied' ? 'Google sign-in was cancelled.' : `Google sign-in failed: ${h.get('error')}` };
  if (!saved || saved.state !== h.get('state')) return { error: 'Sign-in response did not match. Try again.' };
  token = { value: h.get('access_token'), exp: Date.now() + (Number(h.get('expires_in') || 3600) - 60) * 1000 };
  store.set(TOKEN_KEY, token);
  return { ok: true };
}

export function signOut() {
  if (token) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.value)}`, { method: 'POST' }).catch(() => {});
  token = null;
  store.del(TOKEN_KEY);
  healthCache.clear();
}

async function api(path, init = {}) {
  if (!signedIn()) throw new AuthError();
  const r = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/json' },
  });
  if (r.status === 401) { token = null; throw new AuthError(); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `Google Health API error ${r.status}`);
  return j;
}

async function list(type, filter, maxPages = 4) {
  const out = [];
  let pageToken = '';
  for (let i = 0; i < maxPages; i++) {
    const q = new URLSearchParams({ filter });
    if (pageToken) q.set('pageToken', pageToken);
    const j = await api(`${type}/dataPoints?${q}`);
    out.push(...(j.dataPoints || []));
    pageToken = j.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const civil = (d) => ({ date: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() } });

function dateOf(v) {
  const d = v?.date;
  if (typeof d === 'string') return d.slice(0, 10);
  if (d?.year) return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
  return null;
}

const asNum = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? +v : null);

// First number in an object (for value fields not yet confirmed against real responses).
function firstNum(o) {
  for (const [k, v] of Object.entries(o || {})) {
    if (k === 'date' || /time|offset/i.test(k)) continue;
    const n = asNum(v);
    if (n != null) return n;
    if (v && typeof v === 'object' && !Array.isArray(v)) { const r = firstNum(v); if (r != null) return r; }
  }
  return null;
}

const secs = (d) => (d ? parseFloat(d) : null); // "1792.800s" -> 1792.8

// Heart rate in fixed windows: [[startMs, avg, min, max], ...] oldest first.
export async function fetchHrRange(start, end, windowSec = 300) {
  const j = await api('heart-rate/dataPoints:rollUp', {
    method: 'POST',
    body: JSON.stringify({ range: { startTime: start.toISOString(), endTime: end.toISOString() }, windowSize: `${windowSec}s`, pageSize: 10000 }),
  });
  return (j.rollupDataPoints || [])
    .filter((p) => p.heartRate?.beatsPerMinuteAvg != null)
    .map((p) => [Date.parse(p.startTime), Math.round(p.heartRate.beatsPerMinuteAvg), p.heartRate.beatsPerMinuteMin, p.heartRate.beatsPerMinuteMax])
    .sort((a, b) => a[0] - b[0]);
}

function toWorkout(p) {
  const e = p.exercise, m = e.metricsSummary || {}, z = m.heartRateZoneDurations || {};
  const start = Date.parse(e.interval.startTime), end = Date.parse(e.interval.endTime);
  return {
    id: p.name || `fitbit-${start}`, source: 'fitbit', start, end,
    title: e.displayName || e.exerciseType?.toLowerCase().replace(/_/g, ' ') || 'Workout',
    duration: secs(e.activeDuration) ?? (end - start) / 1000,
    kcal: asNum(m.caloriesKcal), avgHr: asNum(m.averageHeartRateBeatsPerMinute), azm: asNum(m.activeZoneMinutes),
    steps: asNum(m.steps), distanceKm: m.distanceMillimeters ? m.distanceMillimeters / 1e6 : null,
    fitbitZones: { Light: secs(z.lightTime) || 0, Moderate: secs(z.moderateTime) || 0, Vigorous: secs(z.vigorousTime) || 0, Peak: secs(z.peakTime) || 0 },
  };
}

// Today's heart rate (5-minute windows) and the latest single reading.
async function todayHr() {
  const now = new Date(), midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const since = new Date(now.getTime() - 6 * 3600e3).toISOString();
  const [today, j] = await Promise.all([
    fetchHrRange(midnight, now),
    api(`heart-rate/dataPoints?${new URLSearchParams({ pageSize: '1', filter: `heart_rate.sample_time.physical_time >= "${since}"` })}`),
  ]);
  const h = j.dataPoints?.[0]?.heartRate;
  return { today, latest: h ? { bpm: asNum(h.beatsPerMinute), t: Date.parse(h.sampleTime.physicalTime) } : undefined };
}

// Light refresh for the open app (every minute): only today's heart rate.
export async function refreshToday() {
  const r = await todayHr();
  const cache = healthCache.get();
  if (!cache) return null;
  Object.assign(cache, r);
  healthCache.set(cache);
  return cache;
}

// Pulls the last `days` days into { days: { 'YYYY-MM-DD': { rhr, hrv, spo2, resp, sleepMin, steps } }, today, latest, exercises, errors }.
export async function fetchHealth(days = 90) {
  const end = new Date();
  const start = new Date(end); start.setDate(start.getDate() - days);
  const from = isoDay(start);
  const out = {};
  const errors = [];
  const day = (d) => (out[d] ||= {});

  const tasks = DAILY.map(async (m) => {
    const pts = await list(m.type, `${m.filter}.date >= "${from}"`);
    for (const p of pts) {
      const v = p[m.field];
      const d = dateOf(v), n = asNum(v?.[m.value]);
      if (d && n != null) day(d)[m.id] = Math.round(n * 10) / 10;
    }
  });

  tasks.push((async () => {
    const pts = await list('sleep', `sleep.interval.civil_end_time >= "${from}"`, 6);
    for (const p of pts) {
      const s = p.sleep;
      if (!s?.interval) continue;
      const endT = new Date(s.interval.endTime), startT = new Date(s.interval.startTime);
      const mins = asNum(s.summary?.minutesAsleep) ?? Math.round((endT - startT) / 60000);
      const d = day(isoDay(endT)); // naps add to the day they end on
      d.sleepMin = (d.sleepMin || 0) + mins;
      if (s.metadata?.mainSleep) {
        const st = Object.fromEntries((s.summary?.stagesSummary || []).map((x) => [x.type, asNum(x.minutes)]));
        Object.assign(d, {
          deepMin: st.DEEP, remMin: st.REM, lightMin: st.LIGHT, awakeMin: st.AWAKE,
          inBedMin: asNum(s.summary?.minutesInSleepPeriod), bedtime: startT.getTime(), wake: endT.getTime(),
        });
      }
    }
  })());

  tasks.push((async () => {
    const tomorrow = new Date(end); tomorrow.setDate(end.getDate() + 1);
    const j = await api('steps/dataPoints:dailyRollUp', {
      method: 'POST',
      // range is capped at 90 days including today
      body: JSON.stringify({ range: { start: civil(new Date(end.getTime() - 89 * 864e5)), end: civil(tomorrow) }, windowSizeDays: 1 }),
    });
    for (const p of j.rollupDataPoints || []) {
      const d = dateOf(p.civilStartTime);
      const n = asNum(p.steps?.countSum);
      if (d && n != null) day(d).steps = n;
    }
  })());

  // Total daily calorie burn (API allows 14 days per request)
  tasks.push((async () => {
    const s14 = new Date(end); s14.setDate(end.getDate() - 13);
    const tomorrow = new Date(end); tomorrow.setDate(end.getDate() + 1);
    const j = await api('total-calories/dataPoints:dailyRollUp', {
      method: 'POST', body: JSON.stringify({ range: { start: civil(s14), end: civil(tomorrow) }, windowSizeDays: 1 }),
    });
    for (const p of j.rollupDataPoints || []) {
      const d = dateOf(p.civilStartTime), n = firstNum(p.totalCalories ?? p);
      if (d && n) day(d).kcal = Math.round(n);
    }
  })());
  tasks.push(list('daily-vo2-max', `daily_vo2_max.date >= "${from}"`).then((pts) => {
    for (const p of pts) { const v = p.dailyVo2Max, d = dateOf(v), n = firstNum(v); if (d && n) day(d).vo2 = Math.round(n * 10) / 10; }
  }).catch(() => {})); // optional

  const extra = {};
  // Latest logged weight and body fat, if any (e.g. from a smart scale)
  tasks.push(api('weight/dataPoints?pageSize=1').then((j) => {
    const w = j.dataPoints?.[0]?.weight; const n = firstNum(w);
    if (n) extra.weightKg = n > 1000 ? n / 1000 : n; // grams or kg
  }).catch(() => {}));
  tasks.push(api('body-fat/dataPoints?pageSize=1').then((j) => {
    const n = firstNum(j.dataPoints?.[0]?.bodyFat); if (n) extra.bodyFatPct = n;
  }).catch(() => {}));
  tasks.push(todayHr().then((r) => Object.assign(extra, r)));
  tasks.push(list('exercise', `exercise.interval.civil_start_time >= "${from}"`, 4).then((pts) => {
    extra.exercises = pts.filter((p) => p.exercise?.interval).map(toWorkout);
  }));

  const names = ['resting HR', 'HRV', 'SpO2', 'respiratory rate', 'sleep', 'steps', 'calories', 'VO2 max', 'weight', 'body fat', "today's heart rate", 'workouts'];
  const results = await Promise.allSettled(tasks);
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      if (r.reason instanceof AuthError) throw r.reason;
      errors.push(`${names[i]}: ${r.reason.message}`);
    }
  });
  const data = { fetchedAt: Date.now(), days: out, ...extra, errors };
  healthCache.set(data);
  return data;
}
