// =============================================================
// sw.js — Service worker: faz o app abrir sem internet
// -------------------------------------------------------------
// • A versão e a lista de arquivos vêm de sw-assets.js, gerado a
//   partir do package.json (tools/sync-version.mjs). Nada de lista
//   manual: arquivo novo entra sozinho no cache.
// • Cada versão tem o próprio cache e é servida inteira ("cache
//   first"): módulos antigos e novos nunca se misturam. Na instalação
//   os arquivos vêm da rede (cache: 'reload'), nunca do cache HTTP.
// • Só as rotas do APP (raiz do escopo, index.html) abrem o app sem
//   internet. Landing, política de privacidade, CHANGELOG, docs e
//   dist/ vão à rede (com a cópia guardada, se houver, como reserva).
// • Versão nova: é baixada em segundo plano e fica ESPERANDO. O app
//   mostra "Nova versão disponível · Atualizar"; ao tocar, o app
//   manda SKIP_WAITING, a nova versão assume e a página recarrega.
//   Sem clients.claim(): na 1ª visita a página não troca de
//   controlador no meio do uso (o que disparava uma recarga).
// • Também recebe arquivos do menu "Compartilhar" do celular
//   (Web Share Target) e notificações push sem valores. Os arquivos
//   compartilhados ficam no máximo SHARE_TTL_MS no aparelho.
// (Os DADOS do usuário não ficam aqui: ficam no IndexedDB.)
// =============================================================

importScripts('./sw-assets.js');

const VERSION = `dhenors-v${self.DHENORS_VERSION}-${self.DHENORS_BUILD}`;
const ASSETS = self.DHENORS_ASSETS;
const SHARE_CACHE = 'dhenors-share';
/** Arquivos compartilhados e não usados somem depois de 24 h. */
const SHARE_TTL_MS = 24 * 60 * 60 * 1000;

/** Pastas e arquivos do app: servidos do cache da versão. */
const APP_DIRS = ['css/', 'js/', 'assets/'];
const APP_FILES = ['index.html', 'manifest.webmanifest'];

/**
 * Decide como atender um pedido (função pura, testada em tests/sw.test.mjs).
 * @param {{ pathname: string, method: string, mode: string }} req
 * @param {string} scopePath caminho do escopo do service worker (termina em "/")
 * @returns {'share'|'app'|'asset'|'network'|null}
 *   share   → POST do "Compartilhar"
 *   app     → navegação para o app: cache, com index.html de reserva
 *   asset   → arquivo do app: cache primeiro
 *   network → todo o resto: rede primeiro, cópia guardada só se houver
 *   null    → o service worker não interfere
 */
function routeFor(req, scopePath) {
  if (!req.pathname.startsWith(scopePath)) return null;
  const rel = req.pathname.slice(scopePath.length);
  if (req.method === 'POST' && rel === 'share-target') return 'share';
  if (req.method !== 'GET') return null;
  if (req.mode === 'navigate') return rel === '' || rel === 'index.html' ? 'app' : 'network';
  if (APP_FILES.includes(rel) || APP_DIRS.some((d) => rel.startsWith(d))) return 'asset';
  return 'network';
}

/**
 * O que manter do cache de compartilhados (função pura, testada).
 * @param {{ at?: number, title?: string, text?: string, url?: string, files?: Array<{ key: string, at?: number }> }} meta
 * @param {number} now
 * @returns {{ meta: object, empty: boolean }}
 */
function freshShares(meta, now) {
  const fresh = (at) => Number(at) > 0 && now - Number(at) < SHARE_TTL_MS;
  const files = (meta.files || []).filter((f) => fresh(f.at ?? meta.at));
  const next = fresh(meta.at) ? { ...meta, files } : { ...meta, title: '', text: '', url: '', files };
  return { meta: next, empty: !files.length && !next.text && !next.url };
}

self.addEventListener('install', (event) => {
  // Sem skipWaiting aqui: a troca só acontece quando o usuário pedir.
  // cache: 'reload' ignora o cache HTTP — nada de misturar versões.
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'VERSION') event.source?.postMessage({ type: 'VERSION', version: self.DHENORS_VERSION });
});

self.addEventListener('activate', (event) => {
  // As abas já controladas pela versão anterior passam para esta sozinhas
  // (e o app recarrega no "controllerchange"). Sem clients.claim(): na
  // 1ª instalação isso trocava o controlador e recarregava a página.
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('dhenors-v') && k !== VERSION).map((k) => caches.delete(k)))),
    purgeShares(),
  ]));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  const route = routeFor({ pathname: url.pathname, method: request.method, mode: request.mode }, new URL(self.registration.scope).pathname);
  if (!route) return;

  if (route === 'share') { event.respondWith(receiveShare(request)); return; }
  if (route === 'network') { event.respondWith(networkFirst(request)); return; }
  if (route === 'app') event.waitUntil(purgeShares());

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(request, { ignoreSearch: true })
      || (route === 'app' ? await cache.match('./index.html') : undefined);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      // Só guarda arquivos do app (mesma origem, resposta completa)
      if (response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    } catch {
      return (route === 'app' && (await cache.match('./index.html'))) || Response.error();
    }
  })());
});

/** Rede primeiro; sem internet, a cópia guardada (se houver). Não guarda nada novo. */
async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match(request, { ignoreSearch: true })) || Response.error();
  }
}

/**
 * Apaga do cache de compartilhados o que passou de SHARE_TTL_MS ou que
 * não está mais na lista (meta). O app apaga cada item assim que é usado
 * ou descartado (js/views/received.js); isto cobre o que ficou esquecido.
 */
async function purgeShares(now = Date.now()) {
  try {
    if (!(await caches.has(SHARE_CACHE))) return;
    const cache = await caches.open(SHARE_CACHE);
    const metaRes = await cache.match('./share/meta');
    const { meta, empty } = freshShares(metaRes ? await metaRes.json() : { files: [] }, now);
    if (empty) { await caches.delete(SHARE_CACHE); return; }
    const keep = new Set(meta.files.map((f) => new URL(f.key, self.registration.scope).href));
    for (const req of await cache.keys()) {
      if (!req.url.endsWith('/share/meta') && !keep.has(req.url)) await cache.delete(req);
    }
    await cache.put('./share/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* melhor esforço */ }
}

/** Guarda o que veio do "Compartilhar" e abre o app na tela de recebidos. */
async function receiveShare(request) {
  try {
    const form = await request.formData();
    await purgeShares();
    const cache = await caches.open(SHARE_CACHE);
    // Mantém o que chegou antes e ainda não foi usado (sem deixar órfãos)
    const prevRes = await cache.match('./share/meta');
    const prev = prevRes ? await prevRes.json() : { files: [] };
    const now = Date.now();
    const meta = { at: now, title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '', files: [...(prev.files || [])] };
    let i = 0;
    for (const file of form.getAll('file')) {
      if (!(file instanceof File) || file.size > 15 * 1024 * 1024) continue;
      const key = `./share/${now}-${i++}`;
      await cache.put(key, new Response(file, { headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Name': encodeURIComponent(file.name) } }));
      meta.files.push({ key, name: file.name, type: file.type, size: file.size, at: now });
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
