// =============================================================
// email.js — Validação e montagem do e-mail do "Fale conosco"
// -------------------------------------------------------------
// JavaScript puro (sem Deno nem DOM): usado pela Edge Function
// (index.ts) e pelos testes (tests/feedback.test.mjs). As listas e
// limites são os mesmos de js/domain/feedback.js — um teste confere.
// =============================================================

export const AREAS = [
  'Interface / Design',
  'Desempenho / Lentidão',
  'Funcionalidades',
  'Conta / Perfil',
  'Nuvem / Sincronização',
  'Salário e holerite',
  'Investimentos',
  'Outro',
];

export const TYPES = {
  feedback: { label: 'Feedback', tag: 'FEEDBACK', color: '#1E7A34' },
  sugestao: { label: 'Sugestão', tag: 'SUGESTÃO', color: '#0066CC' },
  reclamacao: { label: 'Reclamação', tag: 'RECLAMAÇÃO', color: '#D70015' },
};

export const LIMITS = { name: 80, title: 120, message: 2000, details: 2000, messageMin: 10, detailsMin: 20, fileBytes: 5 * 1024 * 1024 };
export const FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];

/** Extensões aceitas por tipo (a primeira é a usada quando o nome não bate). */
export const FILE_EXT = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'application/pdf': ['pdf'],
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const s = (v) => String(v ?? '').trim();

/** Primeiros bytes do arquivo em base64 (só o começo: barato mesmo com 5 MB). */
function head(b64, n = 12) {
  try {
    const bin = atob(b64.slice(0, Math.ceil(n / 3) * 4));
    return Array.from(bin, (c) => c.charCodeAt(0));
  } catch { return []; }
}

/** Confere a assinatura (magic bytes) do conteúdo contra o tipo informado. */
export function matchesType(type, b64) {
  const b = head(s(b64), 12);
  const at = (i, list) => list.every((v, k) => b[i + k] === v);
  switch (type) {
    case 'image/png': return at(0, [0x89, 0x50, 0x4e, 0x47]);
    case 'image/jpeg': return at(0, [0xff, 0xd8, 0xff]);
    case 'image/gif': return at(0, [0x47, 0x49, 0x46]); // GIF
    case 'image/webp': return at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50]); // RIFF....WEBP
    case 'application/pdf': return at(0, [0x25, 0x50, 0x44, 0x46]); // %PDF
    default: return false;
  }
}

/** Nome seguro e com a extensão do tipo ("foto.exe" + PNG → "foto.png"). */
export function fileName(name, type) {
  const exts = FILE_EXT[type] || ['bin'];
  // eslint-disable-next-line no-control-regex
  let n = s(name).replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').slice(0, 120);
  const m = n.match(/\.([A-Za-z0-9]{1,8})$/);
  if (m && exts.includes(m[1].toLowerCase())) return n;
  if (m) n = n.slice(0, -m[0].length);
  return `${(n || 'anexo').slice(0, 110)}.${exts[0]}`;
}

