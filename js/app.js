import { settings, saveSettings, workouts, healthCache } from './store.js';
import { ble, connect, reconnect, disconnect } from './ble.js';
import { ZONES, maxHr, zoneIndex, zoneBpm, summarize, rmssd, fmtDuration, zScore } from './calc.js';
import { signIn, signOut, signedIn, fetchHealth, fetchHrRange, handleRedirect, AuthError, isoDay } from './health.js';
import { askClaude, MODELS } from './ai.js';

// ---------- Helpers
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = (n, d = 0) => (n == null ? '--' : new Intl.NumberFormat(undefined, { maximumFractionDigits: d }).format(n));
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const alpha = (color, a) => color.replace(/\)$/, ` / ${a})`);
const fmtSleep = (m) => (m == null ? '--' : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`);
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (t) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const ICONS = {
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
  timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  settings: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  bluetooth: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  stop: '<rect width="14" height="14" x="5" y="5" rx="2"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
};
const icon = (n, s = 22) => `<svg class="i" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

// Today first; Live only where Web Bluetooth exists (not on iPhone).
const TABS = [
  { id: 'health', label: 'Today', icon: 'activity' },
  ...(ble.supported ? [{ id: 'live', label: 'Live', icon: 'heart' }] : []),
  { id: 'workouts', label: 'Workouts', icon: 'timer' },
  { id: 'coach', label: 'Coach', icon: 'sparkles' },
];
const isIos = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const fmtAgo = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`; };
const ACTIVITIES = ['Run', 'Ride', 'Walk', 'Strength', 'HIIT', 'Yoga', 'Other'];

// ---------- Toasts and sheet
function toast(msg, action) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  $('#toasts').append(el);
  const done = () => el.remove();
  if (action) el.querySelector('button').onclick = () => { action.run(); done(); };
  setTimeout(done, action ? 6000 : 3500);
}

const sheet = $('#sheet');
function openSheet(title, body, bind) {
  sheet.innerHTML = `<div class="sheet-inner"><div class="sheet-head"><h2>${esc(title)}</h2>
    <button class="icon-btn" type="button" data-close aria-label="Close">${icon('x')}</button></div>${body}</div>`;
  sheet.querySelector('[data-close]').onclick = () => sheet.close();
  bind?.(sheet);
  sheet.showModal();
}
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

// ---------- Charts (canvas, no library)
function drawLine(canvas, pts, { min, max, labels = false, fill = true } = {}) {
  const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  c.clearRect(0, 0, w, h);
  if (pts.length < 2) return;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  y0 = min ?? y0 - 5; y1 = max ?? y1 + 5;
  const left = labels ? 32 : 0, pad = 6;
  const X = (x) => left + ((x - x0) / (x1 - x0 || 1)) * (w - left);
  const Y = (y) => h - pad - ((y - y0) / (y1 - y0 || 1)) * (h - 2 * pad);
  if (labels) {
    c.font = '11px Inter, system-ui, sans-serif';
    c.fillStyle = css('--muted'); c.strokeStyle = css('--grid'); c.lineWidth = 1;
    for (const v of [y0, (y0 + y1) / 2, y1]) {
      const y = Math.round(Y(v)) + 0.5;
      c.beginPath(); c.moveTo(left, y); c.lineTo(w, y); c.stroke();
      c.fillText(Math.round(v), 0, Math.min(h - 2, Math.max(10, y + 4)));
    }
  }
  const color = css('--accent');
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y))));
  c.strokeStyle = color; c.lineWidth = 2; c.lineJoin = 'round'; c.stroke();
  if (fill) {
    c.lineTo(X(x1), h); c.lineTo(X(x0), h); c.closePath();
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, alpha(color, 0.22)); g.addColorStop(1, alpha(color, 0));
    c.fillStyle = g; c.fill();
  }
}

function downsample(pts, n = 600) {
  if (pts.length <= n) return pts;
  const step = pts.length / n, out = [];
  for (let i = 0; i < n; i++) out.push(pts[Math.floor(i * step)]);
  return out;
}

function zonesHtml(secs) {
  const total = secs.reduce((a, b) => a + b, 0) || 1;
  return `<div class="zones">${ZONES.map((z, i) => `
    <div class="zone-row"><span>${z.name}</span>
      <div class="zone-track"><div class="zone-fill" style="width:${(secs[i] / total) * 100}%;background:var(--z${i})"></div></div>
      <span class="num">${fmtDuration(secs[i])}</span></div>`).join('')}</div>`;
}

// ---------- Live state
const live = { hr: null, at: 0, contact: true, buf: [], rr: [], session: null, lastAlert: 0, wake: null };
let actx;

function beep() {
  try {
    actx ||= new AudioContext();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.2, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.4);
    o.connect(g).connect(actx.destination);
    o.start(); o.stop(actx.currentTime + 0.4);
  } catch {}
}

function checkAlert(hr) {
  const { high, low, sound } = settings.alerts;
  if (Date.now() - live.lastAlert < 30000) return;
  const msg = high && hr >= high ? `Heart rate high: ${hr} bpm` : low && hr <= low ? `Heart rate low: ${hr} bpm` : null;
  if (!msg) return;
  live.lastAlert = Date.now();
  toast(msg);
  if (sound) beep();
  navigator.vibrate?.(300);
}

ble.on((e) => {
  if (e.type === 'hr') {
    live.hr = e.hr; live.at = e.t; live.contact = e.contact;
    live.buf.push([e.t, e.hr]);
    while (live.buf.length && live.buf[0][0] < e.t - 10 * 60e3) live.buf.shift();
    if (e.rr.length) { live.rr.push(...e.rr); if (live.rr.length > 120) live.rr.splice(0, live.rr.length - 120); }
    if (live.session) {
      live.session.samples.push([Math.round((e.t - live.session.start) / 1000), e.hr]);
      if (e.rr.length) live.session.rr.push(...e.rr);
    }
    checkAlert(e.hr);
    if (view === 'live') updateLive();
  } else {
    renderConn();
    if (view === 'live') renderLive();
  }
});

function renderConn() {
  const map = {
    idle: ['', 'Not connected'], connecting: ['warn', 'Connecting'], connected: ['on', ble.name || 'Connected'],
    reconnecting: ['warn', 'Reconnecting'], lost: ['', 'Connection lost'],
  };
  const [cls, text] = map[ble.state];
  const el = $('#conn');
  el.hidden = !ble.supported; // no Bluetooth on iPhone, so no connection status to show
  el.className = `status ${cls}`;
  el.innerHTML = `<span class="dot"></span><span>${esc(text)}</span>`;
}

function finalize(s) {
  return {
    id: s.id, title: s.title, start: s.start, end: s.start + (s.samples.at(-1)?.[0] || 0) * 1000,
    samples: s.samples, rmssd: rmssd(s.rr), summary: summarize(s.samples, settings.profile),
  };
}

async function startSession(title) {
  live.session = { id: crypto.randomUUID(), title, start: Date.now(), samples: [], rr: [] };
  try { live.wake = await navigator.wakeLock?.request('screen'); } catch {}
  renderLive();
}

async function stopSession() {
  const s = live.session;
  live.session = null;
  live.wake?.release?.(); live.wake = null;
  if (s.samples.length < 30) {
    await workouts.del(s.id).catch(() => {});
    toast('Under 30 seconds of data, not saved.');
  } else {
    await workouts.put(finalize(s));
    toast('Workout saved.');
  }
  renderLive();
}

// Save the running workout every 30 s so a crash or closed tab loses at most 30 s.
setInterval(() => {
  if (live.session?.samples.length) workouts.put({ ...finalize(live.session), active: true }).catch(() => {});
}, 30000);

// ---------- Live view
function renderLive() {
  const p = settings.profile;
  const connected = ble.state === 'connected';
  const s = live.session;
  const zoneTable = ZONES.map((z, i) => `
    <div class="zone-row"><span>${z.name}</span>
      <div class="zone-track"><div class="zone-fill" style="width:100%;background:var(--z${i})"></div></div>
      <span class="num">${i ? `${zoneBpm(i, p)}+` : `&lt;${zoneBpm(1, p)}`}</span></div>`).join('');

  const connectCard = !ble.supported
    ? `<section class="card empty"><h2>Bluetooth isn't available in this browser</h2>
        <p class="muted">Live heart rate uses Web Bluetooth. Safari and every other iPhone browser except one don't support it.</p>
        <ol><li>On iPhone: install the free <a href="https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055" target="_blank" rel="noopener">Bluefy</a> browser and open Pulse in it.</li>
        <li>On a Mac or Android: use Chrome.</li>
        <li>In the Google Health app: Fitbit Air settings, Connections, turn on Share heart rate.</li></ol></section>`
    : '';

  $('#view').innerHTML = `${connectCard}
    <section class="card live-hero" ${ble.supported ? '' : 'hidden'}>
      <div class="bpm-row">
        <div><span class="eyebrow">Heart rate</span>
          <div id="bpm" class="bpm"><span id="bpm-val">--</span><span class="unit">bpm</span></div></div>
        <div id="zone" class="zone-pill"><span class="zone-dot" style="background:var(--z0)"></span><span>No signal</span></div>
      </div>
      <canvas id="live-chart" class="chart" role="img" aria-label="Heart rate over the last 10 minutes"></canvas>
      <div class="mini-stats">
        <div><strong id="s-min">--</strong><span>Min, 10 min</span></div>
        <div><strong id="s-avg">--</strong><span>Avg, 10 min</span></div>
        <div><strong id="s-max">--</strong><span>Max, 10 min</span></div>
        <div><strong id="s-hrv">--</strong><span>HRV (RMSSD)</span></div>
      </div>
      <div class="btn-row">
        ${connected || ble.state === 'reconnecting'
          ? `<button id="disc" class="btn small" type="button">Disconnect</button>`
          : `<button id="conn-btn" class="btn ${ble.state === 'lost' ? '' : 'primary'}" type="button" ${ble.state === 'connecting' ? 'disabled' : ''}>${icon('bluetooth', 18)} ${ble.state === 'lost' ? 'Reconnect' : 'Connect Fitbit Air'}</button>`}
        ${ble.state === 'lost' ? `<button id="conn-new" class="btn primary" type="button">Pick device</button>` : ''}
      </div>
      ${!connected && ble.state !== 'reconnecting' ? `<p class="hint">First turn on Share heart rate for the Air in the Google Health app (Connections), then connect here.</p>` : ''}
    </section>
    <section class="card" ${ble.supported ? '' : 'hidden'}>
      ${s ? `<div class="session-bar">
          <div><span class="eyebrow">${esc(s.title)} in progress</span><div id="timer" class="timer">0:00</div></div>
          <div class="mini-stats" style="flex:1;min-width:200px;grid-template-columns:repeat(3,1fr)">
            <div><strong id="w-avg">--</strong><span>Avg bpm</span></div>
            <div><strong id="w-max">--</strong><span>Max bpm</span></div>
            <div><strong id="w-kcal">--</strong><span>kcal</span></div></div>
          <button id="stop" class="btn primary" type="button">${icon('stop', 18)} Finish</button></div>`
        : `<div class="session-bar"><div class="field" style="flex:1;min-width:160px"><label for="act">Workout type</label>
            <select id="act">${ACTIVITIES.map((a) => `<option>${a}</option>`).join('')}</select></div>
            <button id="start" class="btn primary" type="button" ${connected ? '' : 'disabled'}>${icon('play', 18)} Start workout</button></div>
            ${connected ? '' : '<p class="hint" style="margin-top:8px">Connect the Air to record a workout.</p>'}`}
    </section>
    <section class="card">
      <div class="card-head"><h2>Your zones</h2><span class="muted small num">Rest ${p.restHr} · Max ${maxHr(p)} bpm</span></div>
      ${zoneTable}
    </section>`;

  $('#conn-btn')?.addEventListener('click', async () => {
    try { actx ||= new AudioContext(); actx.resume(); } catch {}
    try { ble.state === 'lost' ? await reconnect() : await connect(); }
    catch (e) { if (e.name !== 'NotFoundError') toast(e.message); }
  });
  $('#conn-new')?.addEventListener('click', () => connect().catch((e) => e.name !== 'NotFoundError' && toast(e.message)));
  $('#disc')?.addEventListener('click', () => {
    if (live.session) return toast('Finish the workout first.');
    disconnect();
  });
  $('#start')?.addEventListener('click', () => startSession($('#act').value));
  $('#stop')?.addEventListener('click', stopSession);
  updateLive();
}

function updateLive() {
  const p = settings.profile;
  const el = $('#bpm-val');
  if (!el) return;
  const fresh = live.hr != null && Date.now() - live.at < 5000;
  el.textContent = fresh ? live.hr : '--';
  $('#bpm').classList.toggle('stale', !fresh);
  if (fresh) {
    const zi = zoneIndex(live.hr, p);
    $('#zone').innerHTML = `<span class="zone-dot" style="background:var(--z${zi})"></span><span>${live.contact ? ZONES[zi].name : 'Check fit: no skin contact'}</span>`;
  } else {
    $('#zone').innerHTML = `<span class="zone-dot" style="background:var(--z0)"></span><span>${ble.state === 'connected' ? 'Waiting for data' : 'No signal'}</span>`;
  }
  const vals = live.buf.map((x) => x[1]);
  $('#s-min').textContent = vals.length ? Math.min(...vals) : '--';
  $('#s-max').textContent = vals.length ? Math.max(...vals) : '--';
  $('#s-avg').textContent = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : '--';
  const h = rmssd(live.rr);
  $('#s-hrv').textContent = h != null ? `${h} ms` : '--';
  drawLine($('#live-chart'), live.buf.map(([t, v]) => [t, v]), { labels: true });
  if (live.session && $('#timer')) {
    const sum = summarize(live.session.samples, p);
    $('#timer').textContent = fmtDuration((Date.now() - live.session.start) / 1000);
    $('#w-avg').textContent = sum?.avg ?? '--';
    $('#w-max').textContent = sum?.max ?? '--';
    $('#w-kcal').textContent = sum?.kcal ?? '--';
  }
}

// ---------- Workouts view
// Local sessions (recorded live over Bluetooth) and workouts the Air recorded (from Google Health), as one list.
function workoutRows(local) {
  const fitbit = healthCache.get()?.exercises || [];
  return [
    ...local.map((w) => ({ ...w, source: 'pulse', duration: w.summary?.duration || 0, avgHr: w.summary?.avg, kcal: w.summary?.kcal })),
    ...fitbit,
  ].sort((x, y) => y.start - x.start);
}

async function renderWorkouts() {
  $('#view').innerHTML = `<section class="card"><div class="skeleton" style="height:120px"></div></section>`;
  let all;
  try { all = workoutRows((await workouts.all()).filter((w) => !w.active)); }
  catch (e) {
    $('#view').innerHTML = `<section class="card error empty"><h2>Couldn't open saved workouts</h2><p class="muted">${esc(e.message)}</p>
      <button class="btn" type="button" id="retry">Try again</button></section>`;
    $('#retry').onclick = renderWorkouts;
    return;
  }
  if (!all.length) {
    $('#view').innerHTML = `<section class="card empty"><h2>No workouts yet</h2>
      <p class="muted">Workouts your Air records show up here once it syncs and you're signed in on Today.${ble.supported ? ' You can also record one with live heart rate on the Live tab.' : ''}</p>
      <a class="btn primary" href="#health">Go to Today</a></section>`;
    return;
  }
  const week = all.filter((w) => w.start >= Date.now() - 7 * 864e5);
  const hrs = week.filter((w) => w.avgHr);
  $('#view').innerHTML = `
    <section class="card"><div class="card-head"><h2>Last 7 days</h2></div>
      <div class="mini-stats">
        <div><strong>${week.length}</strong><span>Workouts</span></div>
        <div><strong>${fmtDuration(week.reduce((a, w) => a + (w.duration || 0), 0))}</strong><span>Time</span></div>
        <div><strong>${nf(week.reduce((a, w) => a + (w.kcal || 0), 0))}</strong><span>kcal</span></div>
        <div><strong>${hrs.length ? Math.round(hrs.reduce((a, w) => a + w.avgHr, 0) / hrs.length) : '--'}</strong><span>Avg bpm</span></div>
      </div></section>
    <section class="card"><div class="list">${all.map((w) => `
      <button class="row" type="button" data-id="${esc(w.id)}">
        <div><strong>${esc(w.title)}</strong><div class="muted small">${fmtDate(w.start)}, ${fmtTime(w.start)} · ${w.source === 'fitbit' ? 'Fitbit Air' : 'Pulse live'}</div></div>
        <div class="right"><div>${fmtDuration(w.duration)}</div><div class="muted small">${w.avgHr ?? '--'} bpm avg · ${nf(w.kcal)} kcal</div></div>
      </button>`).join('')}</div></section>`;
  $('#view').querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => {
    const w = all.find((x) => x.id === b.dataset.id);
    w.source === 'fitbit' ? openFitbitWorkout(w) : openWorkout(w);
  }));
}

function barsHtml(obj) {
  const entries = Object.entries(obj), total = entries.reduce((a, [, v]) => a + v, 0) || 1;
  return `<div class="zones">${entries.map(([name, v], i) => `
    <div class="zone-row"><span>${name}</span>
      <div class="zone-track"><div class="zone-fill" style="width:${(v / total) * 100}%;background:var(--z${i + 2})"></div></div>
      <span class="num">${fmtDuration(v)}</span></div>`).join('')}</div>`;
}

function openFitbitWorkout(w) {
  const extra = [
    w.distanceKm ? `<div><strong>${nf(w.distanceKm, 2)}</strong><span>km</span></div>` : '',
    w.steps ? `<div><strong>${nf(w.steps)}</strong><span>Steps</span></div>` : '',
    w.azm ? `<div><strong>${w.azm}</strong><span>Zone min</span></div>` : '',
  ].join('');
  openSheet(`${w.title}, ${fmtDate(w.start)}`, `
    <div id="w-hr"><div class="skeleton" style="height:200px"></div></div>
    <div class="mini-stats">
      <div><strong>${fmtDuration(w.duration)}</strong><span>Duration</span></div>
      <div><strong>${w.avgHr ?? '--'}</strong><span>Avg bpm</span></div>
      <div><strong>${nf(w.kcal)}</strong><span>kcal</span></div>
      ${extra}
    </div>
    <div><h3 style="margin-bottom:8px">Heart rate zones (Fitbit)</h3>${barsHtml(w.fitbitZones)}</div>
    <p class="hint">${fmtTime(w.start)} to ${fmtTime(w.end)}, recorded by the Fitbit Air.</p>`, async (el) => {
    const box = el.querySelector('#w-hr');
    if (!signedIn()) { box.innerHTML = '<p class="hint">Sign in on Today to see the heart-rate chart.</p>'; return; }
    try {
      const pts = await fetchHrRange(new Date(w.start), new Date(w.end), 30);
      if (!pts.length) { box.innerHTML = '<p class="hint">No heart-rate samples for this workout.</p>'; return; }
      box.innerHTML = '<canvas class="chart tall" role="img" aria-label="Heart rate during the workout"></canvas>';
      const max = Math.max(...pts.map((p) => p[3] ?? p[1]));
      box.insertAdjacentHTML('beforeend', `<p class="small muted">Max ${max} bpm</p>`);
      requestAnimationFrame(() => drawLine(box.querySelector('canvas'), pts.map(([t, v]) => [t, v]), { labels: true }));
    } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
  });
}

function openWorkout(w) {
  const s = w.summary;
  openSheet(`${w.title}, ${fmtDate(w.start)}`, `
    <canvas class="chart tall" id="w-chart" role="img" aria-label="Heart rate during the workout"></canvas>
    <div class="mini-stats">
      <div><strong>${fmtDuration(s.duration)}</strong><span>Duration</span></div>
      <div><strong>${s.avg}</strong><span>Avg bpm</span></div>
      <div><strong>${s.max}</strong><span>Max bpm</span></div>
      <div><strong>${nf(s.kcal)}</strong><span>kcal (est.)</span></div>
    </div>
    ${w.rmssd ? `<p class="small muted">HRV during workout (RMSSD): ${w.rmssd} ms</p>` : ''}
    <div><h3 style="margin-bottom:8px">Time in zones</h3>${zonesHtml(s.zones)}</div>
    <button class="btn danger" type="button" id="del">${icon('trash', 18)} Delete workout</button>`, (el) => {
    requestAnimationFrame(() => drawLine(el.querySelector('#w-chart'), downsample(w.samples), { labels: true }));
    el.querySelector('#del').onclick = async () => {
      const { source, duration, avgHr, kcal, ...orig } = w;
      await workouts.del(w.id);
      sheet.close();
      renderWorkouts();
      toast('Workout deleted.', { label: 'Undo', run: async () => { await workouts.put(orig); renderWorkouts(); } });
    };
  });
}

// ---------- Health view
let healthLoading = false;

function series(days, key, n = 30) {
  return Object.keys(days).sort().slice(-n).map((d) => [d, days[d][key]]).filter(([, v]) => v != null);
}

function readiness(days) {
  const dates = Object.keys(days).sort();
  const latest = [...dates].reverse().find((d) => days[d].hrv != null && days[d].rhr != null);
  if (!latest) return null;
  const prior = dates.filter((d) => d < latest);
  const zh = zScore(days[latest].hrv, prior.map((d) => days[d].hrv).filter((v) => v != null));
  const zr = zScore(days[latest].rhr, prior.map((d) => days[d].rhr).filter((v) => v != null));
  if (zh == null || zr == null) return { date: latest, score: null };
  const sleep = days[latest].sleepMin;
  const sleepAdj = sleep ? Math.max(-10, Math.min(5, ((sleep - 450) / 60) * 5)) : 0;
  const score = Math.round(Math.max(0, Math.min(100, 65 + 12 * zh - 12 * zr + sleepAdj)));
  return { date: latest, score, zh, zr };
}

function statCard(label, key, days, unit, fmt = (v) => nf(v, 1), better = 'up') {
  const s = series(days, key);
  if (!s.length) return `<div class="card stat"><span class="eyebrow">${label}</span><div class="value muted">--</div><p class="hint">No data</p></div>`;
  const [d, v] = s.at(-1);
  // Today's steps are a running total, so compare against the 7 full days before it
  const partial = key === 'steps' && d === isoDay(new Date());
  const prev = s.slice(-8, -1).map((x) => x[1]);
  const avg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : null;
  const diff = avg != null ? v - avg : null;
  const good = diff == null || Math.abs(diff) < 1e-9 ? null : (diff > 0) === (better === 'up');
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
  return `<div class="card stat"><span class="eyebrow">${label}</span>
    <div><span class="value">${fmt(v)}</span><span class="unit">${unit}</span></div>
    <div class="delta ${good == null || partial ? 'muted' : good ? 'up' : 'down'}">${partial ? `So far today · ${prev.length}-day avg ${nf(avg)}` : diff == null ? fmtDate(d) : `${sign}${key === 'sleepMin' ? fmtSleep(Math.abs(diff)) : nf(Math.abs(diff), key === 'steps' ? 0 : 1)} vs ${prev.length === 1 ? 'yesterday' : `${prev.length}-day avg`}`}</div>
    ${key === 'sleepMin' && days[d].deepMin != null ? `<div class="delta muted">Deep ${fmtSleep(days[d].deepMin)} · REM ${fmtSleep(days[d].remMin)}</div>` : ''}
    <canvas data-key="${key}" role="img" aria-label="${label}, last 30 days"></canvas></div>`;
}

async function renderHealth(force = false) {
  const v = $('#view');
  if (!settings.google.clientId) {
    v.innerHTML = `<section class="card empty"><h2>Connect Google Health</h2>
      <p class="muted">Daily data (resting HR, HRV, sleep, SpO2, steps) comes from the Google Health API. It needs a free Google Cloud OAuth client ID, set up once.</p>
      <ol><li>Google Cloud console: create a project and enable the Google Health API.</li>
      <li>OAuth consent screen: External, Testing, add your Google account as a test user.</li>
      <li>Credentials: OAuth client ID, Web application. Add this site's address under Authorized JavaScript origins.</li>
      <li>Paste the client ID in Settings.</li></ol>
      <button class="btn primary" type="button" id="go-settings">Open Settings</button></section>`;
    $('#go-settings').onclick = openSettings;
    return;
  }
  const cache = healthCache.get();
  if (!signedIn() && !cache) {
    v.innerHTML = `<section class="card empty"><h2>Sign in to Google Health</h2>
      <p class="muted">Pulse reads your Fitbit Air data from Google (read-only). Sign-in lasts an hour; your data stays on this device.</p>
      <button class="btn primary" type="button" id="g-in">Sign in with Google</button></section>`;
    $('#g-in').onclick = () => doSignIn();
    return;
  }
  const stale = !cache || Date.now() - cache.fetchedAt > 5 * 60e3;
  if (signedIn() && (force || stale) && !healthLoading) {
    healthLoading = true;
    if (!cache) v.innerHTML = `<div class="grid">${'<div class="card"><div class="skeleton" style="height:96px"></div></div>'.repeat(6)}</div>`;
    try {
      // Keep zones accurate: resting HR follows the latest value from Google Health
      const { days } = await fetchHealth(30);
      const rhr = series(days, 'rhr').at(-1)?.[1];
      if (rhr) { settings.profile.restHr = Math.round(rhr); saveSettings(); }
    }
    catch (e) {
      healthLoading = false;
      if (e instanceof AuthError) { toast(e.message); if (!cache) return renderHealth(); }
      else if (!cache) {
        v.innerHTML = `<section class="card error empty"><h2>Couldn't load health data</h2><p class="muted">${esc(e.message)}</p>
          <button class="btn" type="button" id="retry">Try again</button></section>`;
        $('#retry').onclick = () => renderHealth(true);
        return;
      } else toast(e.message);
    }
    healthLoading = false;
    if (view !== 'health') return;
  }
  drawHealth(healthCache.get());
}

function drawHealth(data) {
  const days = data?.days || {};
  const r = readiness(days);
  const label = r?.score == null ? '' : r.score >= 75 ? 'Ready to push' : r.score >= 50 ? 'Train normally' : 'Take it easy';
  const today = data?.today || [], latest = data?.latest;
  const tMin = today.length ? Math.min(...today.map((p) => p[2] ?? p[1])) : null;
  const tMax = today.length ? Math.max(...today.map((p) => p[3] ?? p[1])) : null;
  let hideHint = false;
  try { hideHint = localStorage.getItem('pulse-hide-install') === '1'; } catch {}
  $('#view').innerHTML = `
    ${isIos && !standalone && !hideHint ? `<section class="card empty"><h2>Add Pulse to your Home Screen</h2>
      <p class="muted">In Safari, tap the Share button, then Add to Home Screen. Pulse then opens full screen like an app.</p>
      <button class="btn small" type="button" id="hide-install">Got it</button></section>` : ''}
    <section class="card">
      <div class="card-head"><div><span class="eyebrow">Heart rate</span>
        <div class="stat"><span class="value" style="font-size:36px">${latest?.bpm ?? '--'}</span><span class="unit">bpm</span></div>
        <div class="small muted">${latest ? `Latest reading, ${fmtAgo(latest.t)}` : 'No recent reading'}</div></div>
        <div class="btn-row">
          ${signedIn() ? '' : '<button class="btn small primary" type="button" id="g-in">Sign in</button>'}
          <button class="icon-btn ${healthLoading ? 'spinning' : ''}" type="button" id="h-refresh" aria-label="Refresh">${icon('refresh')}</button></div></div>
      <canvas id="today-chart" class="chart" role="img" aria-label="Heart rate today, 5-minute averages"></canvas>
      <div class="mini-stats" style="grid-template-columns:repeat(3,1fr);margin-top:8px">
        <div><strong>${tMin ?? '--'}</strong><span>Low today</span></div>
        <div><strong>${tMax ?? '--'}</strong><span>High today</span></div>
        <div><strong>${series(days, 'rhr').at(-1)?.[1] ?? '--'}</strong><span>Resting</span></div>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><div><span class="eyebrow">Readiness${r ? `, ${fmtDate(r.date + 'T12:00')}` : ''}</span>
        <div class="stat"><span class="value" style="font-size:36px">${r?.score ?? '--'}</span><span class="unit">/ 100</span></div>
        <div class="${r?.score == null ? 'muted' : r.score >= 50 ? 'up' : 'down'} small">${label || 'Needs about 5 days of HRV and resting HR'}</div></div></div>
      <p class="hint">Your HRV and resting HR today against your own 30-day baseline, nudged by last night's sleep. Higher HRV and lower resting HR score better.</p>
    </section>
    <div class="grid">
      ${statCard('Resting HR', 'rhr', days, 'bpm', (v) => nf(v), 'down')}
      ${statCard('HRV', 'hrv', days, 'ms')}
      ${statCard('Sleep', 'sleepMin', days, '', fmtSleep)}
      ${statCard('Steps', 'steps', days, '', (v) => nf(v))}
      ${statCard('SpO2', 'spo2', days, '%')}
      ${statCard('Breathing', 'resp', days, '/min', (v) => nf(v, 1), 'down')}
    </div>
    ${data?.errors?.length ? `<section class="card"><h3>Some data didn't load</h3><ul class="small muted">${data.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></section>` : ''}
    <p class="hint">Updated ${data ? fmtTime(data.fetchedAt) : 'never'}${signedIn() ? '' : ' · signed out, showing saved data'}. The Air syncs through the Google Health app on your phone; open it to sync now.</p>`;
  drawLine($('#today-chart'), today.map(([t, v]) => [t, v]), { labels: true });
  $('#hide-install')?.addEventListener('click', () => { try { localStorage.setItem('pulse-hide-install', '1'); } catch {} drawHealth(data); });
  $('#view').querySelectorAll('canvas[data-key]').forEach((c) => {
    const s = series(days, c.dataset.key).map(([d, v]) => [new Date(d).getTime(), v]);
    drawLine(c, s);
  });
  $('#h-refresh').onclick = () => (signedIn() ? renderHealth(true) : doSignIn());
  $('#g-in')?.addEventListener('click', doSignIn);
}

function doSignIn() {
  try { signIn(settings.google.clientId, view); } catch (e) { toast(e.message); }
}

// ---------- Coach view
const chat = [];
const PROMPTS = ['How recovered am I today?', 'Review my last workout', 'Plan my training for this week', 'Any trends I should know about?'];

function md(text) {
  const blocks = esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').split(/\n{2,}/);
  return blocks.map((b) => {
    const lines = b.split('\n');
    if (lines.every((l) => /^\s*[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${l.replace(/^\s*[-*] /, '')}</li>`).join('')}</ul>`;
    return `<p>${lines.join('<br>')}</p>`;
  }).join('');
}

async function coachContext() {
  const p = settings.profile;
  const ws = (await workouts.all()).filter((w) => !w.active).slice(0, 15);
  const h = healthCache.get();
  return {
    profile: { age: p.age, sex: p.sex, weightKg: p.weight, restingHr: p.restHr, maxHr: maxHr(p) },
    zones: ZONES.map((z, i) => ({ name: z.name, fromBpm: zoneBpm(i, p) })),
    recentWorkouts: ws.map((w) => ({
      date: new Date(w.start).toISOString().slice(0, 16), type: w.title, minutes: Math.round(w.summary.duration / 60),
      avgHr: w.summary.avg, maxHr: w.summary.max, kcal: w.summary.kcal, rmssdMs: w.rmssd,
      zoneMinutes: Object.fromEntries(ZONES.map((z, i) => [z.name, Math.round(w.summary.zones[i] / 60)])),
    })),
    fitbitWorkouts: (h?.exercises || []).slice(0, 15).map((w) => ({
      date: new Date(w.start).toISOString().slice(0, 16), type: w.title, minutes: Math.round(w.duration / 60),
      avgHr: w.avgHr, kcal: w.kcal, activeZoneMinutes: w.azm, steps: w.steps, distanceKm: w.distanceKm,
      zoneMinutes: Object.fromEntries(Object.entries(w.fitbitZones).map(([k, v]) => [k, Math.round(v / 60)])),
    })),
    heartRateToday: h?.today?.length ? { latest: h.latest, fiveMinuteAverages: h.today.map(([t, v]) => [new Date(t).toTimeString().slice(0, 5), v]) } : null,
    dailyHealth: h?.days || 'Google Health not connected',
    readiness: h ? readiness(h.days) : null,
    liveNow: live.hr && Date.now() - live.at < 5000 ? { bpm: live.hr, hrvRmssdMs: rmssd(live.rr) } : null,
  };
}

function renderCoach() {
  if (!settings.claude.key) {
    $('#view').innerHTML = `<section class="card empty"><h2>Add your Claude API key</h2>
      <p class="muted">The coach reads your workouts and health data and answers with your own numbers. Your key stays in this browser and is sent only to Anthropic.</p>
      <a class="btn" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Get a key</a>
      <button class="btn primary" type="button" id="go-settings">Open Settings</button></section>`;
    $('#go-settings').onclick = openSettings;
    return;
  }
  $('#view').innerHTML = `
    <div class="chips">${PROMPTS.map((q) => `<button class="chip" type="button">${esc(q)}</button>`).join('')}</div>
    <div class="msgs" id="msgs">${chat.map((m) => `<div class="msg ${m.role === 'user' ? 'user' : 'ai'}">${m.role === 'user' ? esc(m.content) : md(m.content)}</div>`).join('')}</div>
    <form class="composer" id="composer">
      <textarea id="q" rows="1" aria-label="Message" placeholder="Ask about your training, sleep or recovery"></textarea>
      <button class="btn primary" type="submit" aria-label="Send">${icon('send', 18)}</button>
    </form>`;
  $('#view').querySelectorAll('.chip').forEach((c) => (c.onclick = () => send(c.textContent)));
  $('#composer').onsubmit = (e) => { e.preventDefault(); send($('#q').value); };
  $('#q').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('#q').value); } };
}

let sending = false;
async function send(text) {
  text = text.trim();
  if (!text || sending) return;
  sending = true;
  chat.push({ role: 'user', content: text });
  renderCoach();
  $('#msgs').insertAdjacentHTML('beforeend', `<div class="msg ai" id="pending"><div class="skeleton" style="height:14px;width:180px"></div></div>`);
  $('#pending').scrollIntoView({ behavior: 'smooth', block: 'end' });
  try {
    const answer = await askClaude(chat.slice(-12), await coachContext());
    chat.push({ role: 'assistant', content: answer });
  } catch (e) {
    chat.pop();
    toast(e.message);
    if (view === 'coach') { renderCoach(); $('#q').value = text; }
    sending = false;
    return;
  }
  sending = false;
  if (view === 'coach') { renderCoach(); $('#msgs').lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }
}

// ---------- Settings
function openSettings() {
  const p = settings.profile, a = settings.alerts;
  openSheet('Settings', `
    <form class="form" id="set">
      <h3>Profile</h3>
      <div class="form-grid">
        <div class="field"><label for="age">Age</label><input id="age" type="number" inputmode="numeric" min="10" max="100" value="${p.age}"></div>
        <div class="field"><label for="sex">Sex</label><select id="sex"><option value="male" ${p.sex === 'male' ? 'selected' : ''}>Male</option><option value="female" ${p.sex === 'female' ? 'selected' : ''}>Female</option></select></div>
        <div class="field"><label for="weight">Weight (kg)</label><input id="weight" type="number" inputmode="decimal" min="30" max="250" value="${p.weight}"></div>
        <div class="field"><label for="restHr">Resting HR</label><input id="restHr" type="number" inputmode="numeric" min="30" max="120" value="${p.restHr}"></div>
        <div class="field"><label for="maxHr">Max HR</label><input id="maxHr" type="number" inputmode="numeric" min="120" max="230" placeholder="Auto: ${Math.round(208 - 0.7 * p.age)}" value="${p.maxHr ?? ''}"></div>
      </div>
      <p class="hint">Used for zones and calorie estimates. Resting HR updates from Google Health when you're signed in. Leave Max HR empty to estimate it from age.</p>
      <h3>Alerts</h3>
      <div class="form-grid">
        <div class="field"><label for="high">Alert above (bpm)</label><input id="high" type="number" inputmode="numeric" placeholder="Off" value="${a.high || ''}"></div>
        <div class="field"><label for="low">Alert below (bpm)</label><input id="low" type="number" inputmode="numeric" placeholder="Off" value="${a.low || ''}"></div>
      </div>
      <div class="field check"><input id="sound" type="checkbox" ${a.sound ? 'checked' : ''}><label for="sound">Play a sound</label></div>
      <h3>Google Health</h3>
      <div class="field"><label for="gid">OAuth client ID</label><input id="gid" type="text" autocomplete="off" spellcheck="false" placeholder="1234-abc.apps.googleusercontent.com" value="${esc(settings.google.clientId)}">
        <span class="hint">Authorized redirect URI in Google Cloud: <strong>${esc(location.origin + location.pathname.replace(/index\.html$/, ''))}</strong></span></div>
      ${signedIn() ? '<button class="btn small" type="button" id="g-out">Sign out of Google</button>' : ''}
      <h3>Claude</h3>
      <div class="field"><label for="ckey">API key</label><input id="ckey" type="password" autocomplete="off" placeholder="sk-ant-..." value="${esc(settings.claude.key)}"></div>
      <div class="field"><label for="cmodel">Model</label><select id="cmodel">${MODELS.map((m) => `<option value="${m.id}" ${m.id === settings.claude.model ? 'selected' : ''}>${m.label}</option>`).join('')}</select></div>
      <h3>Data</h3>
      <div class="btn-row"><button class="btn small" type="button" id="export">Export</button>
        <label class="btn small" for="import-file">Import</label><input id="import-file" type="file" accept="application/json" hidden></div>
      <p class="hint">Export saves your profile and workouts as JSON (no API keys).</p>
    </form>`, (el) => {
    const num = (id) => { const v = el.querySelector(id).value; return v === '' ? null : Number(v); };
    el.querySelector('#set').addEventListener('change', () => {
      Object.assign(settings.profile, { age: num('#age') || 30, sex: el.querySelector('#sex').value, weight: num('#weight') || 75, restHr: num('#restHr') || 60, maxHr: num('#maxHr') });
      Object.assign(settings.alerts, { high: num('#high') || 0, low: num('#low') || 0, sound: el.querySelector('#sound').checked });
      settings.google.clientId = el.querySelector('#gid').value.trim();
      settings.claude.key = el.querySelector('#ckey').value.trim();
      settings.claude.model = el.querySelector('#cmodel').value;
      saveSettings();
      render();
    });
    el.querySelector('#g-out')?.addEventListener('click', () => { signOut(); sheet.close(); toast('Signed out of Google.'); render(); });
    el.querySelector('#export').onclick = exportData;
    el.querySelector('#import-file').onchange = (e) => importData(e.target.files[0]);
  });
}

async function exportData() {
  const data = { app: 'pulse', version: 1, exportedAt: new Date().toISOString(), profile: settings.profile, alerts: settings.alerts, workouts: await workouts.all() };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `pulse-${isoDay(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'pulse') throw new Error('Not a Pulse export file.');
    Object.assign(settings.profile, data.profile || {});
    Object.assign(settings.alerts, data.alerts || {});
    saveSettings();
    for (const w of data.workouts || []) await workouts.put(w);
    sheet.close();
    toast(`Imported ${data.workouts?.length || 0} workouts.`);
    render();
  } catch (e) { toast(e.message); }
}

