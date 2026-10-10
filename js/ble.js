// Live heart rate over the standard Bluetooth Heart Rate Service (0x180D / 0x2A37).
// Turn on "Share heart rate" for the Fitbit Air in the Google Health app first.
export const ble = {
  supported: !!navigator.bluetooth,
  state: 'idle', // idle | connecting | connected | reconnecting | lost
  name: '',
  listeners: new Set(),
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
};

let device = null, manual = false, retries = 0;

function emit(e) { ble.listeners.forEach((fn) => fn(e)); }
function setState(s) { ble.state = s; emit({ type: 'state' }); }

// Flags bit 0: 16-bit value. Bits 1-2: sensor contact. Bit 3: energy field present. Bit 4: RR intervals present (1/1024 s).
export function parse(dv) {
  const flags = dv.getUint8(0);
  let i = 1;
  const hr = flags & 1 ? dv.getUint16(i, true) : dv.getUint8(i);
  i += flags & 1 ? 2 : 1;
  const contact = (flags & 0b110) !== 0b100; // contact supported but not detected
  if (flags & 0x08) i += 2;
  const rr = [];
  if (flags & 0x10) for (; i + 1 < dv.byteLength; i += 2) rr.push(Math.round((dv.getUint16(i, true) / 1024) * 1000));
  return { hr, rr, contact };
}

async function attach() {
  const server = await device.gatt.connect();
  const svc = await server.getPrimaryService('heart_rate');
  const ch = await svc.getCharacteristic('heart_rate_measurement');
  ch.addEventListener('characteristicvaluechanged', (e) => emit({ type: 'hr', t: Date.now(), ...parse(e.target.value) }));
  await ch.startNotifications();
  retries = 0;
  setState('connected');
}

function onDisconnect() {
  if (manual) { manual = false; setState('idle'); return; }
  if (retries >= 6) { setState('lost'); return; }
  retries++;
  setState('reconnecting');
  setTimeout(() => attach().catch(() => { if (!device.gatt.connected) onDisconnect(); }), 1000 * retries);
}

export async function connect() {
  if (!ble.supported) throw new Error('This browser has no Bluetooth. On iPhone use the Bluefy browser; on a Mac use Chrome.');
  device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
  ble.name = device.name || 'Heart rate sensor';
  device.addEventListener('gattserverdisconnected', onDisconnect);
  setState('connecting');
  try { await attach(); } catch (e) { setState('idle'); throw e; }
}

export async function reconnect() {
  if (!device) return connect();
  retries = 0;
  setState('connecting');
  try { await attach(); } catch (e) { setState('lost'); throw e; }
}

export function disconnect() {
  if (!device?.gatt.connected) { setState('idle'); return; }
  manual = true;
  device.gatt.disconnect();
}
