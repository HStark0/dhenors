// @ts-check
// =============================================================
// push.js — Notificações com o app FECHADO (Web Push)
// -------------------------------------------------------------
// Privacidade: o servidor (Edge Function do Supabase em
// supabase/functions/daily-reminders) NÃO recebe valores nem nomes
// das contas. Este aparelho envia só QUANTAS contas vencem em cada
// dia dos próximos 14 dias ({ "2026-10-16": 2, overdue: 1 }). A
// mensagem é "Você tem contas: 2 amanhã".
// Requer: nuvem ligada, chave VAPID pública em js/config.js e a
// função publicada. No iPhone, o app precisa estar instalado.
// =============================================================

import { cloud } from './cloud.js';
import { store } from './store.js';
import { todayISO, addDaysISO, ymOf } from './dates.js';
import { computeMonth, overdueBefore } from '../domain/ledger.js';

export const pushSupported = () => Boolean(globalThis.PushManager && navigator.serviceWorker && cloud.config.vapidKey && cloud.linked);

const b64ToBytes = (b64) => {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};

/** Quantidade de contas por dia (sem valores). */
export function pushSchedule(state, today = todayISO()) {
  const out = {};
  const end = addDaysISO(today, 14);
  for (const ym of new Set([ymOf(today), ymOf(end)])) {
    for (const i of computeMonth(state, ym, today).items) {
      if (i.status === 'paid' || i.dueDate < today || i.dueDate > end) continue;
      out[i.dueDate] = (out[i.dueDate] || 0) + 1;
    }
  }
  const overdue = [...overdueBefore(state, ymOf(today), today), ...computeMonth(state, ymOf(today), today).items.filter((i) => i.status === 'overdue')].length;
  if (overdue) out.overdue = overdue;
  return out;
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Push indisponível neste aparelho.');
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permissão de notificação negada.');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cloud.config.vapidKey) });
  await cloud.request('/rest/v1/dhenors_push?on_conflict=user_id,device_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: { user_id: cloud.user.id, device_id: cloud.deviceId, subscription: sub.toJSON(), schedule: pushSchedule(store.data), weekly: store.data.settings.reminders?.mode === 'weekly', updated_at: new Date().toISOString() },
  });
}

export async function disablePush() {
  const reg = await navigator.serviceWorker?.ready;
  const sub = await reg?.pushManager?.getSubscription();
  await sub?.unsubscribe();
  if (cloud.linked) await cloud.request(`/rest/v1/dhenors_push?user_id=eq.${cloud.user.id}&device_id=eq.${cloud.deviceId}`, { method: 'DELETE' });
}

let last = '';
/** Atualiza as quantidades no servidor (quando mudam). */
export async function syncPushSchedule() {
  if (!pushSupported() || !store.data.settings.reminders?.push) return;
  const schedule = pushSchedule(store.data);
  const sig = JSON.stringify(schedule);
  if (sig === last) return;
  last = sig;
  await cloud.request(`/rest/v1/dhenors_push?user_id=eq.${cloud.user.id}&device_id=eq.${cloud.deviceId}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: { schedule, weekly: store.data.settings.reminders?.mode === 'weekly', updated_at: new Date().toISOString() },
  });
}
