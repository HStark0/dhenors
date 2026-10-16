// =============================================================
// cloud/http.js — Configuração do Supabase e chamadas REST
// -------------------------------------------------------------
// Sem estado de sessão: quem chama (core/cloud.js) passa o token.
// Erros viram CloudError com a mensagem já traduzida.
// =============================================================

import { CLOUD_CONFIG } from '../../config.js';

export const CONFIG_KEY = 'dhenors:cloud-config';

export class CloudError extends Error {}

/** URL e chave pública: as salvas em Ajustes valem mais que as de config.js. */
export function readConfig() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); } catch { /* ignora */ }
  const url = (saved.url || CLOUD_CONFIG.url || '').trim().replace(/\/+$/, '');
  const anonKey = (saved.anonKey || CLOUD_CONFIG.anonKey || '').trim();
  return { url, anonKey, fromFile: Boolean(CLOUD_CONFIG.url && CLOUD_CONFIG.anonKey && !saved.url), vapidKey: CLOUD_CONFIG.vapidPublicKey || '' };
}

/**
 * Faz a requisição e devolve o JSON da resposta.
 * `token`: access_token da sessão (sem ele, vai só com a chave pública).
 */
export async function request(path, { method = 'GET', body, headers = {}, token = null } = {}) {
  const { url, anonKey } = readConfig();
  if (!url || !anonKey) throw new CloudError('A nuvem ainda não foi configurada.');
  let res;
  try {
    res = await fetch(`${url}${path}`, {
      method,
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
  } catch {
    const err = new CloudError(globalThis.navigator?.onLine === false ? 'Sem conexão com a nuvem.' : 'Não foi possível falar com o Supabase. Se o projeto estiver pausado, abra o painel do Supabase e clique em "Restore".');
    err.offline = true;
    throw err;
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const msg = json?.msg || json?.error_description || json?.message || json?.error || `Erro ${res.status}`;
    const err = new CloudError(translate(msg, res.status));
    err.status = res.status;
    err.code = json?.code || json?.error_code;
    err.paused = res.status === 540 || /paused|inactive/i.test(String(msg));
    throw err;
  }
  return json;
}

export function translate(msg, status) {
  const m = String(msg);
  if (status === 540 || /project.*paused|paused/i.test(m)) return 'O projeto do Supabase está pausado por falta de uso. Abra supabase.com → seu projeto → "Restore project" (os dados continuam lá).';
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(m)) return 'Confirme o e-mail (veja sua caixa de entrada) e entre de novo.';
  if (/User already registered/i.test(m)) return 'Este e-mail já tem conta. Use "Entrar".';
  if (/Signups not allowed|signup.*disabled/i.test(m)) return 'Este servidor não aceita contas novas. Peça ao dono do projeto Supabase para criar a sua.';
  if (/Password should be at least/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/rate limit/i.test(m)) return 'Muitas tentativas. Espere um pouco e tente de novo.';
  if (/only request this after|security purposes/i.test(m)) return 'Por segurança, espere alguns segundos antes de pedir outro e-mail.';
  if (/Error sending recovery email|Error sending .*email/i.test(m)) return 'O Supabase não conseguiu enviar o e-mail. Confira o limite de envios ou o SMTP no painel do Supabase.';
  if (/should be different from the old password/i.test(m)) return 'A nova senha precisa ser diferente da anterior.';
  if (/relation .* does not exist|Could not find the table/i.test(m)) return 'Faltam tabelas na nuvem. Rode de novo o arquivo supabase/schema.sql no SQL Editor do Supabase (veja docs/NUVEM.md).';
  if (/JWT expired/i.test(m)) return 'Sessão expirada. Entre de novo.';
  if (/Invalid API key/i.test(m)) return 'Chave do Supabase inválida. Confira em Ajustes → Nuvem.';
  if (/dhenors_quota/i.test(m)) return 'O espaço desta conta na nuvem acabou. Apague dados antigos (ou peça ao dono do projeto para aumentar a cota em supabase/schema.sql).';
  if (/dhenors_revoked/i.test(m)) return 'Este aparelho foi desconectado da nuvem por outro aparelho.';
  if (/dhenors_chunks_size|dhenors_state_size/i.test(m)) return 'Uma parte dos dados passou do limite de 5 MB da nuvem.';
  return m;
}
