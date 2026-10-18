// =============================================================
// sw.js — Service worker mínimo: notificações e instalação
// -------------------------------------------------------------
// • NÃO guarda nada: sem cache de arquivos, sem modo offline. Cada
//   abertura vem da rede, sempre na versão mais nova (nada de "nova
//   versão disponível").
// • Existe para: receber as notificações push (lembretes sem valores)
//   e permitir instalar o app na tela inicial.
// • Ao assumir, apaga os caches que versões anteriores deixaram
//   (modo offline e arquivos do "Compartilhar").
// • Sem listener de "fetch": o navegador atende tudo direto da rede.
// =============================================================

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('dhenors')).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

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
    if (open) {
      await open.focus();
      // navigate() falha em aba ainda não controlada: abre uma nova
      try { if (open.navigate) { await open.navigate(target); return; } } catch { /* abre abaixo */ }
    }
    await self.clients.openWindow(target);
  })());
});
