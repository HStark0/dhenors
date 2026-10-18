// =============================================================
// Edge Function "send-feedback" — Fale conosco do Dhenors
// -------------------------------------------------------------
// Recebe o formulário (feedback, sugestão ou reclamação), confere tudo
// de novo e entrega por e-mail com o Resend (https://resend.com):
//   assunto  "[NOVA RECLAMAÇÃO] - Conta / Perfil - Maria Souza"
//   corpo    HTML simples com os campos (email.js) + versão em texto
//   anexo    a imagem/PDF enviada (até 5 MB)
//   reply-to o e-mail de quem escreveu (responder = responder a pessoa)
// A chave do Resend fica SÓ aqui (secret), nunca no app.
//
// Publicar (uma vez):
//   supabase secrets set RESEND_API_KEY=re_... FEEDBACK_TO=05henderson.dev@gmail.com
//   supabase functions deploy send-feedback --no-verify-jwt
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem em toda Edge
// Function (não precisa criar). Rode também o supabase/schema.sql: ele
// cria a tabela dhenors_feedback_log usada pelo limite de envios.
// Opcionais:
//   FEEDBACK_FROM     remetente (padrão "Dhenors <onboarding@resend.dev>").
//                     Com o remetente de teste do Resend, o e-mail só é
//                     entregue para o dono da conta do Resend: crie a conta
//                     com o mesmo FEEDBACK_TO ou verifique um domínio.
//   ALLOWED_ORIGINS   sites que podem chamar (separados por vírgula).
//
// Proteções:
//   • só POST, com cabeçalho Origin presente e da lista (o app sempre manda);
//   • corpo lido com limite real de 8 MB (não só o Content-Length);
//   • campo-isca para robôs;
//   • limite guardado no banco (vale para todas as instâncias): 30 envios
//     por hora no total, 5 por hora por e-mail e 5 a cada 10 min por IP.
//     Guarda só hashes SHA-256 (IP e e-mail nunca ficam em claro) e apaga
//     registros com mais de 1 dia. Sem o banco, recusa (não envia sem limite);
//   • anexo só imagem/PDF, com assinatura conferida e extensão do tipo real.
// =============================================================

import { validate, subject, html, text, parseObject, clientIp } from './email.js';

const TO = Deno.env.get('FEEDBACK_TO') || '05henderson.dev@gmail.com';
const FROM = Deno.env.get('FEEDBACK_FROM') || 'Dhenors <onboarding@resend.dev>';
const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || 'https://hstark0.github.io,http://127.0.0.1:5173,http://localhost:5173')
  .split(',').map((o) => o.trim()).filter(Boolean);
const MAX_BODY = 8 * 1024 * 1024;
const LIMIT_GLOBAL_HOUR = 30;
const LIMIT_EMAIL_HOUR = 5;
const LIMIT_IP_10MIN = 5;

const DB_URL = (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '');
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const LOG = `${DB_URL}/rest/v1/dhenors_feedback_log`;

// Além da lista, aceita o app rodando no próprio computador ou na rede de casa
// (localhost, 127.0.0.1, 192.168.x.x, 10.x.x.x — qualquer porta), para testar.
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/;
const allowed = (origin: string | null): origin is string => !!origin && (ORIGINS.includes(origin) || LOCAL.test(origin));

function cors(origin: string | null) {
  const allow = allowed(origin) ? origin : ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function reply(status: number, body: unknown, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });
}

/** Lê o corpo parando em `max` bytes (null = grande demais). */
async function readText(req: Request, max: number): Promise<string | null> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder().decode(all);
}

