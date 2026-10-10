import { settings, saveSettings, workouts, healthCache } from './store.js';
import { ble, connect, reconnect, disconnect } from './ble.js';
import { ZONES, maxHr, zoneIndex, zoneBpm, summarize, rmssd, fmtDuration } from './calc.js';
import { signIn, signOut, signedIn, fetchHealth, fetchHrRange, refreshToday, handleRedirect, AuthError, isoDay } from './health.js';
import { METRICS, series, stats, sortedDays, readiness, sleepScore, bedtimeSpread, trainingLoad, trimp, cardioMinutes, shredPlan, vo2, vo2Band } from './insights.js';
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

// Same tabs on every device; where Bluetooth isn't available (iPhone browsers), Live explains the options.
const TABS = [
  { id: 'health', label: 'Today', icon: 'activity' },
  { id: 'live', label: 'Live', icon: 'heart' },
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
// pts: [[x, y], ...] or [[x, y, lo, hi], ...] with band: true. Scale info is kept on the canvas for scrub().
function drawLine(canvas, pts, opts = {}) {
  const { min, max, labels = false, fill = true, band = false, dots = false, target = null, fmtY = null } = opts;
  const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  c.clearRect(0, 0, w, h);
  canvas._chart = null;
  if (pts.length < 2) {
    if (labels) { c.font = '13px Inter, system-ui, sans-serif'; c.fillStyle = css('--muted'); c.fillText('Not enough data yet', 8, h / 2); }
    return;
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, band && p[2] != null ? p[2] : p[1]); y1 = Math.max(y1, band && p[3] != null ? p[3] : p[1]);
  }
  if (target != null) { y0 = Math.min(y0, target); y1 = Math.max(y1, target); }
  const padY = (y1 - y0) * 0.08 || 5;
  y0 = min ?? y0 - padY; y1 = max ?? y1 + padY;
  const left = labels ? 36 : 0, pad = 6;
  const X = (x) => left + ((x - x0) / (x1 - x0 || 1)) * (w - left - 4);
  const Y = (y) => h - pad - ((y - y0) / (y1 - y0 || 1)) * (h - 2 * pad);
  if (labels) {
    c.font = '11px Inter, system-ui, sans-serif';
    c.fillStyle = css('--muted'); c.strokeStyle = css('--grid'); c.lineWidth = 1;
    for (const v of [y0 + padY, (y0 + y1) / 2, y1 - padY]) {
      const y = Math.round(Y(v)) + 0.5;
      c.beginPath(); c.moveTo(left, y); c.lineTo(w, y); c.stroke();
      c.fillText(fmtY ? fmtY(v) : Math.round(v), 0, Math.min(h - 2, Math.max(10, y + 4)));
    }
  }
  const color = css('--accent');
  if (band) {
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(X(p[0]), Y(p[3] ?? p[1])) : c.moveTo(X(p[0]), Y(p[3] ?? p[1]))));
    [...pts].reverse().forEach((p) => c.lineTo(X(p[0]), Y(p[2] ?? p[1])));
    c.closePath(); c.fillStyle = alpha(color, 0.15); c.fill();
  }
  if (target != null) {
    const ty = Math.round(Y(target)) + 0.5;
    c.strokeStyle = css('--success'); c.lineWidth = 1; c.setLineDash([4, 4]);
    c.beginPath(); c.moveTo(left, ty); c.lineTo(w, ty); c.stroke(); c.setLineDash([]);
    c.fillStyle = css('--success'); c.font = '11px Inter, system-ui, sans-serif';
    c.fillText('Target', w - 44, ty - 4);
  }
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y))));
  c.strokeStyle = color; c.lineWidth = 2; c.lineJoin = 'round'; c.stroke();
  if (fill && !band) {
    c.lineTo(X(x1), h); c.lineTo(X(x0), h); c.closePath();
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, alpha(color, 0.22)); g.addColorStop(1, alpha(color, 0));
    c.fillStyle = g; c.fill();
  }
  if (dots && pts.length <= 45) {
    c.fillStyle = color;
    for (const [x, y] of pts) { c.beginPath(); c.arc(X(x), Y(y), 2.5, 0, Math.PI * 2); c.fill(); }
  }
  canvas._chart = { pts, X, Y, opts };
}