/** Texto do corpo → objeto JSON, ou null (JSON inválido, null, número, lista…). */
export function parseObject(raw) {
  try {
    const v = JSON.parse(String(raw));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

/**
 * IP de quem chamou: x-real-ip (posto pela infraestrutura do Supabase) ou o
 * ÚLTIMO valor de x-forwarded-for (o primeiro pode ser inventado pelo cliente).
 * @param {(name: string) => string | null} get leitor de cabeçalhos
 */
export function clientIp(get) {
  const real = s(get('x-real-ip'));
  if (real) return real;
  const list = s(get('x-forwarded-for')).split(',').map((x) => x.trim()).filter(Boolean);
  return list.at(-1) || 'desconhecido';
}

/** Confere o pedido → { ok: true, data } ou { ok: false, field, error } */
export function validate(body) {
  const b = body && typeof body === 'object' ? body : {};
  const data = {
    name: s(b.name).replace(/\s+/g, ' '),
    email: s(b.email).toLowerCase(),
    area: s(b.area),
    type: s(b.type),
    title: s(b.title),
    message: s(b.message),
    details: s(b.details),
    rating: b.rating == null || b.rating === '' ? null : Number(b.rating),
    attachment: null,
    meta: {
      version: s(b.meta?.version).slice(0, 20),
      device: s(b.meta?.device).slice(0, 60),
      route: s(b.meta?.route).slice(0, 40),
    },
  };
  const fail = (field, error) => ({ ok: false, field, error });
  // Igual ao app (js/domain/feedback.js): nome e sobrenome
  if (data.name.length < 3 || !/\s/.test(data.name) || data.name.length > LIMITS.name) return fail('name', 'Informe o nome completo (nome e sobrenome).');
  if (!EMAIL.test(data.email) || data.email.length > 160) return fail('email', 'E-mail inválido.');
  if (!AREAS.includes(data.area)) return fail('area', 'Área inválida.');
  if (!TYPES[data.type]) return fail('type', 'Tipo de mensagem inválido.');
  if (!data.title || data.title.length > LIMITS.title) return fail('title', 'Assunto inválido.');
  if (data.message.length < LIMITS.messageMin || data.message.length > LIMITS.message) return fail('message', 'Mensagem inválida.');
  if (data.type === 'reclamacao') {
    if (data.details.length < LIMITS.detailsMin || data.details.length > LIMITS.details) return fail('details', 'Descreva o problema com mais detalhes.');
  } else data.details = '';
  if (data.rating != null && (!Number.isInteger(data.rating) || data.rating < 1 || data.rating > 5)) return fail('rating', 'Nota inválida.');
  const a = b.attachment;
  if (a) {
    if (typeof a !== 'object') return fail('file', 'Anexo inválido (imagem ou PDF).');
    const b64 = s(a.data);
    const bytes = Math.floor((b64.length * 3) / 4);
    if (!FILE_TYPES.includes(a.type) || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return fail('file', 'Anexo inválido (imagem ou PDF).');
    if (bytes > LIMITS.fileBytes * 1.02) return fail('file', 'O anexo passa de 5 MB.');
    // O conteúdo precisa ser mesmo do tipo informado (assinatura dos primeiros bytes)
    if (!matchesType(a.type, b64)) return fail('file', 'O conteúdo do anexo não confere com o tipo (imagem ou PDF).');
    data.attachment = { name: fileName(a.name, a.type), type: a.type, data: b64, bytes };
  }
  return { ok: true, data };
}

/** "[NOVA RECLAMAÇÃO] - Conta / Perfil - Maria Souza" (cabe numa linha de assunto). */
export function subject({ type, area, name }) {
  const t = TYPES[type];
  const clean = (v) => String(v).replace(/[\r\n]+/g, ' ');
  return `[${type === 'feedback' ? 'NOVO' : 'NOVA'} ${t.tag}] - ${clean(area)} - ${clean(name)}`.slice(0, 200);
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const para = (v) => esc(v).replace(/\r?\n/g, '<br>');

/** Corpo em HTML simples (tabelas e estilos inline: funciona em qualquer leitor de e-mail). */
export function html(d, receivedAt = new Date()) {
  const t = TYPES[d.type];
  const when = receivedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  const row = (k, v) => `<tr><td style="padding:8px 12px;color:#6E6E73;font-size:13px;white-space:nowrap;vertical-align:top;border-bottom:1px solid #EEE">${k}</td><td style="padding:8px 12px;font-size:14px;color:#1D1D1F;border-bottom:1px solid #EEE">${v}</td></tr>`;
  const stars = d.rating ? `${'★'.repeat(d.rating)}${'☆'.repeat(5 - d.rating)} (${d.rating}/5)` : '—';
  const block = (title, body, color = '#1D1D1F') => `
    <h3 style="margin:20px 0 6px;font-size:14px;color:${color}">${title}</h3>
    <div style="padding:12px 14px;background:#F5F5F7;border-radius:10px;font-size:14px;line-height:1.55;color:#1D1D1F">${para(body)}</div>`;
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#FFFFFF;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto">
    <p style="margin:0 0 4px;font-size:12px;color:#6E6E73">Dhenors · Fale conosco · ${esc(when)}</p>
    <h2 style="margin:0 0 4px;font-size:20px;color:#1D1D1F">
      <span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${t.color};color:#FFF;font-size:12px;vertical-align:middle">${esc(t.label)}</span>
      ${esc(d.title)}
    </h2>
    <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-top:12px">
      ${row('Nome', esc(d.name))}
      ${row('E-mail', `<a href="mailto:${esc(d.email)}" style="color:#0066CC">${esc(d.email)}</a>`)}
      ${row('Área', esc(d.area))}
      ${row('Tipo', esc(t.label))}
      ${d.type === 'feedback' ? row('Avaliação', stars) : ''}
      ${row('Anexo', d.attachment ? `${esc(d.attachment.name)} (${(d.attachment.bytes / 1024).toFixed(0)} KB, em anexo)` : '—')}
    </table>
    ${block('Mensagem', d.message)}
    ${d.type === 'reclamacao' ? block('Descrição detalhada do problema / erro ocorrido', d.details, '#D70015') : ''}
    <p style="margin:20px 0 0;font-size:12px;color:#6E6E73">App ${esc(d.meta.version || '?')} · ${esc(d.meta.device || 'aparelho desconhecido')} · tela ${esc(d.meta.route || '—')}<br>Responder este e-mail responde direto para ${esc(d.email)}.</p>
  </div></body></html>`;
}

/** Versão em texto puro (leitores sem HTML). */
export function text(d) {
  const t = TYPES[d.type];
  return [
    `${t.label}: ${d.title}`, '',
    `Nome: ${d.name}`, `E-mail: ${d.email}`, `Área: ${d.area}`,
    ...(d.type === 'feedback' && d.rating ? [`Avaliação: ${d.rating}/5`] : []),
    '', 'Mensagem:', d.message,
    ...(d.type === 'reclamacao' ? ['', 'Descrição detalhada do problema / erro ocorrido:', d.details] : []),
    '', `App ${d.meta.version} · ${d.meta.device} · ${d.meta.route}`,
  ].join('\n');
}