// ---------- Router
let view = 'health';
function render() {
  view = TABS.some((t) => t.id === location.hash.slice(1)) ? location.hash.slice(1) : 'health';
  const tab = TABS.find((t) => t.id === view);
  $('#view-title').textContent = tab.label;
  document.title = `${tab.label} · Pulse`;
  $('#nav').innerHTML = TABS.map((t) => `<a href="#${t.id}" ${t.id === view ? 'aria-current="page"' : ''}>${icon(t.icon)}<span>${t.label}</span></a>`).join('');
  ({ live: renderLive, workouts: renderWorkouts, health: () => renderHealth(), coach: renderCoach })[view]();
}

window.addEventListener('hashchange', render);
window.addEventListener('resize', () => { if (view === 'live') updateLive(); });
setInterval(() => { if (view === 'live') updateLive(); }, 1000);
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  if (live.session && !live.wake) {
    try { live.wake = await navigator.wakeLock?.request('screen'); } catch {}
  }
  // Coming back to the app (e.g. from the home screen): refresh if the data is older than 5 minutes
  if (view === 'health' && signedIn()) renderHealth();
});

$('#settings-btn').innerHTML = icon('settings');
$('#settings-btn').onclick = openSettings;
const auth = handleRedirect();
if (auth?.error) setTimeout(() => toast(auth.error), 300);
renderConn();
render();

// A workout still marked active means the tab closed mid-session: keep what was saved.
workouts.all().then((all) => all.filter((w) => w.active).forEach((w) => {
  delete w.active;
  workouts.put(w);
})).catch(() => {});

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
