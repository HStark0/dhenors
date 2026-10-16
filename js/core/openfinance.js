// @ts-check
// =============================================================
// openfinance.js — Open Finance (Pluggy), OPCIONAL e desligado
// -------------------------------------------------------------
// Entra em conflito com o princípio "nada sai do aparelho", então só
// funciona se você ligar de propósito (Ajustes → Dados → Open
// Finance) e publicar a Edge Function supabase/functions/open-finance
// com as SUAS credenciais da Pluggy.
// Fluxo: 1) "Conectar banco" abre a página da Pluggy (fora do app) com
// um token temporário; 2) você autoriza no banco; 3) cola o ID da
// conexão (item) que a Pluggy mostra; 4) o app busca as transações
// pela função e abre a tela de importação (com conciliação) — nada é
// lançado sem a sua revisão.
// =============================================================

import { cloud } from './cloud.js';

const FN = '/functions/v1/open-finance';
const LS = 'dhenors:openfinance';

export const openFinanceSettings = () => {
  try { return JSON.parse(localStorage.getItem(LS) || '{"enabled":false,"items":[]}'); } catch { return { enabled: false, items: [] }; }
};
export const saveOpenFinance = (v) => { try { localStorage.setItem(LS, JSON.stringify(v)); } catch { /* ignora */ } };

async function call(body) {
  if (!cloud.linked) throw new Error('Ligue a nuvem antes: o Open Finance usa a sua conta do Supabase.');
  return cloud.request(FN, { method: 'POST', body });
}

/** Abre a página da Pluggy para conectar um banco. */
export async function connectBank(itemId = null) {
  const { connectToken } = await call({ action: 'connect-token', itemId });
  window.open(`https://connect.pluggy.ai/?connect_token=${encodeURIComponent(connectToken)}`, '_blank', 'noopener');
}

export const listAccounts = async (itemId) => (await call({ action: 'accounts', itemId })).accounts || [];

/**
 * Transações de uma conta no período, no formato do importador:
 * [{ date, description, cents (>0 saída, <0 entrada), id }]
 */
export async function fetchTransactions(accountId, from, to) {
  const { transactions = [] } = await call({ action: 'transactions', accountId, from, to });
  return transactions.map((t) => ({
    date: t.date, description: String(t.description || 'Lançamento').slice(0, 120), id: t.id,
    cents: Math.round((t.type === 'DEBIT' ? Math.abs(t.amount) : -Math.abs(t.amount)) * 100),
  })).filter((t) => t.date && t.cents);
}
