// Service worker (sw.js) rodando num contexto simulado: rotas, instalação
// sem cache HTTP, sem recarga na 1ª visita e validade dos compartilhados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const SCOPE = 'https://exemplo.github.io/dhenors/';
const src = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

/** Carrega o sw.js com self/caches/fetch falsos. */
function loadSW({ online = true, cached = {} } = {}) {
  const listeners = {};
  const store = new Map(Object.entries(cached).map(([k, v]) => [new URL(k, SCOPE).href, v]));
  const calls = { addAll: [], claim: 0, deleted: [], fetched: [] };
  const cache = {
    addAll: async (reqs) => { calls.addAll.push(...reqs); },
    match: async (req) => store.get(new URL(typeof req === 'string' ? req : req.url, SCOPE).href),
    put: async () => {},
    keys: async () => [],
    delete: async () => true,
  };
  class Request { constructor(url, init = {}) { this.url = new URL(url, SCOPE).href; this.cache = init.cache; this.method = init.method || 'GET'; this.mode = init.mode || 'cors'; } }
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    registration: { scope: SCOPE },
    clients: { claim: async () => { calls.claim++; } },
    skipWaiting: () => {},
  };
  const context = {
    self, Request, URL, Response: { error: () => ({ error: true }) }, location: new URL(SCOPE),
    caches: { open: async () => cache, keys: async () => ['dhenors-v0.0.1-x', 'dhenors-share', 'outro'], delete: async (k) => { calls.deleted.push(k); return true; }, has: async () => false, match: async (r) => cache.match(r) },
    fetch: async (req) => { calls.fetched.push(req.url); if (!online) throw new TypeError('offline'); return { ok: true, type: 'basic', from: 'rede', clone() { return this; } }; },
    importScripts: () => { self.DHENORS_VERSION = '9.9.9'; self.DHENORS_BUILD = 'abc'; self.DHENORS_ASSETS = ['./', './index.html', './js/main.js']; },
    Promise,
  };
  vm.runInNewContext(src, context);
  return { context, listeners, calls };
}

/** Dispara um "fetch" e devolve a resposta (ou undefined se o SW não interferir). */
async function dispatchFetch(sw, url, { mode = 'navigate', method = 'GET' } = {}) {
  let responded;
  const event = { request: { url: new URL(url, SCOPE).href, mode, method }, respondWith: (p) => { responded = p; }, waitUntil: () => {} };
  sw.listeners.fetch(event);
  return responded && (await responded);
}

test('rotas: só a raiz e o index.html abrem o app', () => {
  const { context: { routeFor } } = loadSW();
  const nav = (p) => routeFor({ pathname: p, method: 'GET', mode: 'navigate' }, '/dhenors/');
  assert.equal(nav('/dhenors/'), 'app');
  assert.equal(nav('/dhenors/index.html'), 'app');
  for (const p of ['/dhenors/landing.html', '/dhenors/docs/PRIVACIDADE.md', '/dhenors/CHANGELOG.md', '/dhenors/dist/dhenors.html', '/dhenors/site/x.webp', '/dhenors/qualquer']) {
    assert.equal(nav(p), 'network', p);
  }
  assert.equal(nav('/outro-site/'), null, 'fora do escopo');
});

test('rotas: arquivos do app, compartilhar e outros métodos', () => {
  const { context: { routeFor } } = loadSW();
  const get = (p) => routeFor({ pathname: p, method: 'GET', mode: 'cors' }, '/');
  assert.equal(get('/js/main.js'), 'asset');
  assert.equal(get('/css/base.css'), 'asset');
  assert.equal(get('/assets/icons/icon-192.png'), 'asset');
  assert.equal(get('/manifest.webmanifest'), 'asset');
  assert.equal(get('/dist/dhenors.html'), 'network');
  assert.equal(get('/site/screens/painel.webp'), 'network');
  assert.equal(routeFor({ pathname: '/share-target', method: 'POST', mode: 'navigate' }, '/'), 'share');
  assert.equal(routeFor({ pathname: '/algo', method: 'POST', mode: 'cors' }, '/'), null);
});

test('instalação pede os arquivos à rede, sem o cache HTTP', async () => {
  const sw = loadSW();
  let done;
  sw.listeners.install({ waitUntil: (p) => { done = p; } });
  await done;
  assert.deepEqual(sw.calls.addAll.map((r) => r.cache), ['reload', 'reload', 'reload']);
  assert.equal(sw.calls.addAll[1].url, `${SCOPE}index.html`);
});

test('ativação apaga caches antigos, mantém compartilhados e não usa clients.claim', async () => {
  const sw = loadSW();
  let done;
  sw.listeners.activate({ waitUntil: (p) => { done = p; } });
  await done;
  assert.deepEqual(sw.calls.deleted, ['dhenors-v0.0.1-x']);
  assert.equal(sw.calls.claim, 0);
});

test('sem internet: o app abre; a landing não vira o app', async () => {
  const index = { body: 'app' };
  const sw = loadSW({ online: false, cached: { './index.html': index } });
  assert.equal(await dispatchFetch(sw, '/dhenors/?a=1'), index);
  assert.equal(await dispatchFetch(sw, '/dhenors/index.html'), index);
  const landing = await dispatchFetch(sw, '/dhenors/landing.html');
  assert.notEqual(landing, index);
  assert.deepEqual(landing, { error: true });
});

test('com internet: páginas fora do app vêm da rede', async () => {
  const sw = loadSW({ online: true, cached: { './index.html': { body: 'app' } } });
  const res = await dispatchFetch(sw, '/dhenors/CHANGELOG.md');
  assert.equal(res.from, 'rede');
  assert.deepEqual(sw.calls.fetched, [`${SCOPE}CHANGELOG.md`]);
});

test('compartilhados expiram em 24 h', () => {
  const { context: { freshShares } } = loadSW();
  const now = 10 * 86_400_000;
  const old = now - 25 * 3_600_000;
  const recent = now - 3_600_000;
  const r = freshShares({ at: old, text: 'pix', files: [{ key: 'a', at: old }, { key: 'b', at: recent }] }, now);
  assert.deepEqual(r.meta.files.map((f) => f.key), ['b']);
  assert.equal(r.meta.text, '');
  assert.equal(r.empty, false);
  assert.equal(freshShares({ at: old, text: 'x', files: [{ key: 'a' }] }, now).empty, true, 'arquivo sem data usa a do envio');
  assert.equal(freshShares({ at: recent, text: 'x', files: [] }, now).empty, false);
  assert.equal(freshShares({}, now).empty, true);
});