// Drag a finger (or move the mouse) across a chart to see the exact time and value.
let scrubbing = false;
function scrub(canvas, label) {
  canvas._label = label;
  if (canvas._scrubbed) return;
  canvas._scrubbed = true;
  canvas.style.touchAction = 'pan-y'; // vertical swipes still scroll the page
  const box = canvas.parentElement;
  if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
  const tip = document.createElement('div');
  tip.className = 'tip'; tip.hidden = true; tip.setAttribute('role', 'status');
  box.append(tip);
  let timer;
  const show = (e) => {
    const ch = canvas._chart;
    if (!ch) return;
    clearTimeout(timer);
    const x = e.clientX - canvas.getBoundingClientRect().left;
    let best = ch.pts[0], bd = Infinity;
    for (const p of ch.pts) { const d = Math.abs(ch.X(p[0]) - x); if (d < bd) { bd = d; best = p; } }
    drawLine(canvas, ch.pts, ch.opts);
    const c = canvas.getContext('2d'), px = ch.X(best[0]), py = ch.Y(best[1]);
    c.strokeStyle = css('--muted'); c.lineWidth = 1; c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(px, 0); c.lineTo(px, canvas.clientHeight); c.stroke(); c.setLineDash([]);
    c.beginPath(); c.arc(px, py, 5, 0, Math.PI * 2); c.fillStyle = css('--accent'); c.fill();
    c.lineWidth = 2; c.strokeStyle = css('--surface'); c.stroke();
    tip.innerHTML = canvas._label(best);
    tip.hidden = false;
    const half = tip.offsetWidth / 2, cx = canvas.offsetLeft + px;
    tip.style.left = `${Math.max(half, Math.min(box.clientWidth - half, cx))}px`;
    tip.style.top = `${canvas.offsetTop}px`;
    scrubbing = true;
  };
  const hide = () => {
    tip.hidden = true; scrubbing = false;
    const ch = canvas._chart;
    if (ch) drawLine(canvas, ch.pts, ch.opts);
  };
  canvas.addEventListener('pointerdown', show);
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) show(e); });
  canvas.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') timer = setTimeout(hide, 2000); });
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  canvas.addEventListener('pointercancel', hide);
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
    ? `<section class="card empty"><h2>Live heart rate needs Bluetooth</h2>
        <p class="muted">${isIos ? 'Apple doesn\'t let Safari or home-screen apps use Bluetooth, so this device can\'t connect to the Air directly.' : 'This browser can\'t use Bluetooth.'} Your heart rate still updates every minute on Today.</p>
        <ol>${isIos ? '<li>For second-by-second heart rate on iPhone, open danton404.github.io/pulse in the free <a href="https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055" target="_blank" rel="noopener">Bluefy</a> browser.</li>' : ''}
        <li>On a laptop: use Chrome, Edge or Brave.</li>
        <li>In the Google Health app: Fitbit Air settings, Connections, turn on Share heart rate.</li></ol>
        <a class="btn primary" href="#health">Go to Today</a></section>`
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

function barsHtml(obj, fmt = fmtDuration) {
  const entries = Object.entries(obj), total = entries.reduce((a, [, v]) => a + v, 0) || 1;
  return `<div class="zones">${entries.map(([name, v], i) => `
    <div class="zone-row"><span>${name}</span>
      <div class="zone-track"><div class="zone-fill" style="width:${(v / total) * 100}%;background:var(--z${i + 2})"></div></div>
      <span class="num">${fmt(v)}</span></div>`).join('')}</div>`;
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
      box.innerHTML = '<div class="chart-box"><canvas class="chart tall" role="img" aria-label="Heart rate during the workout. Drag to inspect."></canvas></div>';
      const max = Math.max(...pts.map((p) => p[3] ?? p[1]));
      box.insertAdjacentHTML('beforeend', `<p class="small muted">Max ${max} bpm</p>`);
      requestAnimationFrame(() => {
        const c = box.querySelector('canvas');
        drawLine(c, pts, { labels: true, band: true });
        scrub(c, (x) => `<strong>${x[1]} bpm</strong> ${fmtTime(x[0])} · ${fmtDuration((x[0] - w.start) / 1000)} in`);
      });
    } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
  });
}

function openWorkout(w) {
  const s = w.summary;
  openSheet(`${w.title}, ${fmtDate(w.start)}`, `
    <div class="chart-box"><canvas class="chart tall" id="w-chart" role="img" aria-label="Heart rate during the workout. Drag to inspect."></canvas></div>
    <div class="mini-stats">
      <div><strong>${fmtDuration(s.duration)}</strong><span>Duration</span></div>
      <div><strong>${s.avg}</strong><span>Avg bpm</span></div>
      <div><strong>${s.max}</strong><span>Max bpm</span></div>
      <div><strong>${nf(s.kcal)}</strong><span>kcal (est.)</span></div>
    </div>
    ${w.rmssd ? `<p class="small muted">HRV during workout (RMSSD): ${w.rmssd} ms</p>` : ''}
    <div><h3 style="margin-bottom:8px">Time in zones</h3>${zonesHtml(s.zones)}</div>
    <button class="btn danger" type="button" id="del">${icon('trash', 18)} Delete workout</button>`, (el) => {
    requestAnimationFrame(() => {
      const c = el.querySelector('#w-chart');
      drawLine(c, downsample(w.samples), { labels: true });
      scrub(c, (x) => `<strong>${x[1]} bpm</strong> ${fmtDuration(x[0])} in`);
    });
    el.querySelector('#del').onclick = async () => {
      const { source, duration, avgHr, kcal, ...orig } = w;
      await workouts.del(w.id);
      sheet.close();
      renderWorkouts();
      toast('Workout deleted.', { label: 'Undo', run: async () => { await workouts.put(orig); renderWorkouts(); } });
    };
  });
}

