// =============================================================
// notify.js — Lembretes de contas (notificações do aparelho)
// -------------------------------------------------------------
// Modos (Ajustes → Lembretes):
//  • 'daily'  (padrão) um ÚNICO aviso por dia com o resumo
//             ("3 contas: 1 atrasada, 2 vencem amanhã");
//  • 'weekly' só um resumo da semana aos domingos;
//  • 'each'   um aviso por conta (como antes).
// Sem servidor, o navegador só avisa quando o app é ABERTO. Para
// avisos com o app fechado: notificações push (core/push.js, sem
// valores) ou o calendário do celular (.ics).
// Além das contas: se algum dos próximos 12 meses não fecha, um aviso
// por semana (sem valores; desliga em Ajustes → Alertas e dicas).
// =============================================================

import { store } from '../core/store.js';
import { todayISO, formatDateBR, relativeDays, weekdayLong, addDaysISO, formatMonth } from '../core/dates.js';
import { formatBRL, plural } from '../core/money.js';
import { dueReminders } from '../domain/planning.js';
import { computeMonth } from '../domain/ledger.js';
import { shortMonthsAhead } from '../domain/outlook.js';
import * as A from '../domain/actions.js';
import { toast, toastError } from './toast.js';
import { enablePush, disablePush, syncPushSchedule, pushSupported } from '../core/push.js';

const supported = () => 'Notification' in globalThis;

/** Pede permissão e liga os lembretes (ou desliga). */
export async function enableNotifications() {
  const r = store.data.settings.reminders || {};
  if (r.enabled) {
    A.setReminders({ ...r, enabled: false, push: false });
    disablePush().catch(() => {});
    return toast('Lembretes desligados.', { type: 'info' });
  }
  if (!supported()) return toastError('Este navegador não suporta notificações. Use a exportação para o calendário.');
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') return toastError('Permissão negada. Libere as notificações do site nas configurações do navegador.');
  A.setReminders({ ...r, enabled: true, daysBefore: r.daysBefore ?? 1 });
  toast('Lembretes ligados! Você será avisado ao abrir o app.');
  runReminders(true);
}

/** Liga/desliga o push com o app fechado. */
export async function togglePush() {
  const r = store.data.settings.reminders || {};
  if (r.push) {
    await disablePush().catch(() => {});
    A.setReminders({ ...r, push: false });
    return toast('Notificações com o app fechado desligadas.', { type: 'info' });
  }
  if (!pushSupported()) return toastError('Push indisponível: precisa da nuvem ligada, da chave VAPID em js/config.js e de um navegador compatível (no iPhone, com o app instalado).');
  try {
    await enablePush();
    A.setReminders({ ...r, enabled: true, push: true });
    toast('Pronto! Você recebe "você tem 2 contas amanhã" mesmo com o app fechado (sem valores).');
  } catch (err) { toastError(err.message); }
}

const sentKey = (today) => `dhenors:notified:${today}`;

function readSent(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}

function saveSent(key, sent) {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('dhenors:notified:') && k !== key) localStorage.removeItem(k);
    localStorage.setItem(key, JSON.stringify(sent));
  } catch { /* ignora */ }
}

async function show(title, opts) {
  const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
  try {
    if (reg?.showNotification) await reg.showNotification(title, { icon: 'assets/icons/icon-192.png', badge: 'assets/icons/icon-monochrome-192.png', ...opts });
    else new Notification(title, opts);
  } catch { /* alguns navegadores só permitem via service worker */ }
}

/** Mostra os lembretes do dia conforme o modo escolhido. */
export async function runReminders(force = false) {
  const r = store.data?.settings.reminders;
  if (r?.push) syncPushSchedule().catch(() => {});
  if (!r?.enabled || !supported() || Notification.permission !== 'granted') return;
  const today = todayISO();
  const key = sentKey(today);
  const sent = readSent(key);
  const mode = r.mode || 'daily';

  // Mês que não fecha: no máximo um aviso por semana (sem valores)
  if (!sent.includes('short')) {
    const short = shortMonthsAhead(store.data, today);
    const week = `dhenors:short-week:${addDaysISO(today, -new Date().getDay())}`;
    let seen = false;
    try { seen = localStorage.getItem(week) === '1'; } catch { /* ignora */ }
    if (short.count && (force || !seen)) {
      await show(short.count === 1 ? `${formatMonth(short.first)} pode não fechar` : `${short.count} meses podem não fechar`, {
        body: 'A previsão dos próximos 12 meses tem mês no vermelho. Toque para ver o que pesa e como resolver.',
        tag: 'dhenors-short',
        data: { url: './index.html#/planejamento?aba=ano' },
      });
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith('dhenors:short-week:') && k !== week) localStorage.removeItem(k);
        localStorage.setItem(week, '1');
      } catch { /* ignora */ }
      sent.push('short');
      saveSent(key, sent);
    }
  }

  if (mode === 'weekly') {
    if (new Date().getDay() !== 0 && !force) return; // só aos domingos
    if (sent.includes('weekly') && !force) return;
    const end = addDaysISO(today, 7);
    const items = [];
    for (const ym of new Set([today.slice(0, 7), end.slice(0, 7)])) {
      items.push(...computeMonth(store.data, ym, today).items.filter((i) => i.status !== 'paid' && i.dueDate <= end));
    }
    const overdue = items.filter((i) => i.status === 'overdue').length;
    const total = items.reduce((a, i) => a + i.cents, 0);
    await show('Resumo da semana', {
      body: items.length ? `${plural(items.length, 'conta')} até ${weekdayLong(end)} (${formatBRL(total)})${overdue ? ` · ${overdue} atrasada${overdue > 1 ? 's' : ''}` : ''}.` : 'Nenhuma conta vence nesta semana.',
      tag: 'dhenors-weekly',
    });
    sent.push('weekly');
    saveSent(key, sent);
    return;
  }

  const due = dueReminders(store.data, r.daysBefore ?? 1, today).filter((i) => force || !sent.includes(i.key));
  if (!due.length) return;

  if (mode === 'daily') {
    const overdue = due.filter((i) => i.status === 'overdue').length;
    const todayN = due.filter((i) => i.dueDate === today).length;
    const total = due.reduce((a, i) => a + i.cents, 0);
    const parts = [overdue && `${overdue} atrasada${overdue > 1 ? 's' : ''}`, todayN && `${todayN} hoje`, (due.length - overdue - todayN) && `${due.length - overdue - todayN} nos próximos dias`].filter(Boolean);
    await show(`${plural(due.length, 'conta')} para pagar`, { body: `${parts.join(', ')} · ${formatBRL(total)}`, tag: 'dhenors-daily' });
    saveSent(key, [...sent, ...due.map((i) => i.key)]);
    return;
  }

  for (const item of due.slice(0, 5)) {
    const title = item.status === 'overdue' ? `Atrasada: ${item.description}` : `Vence ${relativeDays(item.dueDate, today)}: ${item.description}`;
    await show(title, { body: `${formatBRL(item.cents)} · ${formatDateBR(item.dueDate)}`, tag: item.key });
    sent.push(item.key);
  }
  if (due.length > 5) await show(`E mais ${plural(due.length - 5, 'conta')} para pagar`, { tag: 'dhenors-more' });
  saveSent(key, sent);
}
