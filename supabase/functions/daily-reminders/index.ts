// =============================================================
// Edge Function "daily-reminders" — notificações push do Dhenors
// -------------------------------------------------------------
// Roda uma vez por dia (pg_cron, ver supabase/schema.sql) e manda
// "Você tem 2 contas amanhã" para quem ligou as notificações.
// PRIVACIDADE: o servidor não sabe valores nem descrições. Cada
// aparelho envia só QUANTAS contas vencem em cada dia (tabela
// dhenors_push.schedule). Aos domingos manda o resumo da semana.
//
// Publicar:
//   supabase functions deploy daily-reminders --no-verify-jwt
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:voce@exemplo.com
// Gerar as chaves VAPID: npx web-push generate-vapid-keys
// A chave PÚBLICA também vai em js/config.js (vapidPublicKey).
// =============================================================

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const TZ_OFFSET_H = -3; // horário de Brasília

function dateISO(daysFromToday: number): string {
  const now = new Date(Date.now() + TZ_OFFSET_H * 3600_000);
  now.setUTCDate(now.getUTCDate() + daysFromToday);
  return now.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') || '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!service || auth !== `Bearer ${service}`) return new Response('forbidden', { status: 403 });

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') || 'mailto:dhenors@example.com',
    Deno.env.get('VAPID_PUBLIC_KEY') || '',
    Deno.env.get('VAPID_PRIVATE_KEY') || '',
  );
  const db = createClient(Deno.env.get('SUPABASE_URL') || '', service);
  const { data: rows, error } = await db.from('dhenors_push').select('user_id, device_id, subscription, schedule, weekly');
  if (error) return new Response(error.message, { status: 500 });

  const today = dateISO(0);
  const tomorrow = dateISO(1);
  const isSunday = new Date(`${today}T12:00:00Z`).getUTCDay() === 0;
  let sent = 0;

  for (const row of rows || []) {
    const s = (row.schedule || {}) as Record<string, number>;
    const messages: { title: string; body: string; tag: string; url: string }[] = [];
    const nToday = s[today] || 0;
    const nTomorrow = s[tomorrow] || 0;
    const nOverdue = s.overdue || 0;
    if (isSunday && row.weekly) {
      let week = 0;
      for (let i = 0; i < 7; i++) week += s[dateISO(i)] || 0;
      messages.push({ title: 'Resumo da semana', body: week ? `${week} ${week === 1 ? 'conta vence' : 'contas vencem'} nos próximos 7 dias${nOverdue ? ` e ${nOverdue} ${nOverdue === 1 ? 'está atrasada' : 'estão atrasadas'}` : ''}.` : 'Nenhuma conta vence nesta semana. 🎉', tag: 'dhenors-weekly', url: './index.html#/agenda' });
    } else if (nToday || nTomorrow || nOverdue) {
      const parts = [];
      if (nOverdue) parts.push(`${nOverdue} ${nOverdue === 1 ? 'atrasada' : 'atrasadas'}`);
      if (nToday) parts.push(`${nToday} hoje`);
      if (nTomorrow) parts.push(`${nTomorrow} amanhã`);
      messages.push({ title: 'Contas para pagar', body: `Você tem contas: ${parts.join(', ')}.`, tag: 'dhenors-daily', url: './index.html#/contas' });
    }
    for (const m of messages) {
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify(m), { TTL: 6 * 3600 });
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.from('dhenors_push').delete().match({ user_id: row.user_id, device_id: row.device_id });
        }
      }
    }
  }
  return new Response(JSON.stringify({ sent }), { headers: { 'Content-Type': 'application/json' } });
});
