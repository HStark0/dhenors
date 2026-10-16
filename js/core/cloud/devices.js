// =============================================================
// cloud/devices.js — Identificação deste aparelho na nuvem
// =============================================================

const DEVICE_KEY = 'dhenors:device-id';
const NAME_KEY = 'dhenors:device-name';

/** "Android · Chrome", "Windows · Edge"… */
export const device = () => {
  const ua = globalThis.navigator?.userAgent || '';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Navegador';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return browser ? `${os} · ${browser}` : os;
};

/** Id fixo deste aparelho (criado na primeira vez). */
export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  } catch { return 'sem-id'; }
}

export function localDeviceName() {
  try { return localStorage.getItem(NAME_KEY) || device(); } catch { return device(); }
}

export function saveDeviceName(name) {
  try { localStorage.setItem(NAME_KEY, String(name).trim().slice(0, 40)); } catch { /* ignora */ }
}
