// @ts-check
// =============================================================
// feedback.js — Regras do "Fale conosco" (feedback, sugestão, reclamação)
// -------------------------------------------------------------
// Sem tela: opções, limites e a validação usada pelo formulário
// (ui/feedback.js). A Edge Function (supabase/functions/send-feedback)
// confere tudo de novo no servidor com as mesmas regras.
// =============================================================

export const FEEDBACK_AREAS = [
  'Interface / Design',
  'Desempenho / Lentidão',
  'Funcionalidades',
  'Conta / Perfil',
  'Nuvem / Sincronização',
  'Salário e holerite',
  'Investimentos',
  'Outro',
];

/** Tipos de mensagem: valor enviado → rótulo da tela e etiqueta do assunto do e-mail. */
export const FEEDBACK_TYPES = [
  { value: 'feedback', label: 'Feedback', tag: 'FEEDBACK', icon: 'heart' },
  { value: 'sugestao', label: 'Sugestão', tag: 'SUGESTÃO', icon: 'lightbulb' },
  { value: 'reclamacao', label: 'Reclamação', tag: 'RECLAMAÇÃO', icon: 'circle-alert' },
];

export const FEEDBACK_LIMITS = {
  name: 80,
  title: 120,
  message: 2000,
  details: 2000,
  messageMin: 10,
  detailsMin: 20,
  fileBytes: 5 * 1024 * 1024,
  fileTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'],
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Confere o que foi preenchido.
 * @param {{ name?: string, email?: string, area?: string, type?: string, title?: string, message?: string, details?: string, rating?: number|string|null, file?: { name: string, type: string, size: number }|null }} input
 * @returns {{ ok: boolean, errors: Array<{ field: string, message: string }>, data: object }}
 */
export function validateFeedback(input) {
  const s = (v) => String(v ?? '').trim();
  const L = FEEDBACK_LIMITS;
  const data = {
    name: s(input.name).replace(/\s+/g, ' '),
    email: s(input.email).toLowerCase(),
    area: s(input.area),
    type: s(input.type),
    title: s(input.title),
    message: s(input.message),
    details: s(input.details),
    rating: input.rating == null || input.rating === '' ? null : Number(input.rating),
  };
  const errors = [];
  const err = (field, message) => errors.push({ field, message });

  if (!data.name) err('name', 'Informe o seu nome.');
  else if (data.name.length < 3 || !/\s/.test(data.name)) err('name', 'Informe o nome completo (nome e sobrenome).');
  else if (data.name.length > L.name) err('name', `Use até ${L.name} caracteres.`);

  if (!data.email) err('email', 'Informe o e-mail para resposta.');
  else if (!EMAIL.test(data.email) || data.email.length > 160) err('email', 'E-mail inválido. Ex.: voce@exemplo.com');

  if (!FEEDBACK_AREAS.includes(data.area)) err('area', 'Escolha a área do app.');
  if (!FEEDBACK_TYPES.some((t) => t.value === data.type)) err('type', 'Escolha o tipo de mensagem.');

  if (!data.title) err('title', 'Escreva um assunto curto.');
  else if (data.title.length > L.title) err('title', `Use até ${L.title} caracteres.`);

  if (!data.message) err('message', 'Escreva a sua mensagem.');
  else if (data.message.length < L.messageMin) err('message', `Escreva pelo menos ${L.messageMin} caracteres.`);
  else if (data.message.length > L.message) err('message', `Use até ${L.message} caracteres.`);

  if (data.type === 'reclamacao') {
    if (!data.details) err('details', 'Descreva o problema: o que você fez, o que esperava e o que aconteceu.');
    else if (data.details.length < L.detailsMin) err('details', `Detalhe um pouco mais (pelo menos ${L.detailsMin} caracteres).`);
    else if (data.details.length > L.details) err('details', `Use até ${L.details} caracteres.`);
  } else {
    data.details = '';
  }

  if (data.rating != null && (!Number.isInteger(data.rating) || data.rating < 1 || data.rating > 5)) err('rating', 'A nota vai de 1 a 5.');

  const f = input.file;
  if (f) {
    if (!L.fileTypes.includes(f.type)) err('file', 'Envie uma imagem (PNG, JPG, WEBP, GIF) ou um PDF.');
    else if (f.size > L.fileBytes) err('file', 'O arquivo passa de 5 MB. Envie um menor ou uma captura da parte importante.');
  }
  return { ok: errors.length === 0, errors, data };
}

/** Assunto do e-mail: "[NOVA RECLAMAÇÃO] - Conta / Perfil - Maria Souza". */
export function feedbackSubject({ type, area, name }) {
  const t = FEEDBACK_TYPES.find((x) => x.value === type);
  const novo = type === 'feedback' ? 'NOVO' : 'NOVA';
  return `[${novo} ${t ? t.tag : 'MENSAGEM'}] - ${area} - ${name}`;
}
