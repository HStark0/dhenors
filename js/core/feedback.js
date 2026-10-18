// =============================================================
// feedback.js — Envio do "Fale conosco"
// -------------------------------------------------------------
// Manda a mensagem para a Edge Function "send-feedback" do Supabase
// (supabase/functions/send-feedback), que entrega por e-mail (Resend).
// A chave do serviço de e-mail fica SÓ no servidor. Funciona com ou
// sem login (o visitante também pode mandar).
// =============================================================

import { readConfig } from './cloud/http.js';
import { APP_VERSION } from '../version.js';
import { device } from './cloud/devices.js';

export class FeedbackError extends Error {}

/** Arquivo → { name, type, data (base64) } */
export function fileToAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name.slice(0, 120), type: file.type, data: String(reader.result).split(',')[1] || '' });
    reader.onerror = () => reject(new FeedbackError('Não foi possível ler o arquivo anexado.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Envia. payload: dados já validados (domain/feedback.js) + attachment?
 * Junto vão a versão do app, o aparelho e a tela (ajudam a achar o erro).
 */
export async function sendFeedback(payload) {
  const { url } = readConfig();
  if (!url) throw new FeedbackError('O envio de mensagens não está configurado neste servidor.');
  let res;
  try {
    // Pedido "simples" (texto, sem cabeçalhos extras): o navegador não faz a
    // consulta prévia de CORS, então qualquer resposta do servidor (inclusive
    // "função não publicada") chega ao app e vira uma mensagem clara.
    // A função lê o JSON do corpo do mesmo jeito.
    res = await fetch(`${url}/functions/v1/send-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        ...payload,
        meta: { version: APP_VERSION, device: device(), route: (location.hash || '').split('?')[0].slice(0, 40) },
      }),
    });
  } catch {
    throw new FeedbackError(navigator.onLine === false ? 'Sem conexão. Verifique a internet e tente de novo.' : 'Não foi possível falar com o servidor. Tente de novo em instantes.');
  }
  let body = null;
  try { body = await res.json(); } catch { /* sem corpo */ }
  if (res.ok && body?.ok) return body;
  if (res.status === 429) throw new FeedbackError('Muitas mensagens em pouco tempo. Espere alguns minutos e tente de novo.');
  if (res.status === 400 && body?.field) throw Object.assign(new FeedbackError(body.error || 'Confira os campos.'), { field: body.field });
  if (res.status === 404) {
    console.warn('[Fale conosco] A Edge Function "send-feedback" não está publicada neste projeto do Supabase. Veja docs/NUVEM.md → "Fale conosco por e-mail".');
    throw new FeedbackError('O envio de mensagens ainda não está ativo neste servidor. Tente de novo mais tarde.');
  }
  if (res.status === 500 && /configurado/.test(body?.error || '')) throw new FeedbackError('O envio de e-mail ainda não foi configurado no servidor. Tente de novo mais tarde.');
  throw new FeedbackError(body?.error || 'O servidor não conseguiu enviar agora. Tente de novo em instantes.');
}
