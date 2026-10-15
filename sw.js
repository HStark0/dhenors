// =============================================================
// sw.js — Service worker: faz o app abrir sem internet
// -------------------------------------------------------------
// Estratégia "stale-while-revalidate": responde na hora com a
// cópia salva e, em segundo plano, baixa a versão nova.
// Ao publicar mudanças, aumente VERSION para limpar o cache antigo.
// (Os DADOS do usuário não ficam aqui: ficam no IndexedDB.)
// =============================================================

const VERSION = 'dhenors-v3.5.0';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  './css/views.css',
  './css/brand.css',
  './js/main.js',
  './js/config.js',
  './js/core/calendar.js',
  './js/core/cloud.js',
  './js/core/crypto.js',
  './js/core/dates.js',
  './js/core/money.js',
  './js/core/pdftext.js',
  './js/core/storage.js',
  './js/core/store.js',
  './js/domain/actions.js',
  './js/domain/analysis.js',
  './js/domain/defaults.js',
  './js/domain/importer.js',
  './js/domain/investments.js',
  './js/domain/ledger.js',
  './js/domain/merge.js',
  './js/domain/payroll.js',
  './js/domain/payslip.js',
  './js/domain/planning.js',
  './js/domain/quickadd.js',
  './js/domain/schema.js',
  './js/domain/taxTables.js',
  './js/ui/backup.js',
  './js/ui/charts.js',
  './js/ui/cloudUI.js',
  './js/ui/dialog.js',
  './js/ui/dom.js',
  './js/ui/editors.js',
  './js/ui/exports.js',
  './js/ui/forms.js',
  './js/ui/icons.js',
  './js/ui/investEditors.js',
  './js/ui/items.js',
  './js/ui/motion.js',
  './js/ui/lock.js',
  './js/ui/notify.js',
  './js/ui/palette.js',
  './js/ui/pinpad.js',
  './js/ui/payrollEditor.js',
  './js/ui/payslipImport.js',
  './js/ui/scrollHint.js',
  './js/ui/select.js',
  './js/ui/toast.js',
  './js/views/agenda.js',
  './js/views/analysis.js',
  './js/views/bills.js',
  './js/views/categories.js',
  './js/views/creditors.js',
  './js/views/dashboard.js',
  './js/views/goals.js',
  './js/views/history.js',
  './js/views/importer.js',
  './js/views/installments.js',
  './js/views/investments.js',
  './js/views/recurring.js',
  './js/views/salary.js',
  './js/views/settings.js',
  './js/views/simulator.js',
  './assets/icons/favicon-32.png',
  './assets/icons/logo-64.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  event.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(request, { ignoreSearch: true });
    const network = fetch(request)
      .then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
      .catch(() => cached || (request.mode === 'navigate' ? cache.match('./index.html') : undefined));
    return cached || network;
  }));
});
