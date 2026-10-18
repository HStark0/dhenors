// =============================================================
// Edge Function "daily-reminders" — notificações push do Dhenors
// -------------------------------------------------------------
// Roda uma vez por dia (pg_cron, ver supabase/schema.sql) e manda
// "Você tem 2 contas amanhã" para quem ligou as notificações.
// PRIVACIDADE: o servidor não sabe valores nem descrições. Cada
// aparelho envia só QUANTAS contas vencem em cada dia (tabela
// dhenors_push.schedule). Aos domingos manda o resumo da semana.
// Às segundas, se `schedule.short` > 0, avisa que algum dos próximos
// 12 meses não fecha (só a quantidade de meses, nunca valores).
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

/** Compara em tempo constante (não revela, pelo tempo de resposta, quantos caracteres batem). */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Só manda push para os serviços de push conhecidos dos navegadores (https).
// A inscrição é gravada pelo próprio usuário: sem esta lista, alguém poderia
// pôr uma URL qualquer e fazer o servidor mandar POST para ela.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com$/, /^web\.push\.apple\.com$/];
function pushEndpointOk(sub: unknown): boolean {
  try {
    const u = new URL(String((sub as { endpoint?: unknown })?.endpoint || ''));
    return u.protocol === 'https:' && !u.port && !u.username && !u.password && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch { return false; }
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') || '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!service || !sameSecret(auth, `Bearer ${service}`)) return new Response('forbidden', { status: 403 });

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
    if (!pushEndpointOk(row.subscription)) {
      console.warn('[daily-reminders] endpoint de push recusado (host desconhecido ou sem https)', row.user_id);
      continue;
    }
    const s =(row.schedule || {}) as Record<string, number>;
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
    // Previsão: meses que não fecham (só a quantidade). Uma vez por semana, às segundas.
    const nShort = s.short || 0;
    const isMonday = new Date(`${today}T12:00:00Z`).getUTCDay() === 1;
    if (nShort && isMonday) {
      messages.push({ title: nShort === 1 ? 'Um mês pode não fechar' : `${nShort} meses podem não fechar`, body: 'A previsão dos próximos 12 meses tem mês no vermelho. Toque para ver o que pesa e como resolver.', tag: 'dhenors-short', url: './index.html#/planejamento?aba=ano' });
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
