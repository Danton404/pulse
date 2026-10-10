// Settings and caches live in localStorage; workouts (per-second samples) live in IndexedDB.
const KEY = 'pulse-settings';
const HEALTH_KEY = 'pulse-health';

const DEFAULTS = {
  // Calibrated to Daniel: 25, male, 84 kg, 177 cm, ~15% body fat. Goals: shred to 13%, strength, cardio, sleep.
  profile: {
    age: 25, sex: 'male', weight: 84, height: 177, bodyFat: 15, targetBodyFat: 13,
    restHr: 51, maxHr: null, sleepTarget: 8, stepTarget: 10000, cardioTarget: 150,
  },
  calibrated: 0,
  alerts: { high: 175, low: 0, sound: true },
  // Public OAuth client ID from the "Pulse" Google Cloud project (not a secret).
  google: { clientId: '843389086456-vpmtg454o7gd1l0aqm4jvqjssg2kvgn8.apps.googleusercontent.com' },
  claude: { key: '', model: 'claude-sonnet-5-5' },
};

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: keep in memory */ }
}

// One level deep merge, so new defaults appear for existing users.
function merge(d, s = {}) {
  const out = {};
  for (const k of Object.keys(d)) out[k] = d[k] && typeof d[k] === 'object' ? { ...d[k], ...(s[k] || {}) } : s[k] ?? d[k];
  return out;
}

export const settings = merge(DEFAULTS, read(KEY) || {});
// One-time move from the original placeholder profile to the calibrated one.
if (settings.calibrated < 1) {
  settings.profile = { ...settings.profile, ...DEFAULTS.profile, restHr: settings.profile.restHr || DEFAULTS.profile.restHr };
  settings.calibrated = 1;
}
export const saveSettings = () => write(KEY, settings);

export const healthCache = {
  get: () => read(HEALTH_KEY),
  set: (v) => write(HEALTH_KEY, v),
  clear: () => { try { localStorage.removeItem(HEALTH_KEY); } catch {} },
};

let dbp;
function db() {
  return (dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open('pulse', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('workouts', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('workouts', mode);
    const req = fn(t.objectStore('workouts'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const workouts = {
  all: () => tx('readonly', (s) => s.getAll()).then((a) => a.sort((x, y) => y.start - x.start)),
  put: (w) => tx('readwrite', (s) => s.put(w)),
  del: (id) => tx('readwrite', (s) => s.delete(id)),
};
