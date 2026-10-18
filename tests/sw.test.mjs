// Service worker (sw.js) num contexto simulado: não guarda nada (sem
// cache, sem "fetch"), apaga os caches antigos e mostra as notificações.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const SCOPE = 'https://exemplo.github.io/dhenors/';
const src = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

/** Carrega o sw.js com self/caches falsos. */
function loadSW({ cacheKeys = [] } = {}) {
  const listeners = {};
  const calls = { claim: 0, skip: 0, deleted: [], shown: [], opened: [] };
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    registration: { scope: SCOPE, showNotification: async (title, opts) => { calls.shown.push({ title, ...opts }); } },
    clients: { claim: async () => { calls.claim++; }, matchAll: async () => [], openWindow: async (url) => { calls.opened.push(url); } },
    skipWaiting: () => { calls.skip++; },
  };
  const context = {
    self, URL, Promise, location: new URL(SCOPE),
    caches: { keys: async () => cacheKeys, delete: async (k) => { calls.deleted.push(k); return true; }, open: async () => { throw new Error('não deveria abrir cache'); } },
  };
  vm.runInNewContext(src, context);
  return { listeners, calls };
}

const run = async (fn) => { let done; fn((p) => { done = p; }); await done; };

test('não intercepta pedidos: tudo vem da rede, nada fica guardado', () => {
  const sw = loadSW();
  assert.equal(sw.listeners.fetch, undefined);
  assert.doesNotMatch(src, /caches\.open|cache\.put|addAll|importScripts/);
});

test('instala e assume na hora', () => {
  const sw = loadSW();
  sw.listeners.install({});
  assert.equal(sw.calls.skip, 1);
});

test('ao assumir, apaga os caches do antigo modo offline e do "Compartilhar"', async () => {
  const sw = loadSW({ cacheKeys: ['dhenors-v3.4.0-abc', 'dhenors-share', 'outro-site'] });
  await run((waitUntil) => sw.listeners.activate({ waitUntil }));
  assert.deepEqual(sw.calls.deleted, ['dhenors-v3.4.0-abc', 'dhenors-share']);
  assert.equal(sw.calls.claim, 1);
});

test('push: notificação sem valores, com destino', async () => {
  const sw = loadSW();
  await run((waitUntil) => sw.listeners.push({ waitUntil, data: { json: () => ({ title: 'Dhenors', body: 'Você tem 2 contas amanhã', url: './index.html#/agenda' }) } }));
  assert.equal(sw.calls.shown[0].body, 'Você tem 2 contas amanhã');
  assert.equal(sw.calls.shown[0].data.url, './index.html#/agenda');
});

test('toque na notificação abre o app', async () => {
  const sw = loadSW();
  await run((waitUntil) => sw.listeners.notificationclick({ waitUntil, notification: { close() {}, data: { url: './index.html#/painel' } } }));
  assert.deepEqual(sw.calls.opened, ['./index.html#/painel']);
});