/** SHA-256 em hex. Usa a chave de serviço como "sal" para o hash do IP/e-mail não ser adivinhável por tentativa. */
async function hash(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${SERVICE}|${value}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

const dbHeaders = (extra: Record<string, string> = {}) => ({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, ...extra });

/** Quantas linhas do registro batem com o filtro (HEAD + count=exact → Content-Range "* /N"). */
async function count(filter: string): Promise<number> {
  const res = await fetch(`${LOG}?select=id&${filter}`, { method: 'HEAD', headers: dbHeaders({ Prefer: 'count=exact' }) });
  if (!res.ok) throw new Error(`contagem falhou (${res.status})`);
  const total = Number((res.headers.get('Content-Range') || '').split('/')[1]);
  if (!Number.isFinite(total)) throw new Error('contagem sem total');
  return total;
}

const since = (ms: number) => encodeURIComponent(new Date(Date.now() - ms).toISOString());

/** Confere os limites e registra este envio. → null (pode enviar) ou o motivo da recusa. */
async function rateLimit(ipHash: string, emailHash: string): Promise<string | null> {
  const [all, byEmail, byIp] = await Promise.all([
    count(`at=gte.${since(3600_000)}`),
    count(`at=gte.${since(3600_000)}&email_hash=eq.${emailHash}`),
    count(`at=gte.${since(600_000)}&ip_hash=eq.${ipHash}`),
  ]);
  if (all >= LIMIT_GLOBAL_HOUR) return 'Muitas mensagens chegando agora. Tente de novo mais tarde.';
  if (byEmail >= LIMIT_EMAIL_HOUR || byIp >= LIMIT_IP_10MIN) return 'Muitas mensagens em pouco tempo.';
  // Registra ANTES de enviar: falha no envio também conta (evita rajadas)
  const ins = await fetch(LOG, {
    method: 'POST',
    headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ ip_hash: ipHash, email_hash: emailHash }),
  });
  if (!ins.ok) throw new Error(`registro falhou (${ins.status})`);
  // Faxina: registros com mais de 1 dia não servem mais
  await fetch(`${LOG}?at=lt.${since(86_400_000)}`, { method: 'DELETE', headers: dbHeaders({ Prefer: 'return=minimal' }) })
    .catch(() => {});
  return null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' }, origin);
  // O app (navegador) sempre manda Origin; sem ele, ou de outro site, recusa
  if (!allowed(origin)) return reply(403, { error: 'Origem não permitida.' }, origin);
  if (Number(req.headers.get('Content-Length') || 0) > MAX_BODY) return reply(413, { error: 'Mensagem grande demais.' }, origin);

  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return reply(500, { error: 'O envio de e-mail ainda não foi configurado no servidor.' }, origin);
  if (!DB_URL || !SERVICE) return reply(500, { error: 'O limite de envios não foi configurado no servidor.' }, origin);

  let raw: string | null;
  try { raw = await readText(req, MAX_BODY); } catch { return reply(400, { error: 'Pedido inválido.' }, origin); }
  if (raw === null) return reply(413, { error: 'Mensagem grande demais.' }, origin);
  const body = parseObject(raw) as Record<string, unknown> | null;
  if (!body) return reply(400, { error: 'Pedido inválido.' }, origin);
  // Robô preencheu o campo-isca: responde "ok" e não envia nada
  if (typeof body.website === 'string' && body.website.trim()) return reply(200, { ok: true }, origin);

  const check = validate(body);
  if (!check.ok) return reply(400, { error: check.error, field: check.field }, origin);
  const d = check.data;

  try {
    const ip = clientIp((h) => req.headers.get(h));
    const refused = await rateLimit(await hash(`ip:${ip}`), await hash(`email:${d.email}`));
    if (refused) return reply(429, { error: refused }, origin);
  } catch (err) {
    console.error('[send-feedback] limite de envios indisponível (rodou o supabase/schema.sql?)', err);
    return reply(503, { error: 'O envio está indisponível agora. Tente de novo mais tarde.' }, origin);
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [TO],
      reply_to: d.email,
      subject: subject(d),
      html: html(d),
      text: text(d),
      ...(d.attachment
        ? { attachments: [{ filename: d.attachment.name, content: d.attachment.data, content_type: d.attachment.type }] }
        : {}),
    }),
  });
  if (!res.ok) {
    console.error('[send-feedback] Resend respondeu', res.status, await res.text());
    return reply(502, { error: 'O serviço de e-mail não aceitou a mensagem agora. Tente de novo em instantes.' }, origin);
  }
  return reply(200, { ok: true }, origin);
});
