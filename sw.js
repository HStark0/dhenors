// =============================================================
// sw.js — Service worker: faz o app abrir sem internet
// -------------------------------------------------------------
// • A versão e a lista de arquivos vêm de sw-assets.js, gerado a
//   partir do package.json (tools/sync-version.mjs). Nada de lista
//   manual: arquivo novo entra sozinho no cache.
// • Cada versão tem o próprio cache e é servida inteira ("cache
//   first"): módulos antigos e novos nunca se misturam.
// • Versão nova: é baixada em segundo plano e fica ESPERANDO. O app
//   mostra "Nova versão disponível · Atualizar"; ao tocar, o app
//   manda SKIP_WAITING, a nova versão assume e a página recarrega.
// • Também recebe arquivos do menu "Compartilhar" do celular
//   (Web Share Target) e notificações push sem valores.
// (Os DADOS do usuário não ficam aqui: ficam no IndexedDB.)
// =============================================================

importScripts('./sw-assets.js');

const VERSION = `dhenors-v${self.DHENORS_VERSION}-${self.DHENORS_BUILD}`;
const ASSETS = self.DHENORS_ASSETS;
const SHARE_CACHE = 'dhenors-share';

self.addEventListener('install', (event) => {
  // Sem skipWaiting aqui: a troca só acontece quando o usuário pedir.
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'VERSION') event.source?.postMessage({ type: 'VERSION', version: self.DHENORS_VERSION });
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== SHARE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // Arquivo compartilhado pelo celular (manifest → share_target)
  if (request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET') return;

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(request, { ignoreSearch: true })
      || (request.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      // Só guarda arquivos do app (mesma origem, resposta completa)
      if (response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    } catch {
      return request.mode === 'navigate' ? cache.match('./index.html') : Response.error();
    }
  })());
});

/** Guarda o que veio do "Compartilhar" e abre o app na tela de recebidos. */
async function receiveShare(request) {
  try {
    const form = await request.formData();
    const cache = await caches.open(SHARE_CACHE);
    const meta = { at: Date.now(), title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '', files: [] };
    let i = 0;
    for (const file of form.getAll('file')) {
      if (!(file instanceof File) || file.size > 15 * 1024 * 1024) continue;
      const key = `./share/${Date.now()}-${i++}`;
      await cache.put(key, new Response(file, { headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Name': encodeURIComponent(file.name) } }));
      meta.files.push({ key, name: file.name, type: file.type, size: file.size });
    }
    await cache.put('./share/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* se falhar, o app abre normalmente */ }
  return Response.redirect('./index.html#/recebidos', 303);
}

// ---------- Notificações push (sem valores, por privacidade) ----------

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Dhenors', {
    body: data.body || 'Você tem contas para conferir.',
    icon: 'assets/icons/icon-192.png',
    badge: 'assets/icons/icon-monochrome-192.png',
    tag: data.tag || 'dhenors-push',
    data: { url: data.url || './index.html#/agenda' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || './index.html#/painel';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = all.find((c) => c.url.includes(self.registration.scope));
    if (open) { await open.focus(); open.navigate?.(target); return; }
    await self.clients.openWindow(target);
  })());
});
