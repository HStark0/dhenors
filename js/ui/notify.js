// =============================================================
// notify.js — Lembretes de contas (notificações do aparelho)
// -------------------------------------------------------------
// Sem servidor, o navegador só avisa quando o app é ABERTO (ou
// volta para a tela): ele mostra uma notificação para cada conta
// atrasada ou que vence nos próximos dias — uma vez por dia.
// Para avisos com o app fechado, use "Levar para o calendário do
// celular" (arquivo .ics com alarmes) na Agenda.
// =============================================================

import { store } from '../core/store.js';
import { todayISO, formatDateBR, relativeDays } from '../core/dates.js';
import { formatBRL, plural } from '../core/money.js';
import { dueReminders } from '../domain/planning.js';
import * as A from '../domain/actions.js';
import { toast, toastError } from './toast.js';

const supported = () => 'Notification' in globalThis;

/** Pede permissão e liga os lembretes. */
export async function enableNotifications() {
  const r = store.data.settings.reminders || {};
  if (r.enabled) {
    A.setReminders({ enabled: false, daysBefore: r.daysBefore ?? 1 });
    return toast('Lembretes desligados.', { type: 'info' });
  }
  if (!supported()) return toastError('Este navegador não suporta notificações. Use a exportação para o calendário.');
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') return toastError('Permissão negada. Libere as notificações do site nas configurações do navegador.');
  A.setReminders({ enabled: true, daysBefore: r.daysBefore ?? 1 });
  toast('Lembretes ligados! Você será avisado ao abrir o app.');
  runReminders(true);
}

/** Mostra as notificações do dia (uma vez por conta por dia). */
export async function runReminders(force = false) {
  const r = store.data?.settings.reminders;
  if (!r?.enabled || !supported() || Notification.permission !== 'granted') return;
  const today = todayISO();
  const key = `dhenors:notified:${today}`;
  let sent = [];
  try { sent = JSON.parse(localStorage.getItem(key) || '[]'); } catch { /* sem armazenamento */ }
  const due = dueReminders(store.data, r.daysBefore ?? 1, today).filter((i) => force || !sent.includes(i.key));
  if (!due.length) return;

  const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
  for (const item of due.slice(0, 5)) {
    const title = item.status === 'overdue' ? `Atrasada: ${item.description}` : `Vence ${relativeDays(item.dueDate, today)}: ${item.description}`;
    const body = `${formatBRL(item.cents)} · ${formatDateBR(item.dueDate)}`;
    const opts = { body, tag: item.key, icon: 'assets/icons/icon-192.png', badge: 'assets/icons/favicon-32.png' };
    try {
      if (reg?.showNotification) await reg.showNotification(title, opts); else new Notification(title, opts);
    } catch { /* alguns navegadores só permitem via service worker */ }
    sent.push(item.key);
  }
  if (due.length > 5) {
    try { new Notification(`E mais ${plural(due.length - 5, 'conta')} para pagar`, { tag: 'dhenors-more' }); } catch { /* ignora */ }
  }
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('dhenors:notified:') && k !== key) localStorage.removeItem(k);
    localStorage.setItem(key, JSON.stringify(sent));
  } catch { /* ignora */ }
}