// ---------- Health view (Today)
let healthLoading = false;
const P = () => settings.profile;
const dayLabel = (d) => fmtDate(`${d}T12:00`);
const metricFmt = (key, v) => (v == null ? '--' : key === 'sleepMin' ? fmtSleep(v) : nf(v, METRICS[key].dec));
const targetFor = (key) => ({ sleepMin: P().sleepTarget * 60, steps: P().stepTarget })[key];
const signed = (v, fmt) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmt(Math.abs(v))}`;
const allWorkouts = async () => workoutRows((await workouts.all()).filter((w) => !w.active));

function statCard(key, days) {
  const m = METRICS[key], st = stats(series(days, key, 30));
  if (!st) return `<button class="card stat tap" type="button" data-metric="${key}"><span class="eyebrow">${m.label}</span><div class="value muted">--</div><p class="hint">No data yet</p></button>`;
  // Steps and calories for today are running totals, so don't judge them against full days
  const partial = (key === 'steps' || key === 'kcal') && st.date === isoDay(new Date());
  const diff = st.avg7 != null ? st.latest - st.avg7 : null;
  const good = diff == null || Math.abs(diff) < 1e-9 ? null : (diff > 0) === (m.better === 'up');
  const prevN = Math.min(7, st.n - 1);
  const cmp = partial ? `So far today · avg ${metricFmt(key, st.avg7)}`
    : diff == null ? dayLabel(st.date) : `${signed(diff, (x) => metricFmt(key, x))} vs ${prevN === 1 ? 'yesterday' : `${prevN}-day avg`}`;
  const tgt = targetFor(key);
  return `<button class="card stat tap" type="button" data-metric="${key}"><span class="eyebrow">${m.label}</span>
    <div><span class="value">${metricFmt(key, st.latest)}</span><span class="unit">${m.unit}</span></div>
    <div class="delta ${good == null || partial ? 'muted' : good ? 'up' : 'down'}">${cmp}</div>
    ${tgt ? `<div class="meter" aria-label="${Math.round((st.latest / tgt) * 100)}% of target"><span style="width:${Math.min(100, (st.latest / tgt) * 100)}%"></span></div>` : ''}
    <canvas data-spark="${key}" aria-hidden="true"></canvas></button>`;
}

function goalCard(id, label, value, unit, sub, tone) {
  return `<button class="card stat tap" type="button" data-insight="${id}"><span class="eyebrow">${label}</span>
    <div><span class="value">${value}</span><span class="unit">${unit}</span></div>
    <div class="delta ${tone || 'muted'}">${sub}</div></button>`;
}

async function renderHealth(force = false) {
  const v = $('#view');
  const cache = healthCache.get();
  if (!signedIn() && !cache) {
    v.innerHTML = `<section class="card empty"><h2>Sign in to Google Health</h2>
      <p class="muted">Pulse reads your Fitbit Air data from Google (read-only). Sign-in lasts an hour; your data stays on this device.</p>
      <button class="btn primary" type="button" id="g-in">Sign in with Google</button></section>`;
    $('#g-in').onclick = () => doSignIn();
    return;
  }
  const stale = !cache || Date.now() - cache.fetchedAt > 5 * 60e3 || !cache.v2;
  if (signedIn() && (force || stale) && !healthLoading) {
    healthLoading = true;
    if (!cache) v.innerHTML = `<div class="grid">${'<div class="card"><div class="skeleton" style="height:96px"></div></div>'.repeat(6)}</div>`;
    else drawHealth(cache);
    try {
      const data = await fetchHealth(90);
      data.v2 = true;
      healthCache.set(data);
      // Keep the profile in sync: resting HR for zones, and weight/body fat if a scale logs them
      const p = P(), rhr = series(data.days, 'rhr').at(-1)?.[1];
      if (rhr) p.restHr = Math.round(rhr);
      if (data.weightKg) p.weight = Math.round(data.weightKg * 10) / 10;
      if (data.bodyFatPct) p.bodyFat = Math.round(data.bodyFatPct * 10) / 10;
      saveSettings();
    } catch (e) {
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

async function drawHealth(data) {
  const days = data?.days || {}, p = P();
  const ws = await allWorkouts().catch(() => []);
  if (view !== 'health') return;
  const r = readiness(days, p);
  const lastNight = sortedDays(days).reverse().find((d) => days[d].sleepMin);
  const sl = lastNight ? sleepScore(days[lastNight], p) : null;
  const load = trainingLoad(ws, p), cm = cardioMinutes(ws), plan = shredPlan(p, days), fit = vo2(days, p);
  const today = data?.today || [], latest = data?.latest;
  const tMin = today.length ? Math.min(...today.map((x) => x[2] ?? x[1])) : null;
  const tMax = today.length ? Math.max(...today.map((x) => x[3] ?? x[1])) : null;
  let hideHint = false;
  try { hideHint = localStorage.getItem('pulse-hide-install') === '1'; } catch {}
  const tone = (v, good, ok) => (v == null ? 'muted' : v >= good ? 'up' : v >= ok ? 'muted' : 'down');
  $('#view').innerHTML = `
    ${isIos && !standalone && !hideHint ? `<section class="card empty"><h2>Add Pulse to your Home Screen</h2>
      <p class="muted">In Safari, tap the Share button, then Add to Home Screen. Pulse then opens full screen like an app.</p>
      <button class="btn small" type="button" id="hide-install">Got it</button></section>` : ''}
    <section class="card">
      <div class="card-head"><button class="link-head" type="button" id="hr-open"><span class="eyebrow">Heart rate</span>
        <div class="stat"><span class="value" style="font-size:36px">${latest?.bpm ?? '--'}</span><span class="unit">bpm</span></div>
        <div class="small muted">${latest ? `Latest reading, ${fmtAgo(latest.t)}` : 'No recent reading'}</div></button>
        <div class="btn-row">
          ${signedIn() ? '' : '<button class="btn small primary" type="button" id="g-in">Sign in</button>'}
          <button class="icon-btn ${healthLoading ? 'spinning' : ''}" type="button" id="h-refresh" aria-label="Refresh">${icon('refresh')}</button></div></div>
      <canvas id="today-chart" class="chart" role="img" aria-label="Heart rate today, 5-minute averages. Drag to inspect."></canvas>
      <div class="mini-stats" style="grid-template-columns:repeat(3,1fr);margin-top:8px">
        <div><strong>${tMin ?? '--'}</strong><span>Low today</span></div>
        <div><strong>${tMax ?? '--'}</strong><span>High today</span></div>
        <div><strong>${p.restHr}</strong><span>Resting</span></div>
      </div>
    </section>
    <button class="card tap readiness" type="button" data-insight="readiness">
      <span class="eyebrow">Readiness${r ? `, ${dayLabel(r.date)}` : ''}</span>
      <div class="stat"><span class="value" style="font-size:36px">${r?.score ?? '--'}</span><span class="unit">/ 100</span></div>
      <div class="small ${r?.score == null ? 'muted' : r.score >= 55 ? 'up' : 'down'}">${r?.advice || `Needs ${Math.max(1, r?.need ?? 5)} more day${(r?.need ?? 5) === 1 ? '' : 's'} of HRV and resting HR`}</div>
    </button>
    <h2 class="section-title">Your goals</h2>
    <div class="grid">
      ${goalCard('sleep', 'Sleep score', sl?.score ?? '--', '/ 100', lastNight ? `Last night · target ${p.sleepTarget}h` : 'No sleep data', tone(sl?.score, 80, 65))}
      ${goalCard('shred', 'Shred plan', plan.eat ? nf(plan.eat) : '--', plan.eat ? 'kcal/day' : '', plan.eat ? `Eat target · ${plan.toLose} kg fat to go` : `${plan.toLose} kg fat to go · needs burn data`)}
      ${goalCard('load', 'Training load', load.ratio != null ? load.ratio.toFixed(2) : '--', '', load.ratio != null ? load.status.split(':')[0] : `${load.acute} this week`, load.ratio == null ? '' : load.ratio > 1.5 || load.ratio < 0.8 ? 'down' : 'up')}
      ${goalCard('cardio', 'Cardio minutes', cm, `/ ${p.cardioTarget}`, 'This week, moderate or harder', tone(cm / p.cardioTarget, 1, 0.6))}
      ${goalCard('vo2', 'Cardio fitness', fit ? nf(fit.value, 1) : '--', 'VO2 max', fit ? `${vo2Band(fit.value)}${fit.source === 'Fitbit' ? '' : ' · estimate'}` : 'Not enough data')}
    </div>
    <h2 class="section-title">Body</h2>
    <div class="grid">${['rhr', 'hrv', 'sleepMin', 'steps', 'kcal', 'spo2', 'resp'].map((k) => statCard(k, days)).join('')}</div>
    ${data?.errors?.length ? `<section class="card"><h3>Some data didn't load</h3><ul class="small muted">${data.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></section>` : ''}
    <p class="hint">Updated ${data ? fmtTime(data.fetchedAt) : 'never'}${signedIn() ? ' · heart rate refreshes every minute while open' : ' · signed out, showing saved data'}. The Air syncs through the Google Health app on your phone; open it to sync now.</p>`;

  const tc = $('#today-chart');
  drawLine(tc, today, { labels: true, band: true });
  scrub(tc, (x) => `<strong>${x[1]} bpm</strong> ${fmtTime(x[0])}${x[2] != null ? `<span>${x[2]}-${x[3]} in 5 min</span>` : ''}`);
  $('#view').querySelectorAll('canvas[data-spark]').forEach((c) => {
    drawLine(c, series(days, c.dataset.spark, 30).map(([d, v]) => [Date.parse(`${d}T12:00`), v]));
  });
  $('#view').querySelectorAll('[data-metric]').forEach((b) => (b.onclick = () => openMetric(b.dataset.metric)));
  $('#view').querySelectorAll('[data-insight]').forEach((b) => (b.onclick = () => openInsight(b.dataset.insight)));
  $('#hr-open').onclick = () => openHeartRate();
  $('#hide-install')?.addEventListener('click', () => { try { localStorage.setItem('pulse-hide-install', '1'); } catch {} drawHealth(data); });
  $('#h-refresh').onclick = () => (signedIn() ? renderHealth(true) : doSignIn());
  $('#g-in')?.addEventListener('click', doSignIn);
}

// ---------- Detail sheets
const statGrid = (items) => `<div class="stat-grid">${items.filter(Boolean).map(([k, v, cls]) => `<div><span>${k}</span><strong class="${cls || ''}">${v}</strong></div>`).join('')}</div>`;
const rangeTabs = (n) => `<div class="seg" role="tablist">${[7, 30, 90].map((d) => `<button type="button" role="tab" data-range="${d}" aria-selected="${d === n}">${d} days</button>`).join('')}</div>`;

function openMetric(key, n = 30) {
  const days = healthCache.get()?.days || {}, m = METRICS[key], p = P();
  const s = series(days, key, n), st = stats(s), fmt = (v) => metricFmt(key, v);
  const tgt = targetFor(key);
  const goodTrend = st?.trend == null ? null : (st.trend > 0) === (m.better === 'up');
  let extra = '';
  if (key === 'sleepMin' && st) {
    const d = days[st.date], sc = sleepScore(d, p), bt = bedtimeSpread(days);
    const avgOf = (k) => { const v = s.map(([dd]) => days[dd][k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    extra = `<div><h3>Last night</h3>${d.deepMin != null ? barsHtml({ Deep: d.deepMin, REM: d.remMin, Light: d.lightMin, Awake: d.awakeMin || 0 }, fmtSleep) : '<p class="hint">No stage data.</p>'}
      ${d.bedtime ? `<p class="small muted" style="margin-top:8px">${fmtTime(d.bedtime)} to ${fmtTime(d.wake)}${sc ? ` · sleep score ${sc.score}` : ''}</p>` : ''}</div>
      ${statGrid([['Avg deep', fmtSleep(avgOf('deepMin'))], ['Avg REM', fmtSleep(avgOf('remMin'))], bt && ['Avg bedtime', bt.avg], bt && ['Bedtime spread', `±${bt.sd} min`, bt.sd <= 30 ? 'up' : bt.sd > 60 ? 'down' : '']])}
      <p class="hint">A steady bedtime (within ±30 min) improves deep sleep and next-day HRV.</p>`;
  }
  if (tgt && st) {
    const hit = s.filter(([, v]) => v >= tgt).length;
    extra += `<p class="small"><strong>${hit} of ${s.length}</strong> days hit your target of ${fmt(tgt)}.</p>`;
  }
  if ((key === 'rhr' || key === 'hrv' || key === 'resp') && st?.sd) {
    const z = (st.latest - st.avg) / st.sd;
    extra += `<p class="small">Latest is <strong>${Math.abs(z).toFixed(1)} SD ${z >= 0 ? 'above' : 'below'}</strong> your ${n}-day baseline (${fmt(st.avg - st.sd)} to ${fmt(st.avg + st.sd)} is your normal range).</p>`;
  }
  if (key === 'kcal') extra += '<button class="btn small" type="button" data-go="shred">Open shred plan</button>';
  openSheet(m.label, `${rangeTabs(n)}
    ${st ? `<div class="chart-box"><canvas class="chart tall" id="m-chart" role="img" aria-label="${m.label}, last ${n} days. Drag to inspect."></canvas></div>
    ${statGrid([
      ['Latest', `${fmt(st.latest)} ${m.unit}`], ['7-day avg', fmt(st.avg7)], [`${n}-day avg`, fmt(st.avg)],
      ['Low', `${fmt(st.min[1])} · ${fmtDate(`${st.min[0]}T12:00`).replace(/^\w+ /, '')}`], ['High', `${fmt(st.max[1])} · ${fmtDate(`${st.max[0]}T12:00`).replace(/^\w+ /, '')}`],
      st.trend != null && ['Trend', `${signed(st.trend, (x) => metricFmt(key, x))}/week`, goodTrend == null ? '' : goodTrend ? 'up' : 'down'],
    ])}
    ${extra}` : '<p class="hint">No data in this range yet.</p>'}
    <p class="hint">${m.note}</p>`, (el) => {
    el.querySelectorAll('[data-range]').forEach((b) => (b.onclick = () => openMetric(key, +b.dataset.range)));
    el.querySelector('[data-go]')?.addEventListener('click', () => openInsight('shred'));
    const c = el.querySelector('#m-chart');
    if (!c) return;
    const pts = s.map(([d, v]) => [Date.parse(`${d}T12:00`), v]);
    requestAnimationFrame(() => {
      drawLine(c, pts, { labels: true, dots: true, target: tgt, fmtY: key === 'sleepMin' ? (v) => `${Math.round(v / 60)}h` : null });
      scrub(c, (x) => `<strong>${fmt(x[1])} ${m.unit}</strong> ${fmtDate(x[0])}`);
    });
  });
}

function openHeartRate() {
  const data = healthCache.get(), p = P(), today = data?.today || [];
  const secs = ZONES.map(() => 0);
  for (const x of today) secs[zoneIndex(x[1], p)] += 300;
  openSheet('Heart rate today', `
    <div class="chart-box"><canvas class="chart tall" id="hr-chart" role="img" aria-label="Heart rate today. Drag to inspect."></canvas></div>
    ${statGrid([['Latest', data?.latest ? `${data.latest.bpm} bpm` : '--'], ['Low', today.length ? `${Math.min(...today.map((x) => x[2] ?? x[1]))} bpm` : '--'],
      ['High', today.length ? `${Math.max(...today.map((x) => x[3] ?? x[1]))} bpm` : '--'], ['Resting', `${p.restHr} bpm`], ['Max (est.)', `${maxHr(p)} bpm`]])}
    <div><h3 style="margin-bottom:8px">Time in your zones today</h3>${zonesHtml(secs)}</div>
    <p class="hint">5-minute averages; the shaded band is the low-high range in each window. Data arrives a few minutes after the Air syncs.</p>`, (el) => {
    const c = el.querySelector('#hr-chart');
    requestAnimationFrame(() => {
      drawLine(c, today, { labels: true, band: true });
      scrub(c, (x) => `<strong>${x[1]} bpm</strong> ${fmtTime(x[0])}${x[2] != null ? `<span>${x[2]}-${x[3]}</span>` : ''}`);
    });
  });
}

async function openInsight(id) {
  const days = healthCache.get()?.days || {}, p = P();
  const ws = await allWorkouts().catch(() => []);
  if (id === 'readiness') {
    const r = readiness(days, p);
    const z = (v) => (v == null ? '--' : `${signed(v, (x) => x.toFixed(1))} SD`);
    openSheet('Readiness', `
      <div class="stat"><span class="value" style="font-size:44px">${r?.score ?? '--'}</span><span class="unit">/ 100</span></div>
      <p><strong>${r?.advice || 'Not enough data yet'}</strong></p>
      ${statGrid([['HRV vs baseline', z(r?.zh), r?.zh == null ? '' : r.zh >= 0 ? 'up' : 'down'], ['Resting HR vs baseline', z(r?.zr), r?.zr == null ? '' : r.zr <= 0 ? 'up' : 'down'], ['Sleep score', r?.sleep ?? '--']])}
      <p class="hint">Built for your goals: on high days push strength PRs or intervals; on low days keep the cut going with steps and easy Zone 2 instead of hard sessions, so you hold muscle while losing fat. Uses your last 30 days as the baseline.</p>`);
  } else if (id === 'sleep') {
    const d = sortedDays(days).reverse().find((x) => days[x].sleepMin), sc = d ? sleepScore(days[d], p) : null;
    openSheet('Sleep score', `
      <div class="stat"><span class="value" style="font-size:44px">${sc?.score ?? '--'}</span><span class="unit">/ 100</span></div>
      ${sc ? `<div class="zones">${sc.parts.map((x, i) => `<div class="zone-row"><span>${x.name}</span><div class="zone-track"><div class="zone-fill" style="width:${x.score}%;background:var(--z${i + 2})"></div></div><span class="num">${Math.round(x.score)}</span></div>`).join('')}</div>
      <p class="small muted">${sc.parts.filter((x) => x.detail).map((x) => `${x.name}: ${x.detail}`).join(' · ')}</p>` : ''}
      ${statGrid([['Asleep', d ? fmtSleep(days[d].sleepMin) : '--'], ['Target', `${p.sleepTarget}h`]])}
      <p class="hint">Duration counts most (45%), then deep and REM share and efficiency. For a cut with strength goals aim for ${p.sleepTarget}h: short sleep raises hunger hormones and makes you lose more muscle per kg lost.</p>
      <button class="btn small" type="button" data-go="sleepMin">Sleep history</button>`, (el) => el.querySelector('[data-go]').onclick = () => openMetric('sleepMin'));
  } else if (id === 'shred') {
    const s = shredPlan(p, days);
    const eta = new Date(Date.now() + s.weeks * 7 * 864e5);
    openSheet('Shred plan', `
      <p>From <strong>${p.bodyFat}%</strong> to <strong>${p.targetBodyFat}%</strong> body fat at ${p.weight} kg.</p>
      ${statGrid([['Lean mass', `${s.lean} kg`], ['Goal weight', `${s.goalWeight} kg`], ['Fat to lose', `${s.toLose} kg`],
        ['Pace', `${s.weekly} kg/week`], ['Time', `~${s.weeks} weeks`], ['Target date', eta.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })],
        ['Avg burn (7 d)', s.burn ? `${nf(s.burn)} kcal` : '--'], ['Daily deficit', `${s.deficit} kcal`], ['Eat', s.eat ? `${nf(s.eat)} kcal` : '--', 'up'],
        ['Protein', `${s.protein} g/day`, 'up']])}
      <p class="hint">0.5% of body weight per week is the pace that keeps strength while cutting. Keep lifting heavy (it tells your body to keep muscle), hit protein every day, and use steps for extra burn rather than more hard cardio. Body fat % is from your Settings; update it every few weeks (calipers, scale or DEXA) and the plan recalculates.</p>
      <button class="btn small" type="button" data-go="settings">Edit body stats</button>`, (el) => el.querySelector('[data-go]').onclick = () => { sheet.close(); openSettings(); });
  } else if (id === 'load') {
    const l = trainingLoad(ws, p);
    const weeks = [3, 2, 1, 0].map((k) => {
      const from = Date.now() - (k + 1) * 7 * 864e5, to = Date.now() - k * 7 * 864e5;
      return [k === 0 ? 'This week' : `${k} wk ago`, Math.round(ws.filter((w) => w.start >= from && w.start < to).reduce((a, w) => a + trimp(w, p), 0))];
    });
    const top = Math.max(1, ...weeks.map((x) => x[1]));
    openSheet('Training load', `
      <div class="stat"><span class="value" style="font-size:44px">${l.ratio != null ? l.ratio.toFixed(2) : '--'}</span><span class="unit">acute : chronic</span></div>
      <p><strong>${l.status}</strong></p>
      <div class="zones">${weeks.map(([k, v], i) => `<div class="zone-row"><span>${k}</span><div class="zone-track"><div class="zone-fill" style="width:${(v / top) * 100}%;background:var(--z${i + 2})"></div></div><span class="num">${v}</span></div>`).join('')}</div>
      ${statGrid([['Last 7 days', l.acute], ['Weekly avg (28 d)', l.chronic]])}
      <p class="hint">Load = minutes × heart-rate intensity (TRIMP), from every workout the Air or Pulse recorded. Keep the ratio between 0.8 and 1.3: you build strength and cardio without the fatigue that stalls a cut. Lifting sessions show lower load than cardio because heart rate is lower; that's expected.</p>`);
  } else if (id === 'cardio') {
    const weeks = [3, 2, 1, 0].map((k) => [k === 0 ? 'This week' : `${k} wk ago`, cardioMinutes(ws.filter((w) => w.start < Date.now() - k * 7 * 864e5).map((w) => ({ ...w, start: w.start + k * 7 * 864e5 })))]);
    openSheet('Cardio minutes', `
      <div class="zones">${weeks.map(([k, v], i) => `<div class="zone-row"><span>${k}</span><div class="zone-track"><div class="zone-fill" style="width:${Math.min(100, (v / p.cardioTarget) * 100)}%;background:var(--z${i + 2})"></div></div><span class="num">${v}</span></div>`).join('')}</div>
      <p class="hint">Minutes at moderate intensity or harder in workouts. Target ${p.cardioTarget}/week to raise VO2 max: mostly Zone 2 (${zoneBpm(2, p)}-${zoneBpm(3, p)} bpm, can hold a conversation) plus one interval session. Zone 2 burns fat without hurting leg day.</p>`);
  } else if (id === 'vo2') {
    const f = vo2(days, p);
    openSheet('Cardio fitness', `
      <div class="stat"><span class="value" style="font-size:44px">${f ? nf(f.value, 1) : '--'}</span><span class="unit">ml/kg/min</span></div>
      <p><strong>${f ? vo2Band(f.value) : 'Not enough data'}</strong> for men 20-29${f ? ` · ${f.source}` : ''}</p>
      ${statGrid([['Excellent', '55+'], ['Good', '49-54'], ['Average', '43-48']])}
      <p class="hint">VO2 max is the strongest single marker of cardio fitness. It rises with Zone 2 volume and weekly intervals, and also rises as you lose fat (it's per kg). ${f?.source === 'Fitbit' ? '' : 'This is an estimate from your max and resting heart rate; Fitbit gives a measured value after outdoor runs with GPS.'}</p>`);
  }
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
    profile: { age: p.age, sex: p.sex, weightKg: p.weight, heightCm: p.height, bodyFatPct: p.bodyFat, restingHr: p.restHr, maxHr: maxHr(p) },
    goals: { targetBodyFatPct: p.targetBodyFat, alsoWants: ['increase strength', 'increase cardio fitness', 'improve sleep'], sleepTargetH: p.sleepTarget, dailySteps: p.stepTarget, cardioMinPerWeek: p.cardioTarget },
    derived: h ? (() => {
      const all = [...ws.map((w) => ({ ...w, duration: w.summary?.duration, avgHr: w.summary?.avg })), ...(h.exercises || [])];
      const night = sortedDays(h.days).reverse().find((d) => h.days[d].sleepMin);
      return { shredPlan: shredPlan(p, h.days), trainingLoad: trainingLoad(all, p), cardioMinutesThisWeek: cardioMinutes(all), vo2max: vo2(h.days, p), lastNightSleepScore: night ? sleepScore(h.days[night], p) : null };
    })() : null,
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
    readiness: h ? readiness(h.days, P()) : null,
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
        <div class="field"><label for="height">Height (cm)</label><input id="height" type="number" inputmode="numeric" min="120" max="230" value="${p.height}"></div>
        <div class="field"><label for="bodyFat">Body fat %</label><input id="bodyFat" type="number" inputmode="decimal" min="3" max="50" step="0.1" value="${p.bodyFat}"></div>
      </div>
      <h3>Goals</h3>
      <div class="form-grid">
        <div class="field"><label for="targetBodyFat">Target body fat %</label><input id="targetBodyFat" type="number" inputmode="decimal" min="3" max="40" step="0.5" value="${p.targetBodyFat}"></div>
        <div class="field"><label for="sleepTarget">Sleep target (h)</label><input id="sleepTarget" type="number" inputmode="decimal" min="5" max="11" step="0.25" value="${p.sleepTarget}"></div>
        <div class="field"><label for="stepTarget">Daily steps</label><input id="stepTarget" type="number" inputmode="numeric" min="1000" step="500" value="${p.stepTarget}"></div>
        <div class="field"><label for="cardioTarget">Cardio min/week</label><input id="cardioTarget" type="number" inputmode="numeric" min="30" step="10" value="${p.cardioTarget}"></div>
      </div>
      <p class="hint">Used for zones, calories and the shred plan. Resting HR (and weight or body fat, if a scale logs them) update from Google Health. Leave Max HR empty to estimate it from age.</p>
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
      Object.assign(settings.profile, {
        age: num('#age') || 25, sex: el.querySelector('#sex').value, weight: num('#weight') || 84, restHr: num('#restHr') || 60, maxHr: num('#maxHr'),
        height: num('#height') || 177, bodyFat: num('#bodyFat') || 15, targetBodyFat: num('#targetBodyFat') || 13,
        sleepTarget: num('#sleepTarget') || 8, stepTarget: num('#stepTarget') || 10000, cardioTarget: num('#cardioTarget') || 150,
      });
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
// Near-live: pull today's heart rate every minute while Today is on screen
setInterval(async () => {
  if (view !== 'health' || document.visibilityState !== 'visible' || !signedIn() || scrubbing || sheet.open || healthLoading) return;
  try { const d = await refreshToday(); if (d && view === 'health' && !scrubbing && !sheet.open) drawHealth(d); } catch {}
}, 60000);
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
