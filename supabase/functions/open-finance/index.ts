// =============================================================
// Edge Function "open-finance" — ponte OPCIONAL com a Pluggy
// -------------------------------------------------------------
// O Dhenors funciona sem isto. Ligar o Open Finance é uma escolha
// explícita: as transações do seu banco passam pela Pluggy (empresa
// regulada pelo Banco Central) e por esta função, que NÃO guarda nada:
// só repassa para o seu aparelho, que importa como um extrato.
//
// As credenciais da Pluggy ficam como segredos do Supabase (nunca no app):
//   supabase secrets set PLUGGY_CLIENT_ID=... PLUGGY_CLIENT_SECRET=...
//   supabase functions deploy open-finance
// Toda conexão (item) nasce marcada com o id do usuário do Supabase
// (clientUserId) e CADA ação confere que o item/conta é de quem pede.
// Ações (POST com o token do usuário logado):
//   { action: 'connect-token', itemId? }          → { connectToken }
//   { action: 'accounts', itemId }                → { accounts }
//   { action: 'transactions', accountId, from, to } → { transactions }
// =============================================================

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const PLUGGY = 'https://api.pluggy.ai';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const ID_RE = /^[\w-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Erro com o status HTTP certo (400 dado inválido, 403 não é seu). */
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function pluggyKey(): Promise<string> {
  const res = await fetch(`${PLUGGY}/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: Deno.env.get('PLUGGY_CLIENT_ID'), clientSecret: Deno.env.get('PLUGGY_CLIENT_SECRET') }),
  });
  if (!res.ok) throw new Error('Credenciais da Pluggy inválidas.');
  return (await res.json()).apiKey;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  try {
    // Só usuários logados no Supabase do app
    const supa = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_ANON_KEY') || '', { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return json({ error: 'Entre na nuvem do Dhenors primeiro.' }, 401);

    const body = await req.json();
    const key = await pluggyKey();
    const call = async (path: string, init: RequestInit = {}) => {
      const r = await fetch(`${PLUGGY}${path}`, { ...init, headers: { 'X-API-KEY': key, 'Content-Type': 'application/json', ...(init.headers || {}) } });
      if (r.status === 404) throw new HttpError(404, 'Não encontrado na Pluggy.');
      if (!r.ok) throw new Error(`Pluggy: erro ${r.status}`);
      return r.json();
    };

    // Sem estas conferências, quem soubesse o id do item/conta de outra
    // pessoa leria o extrato dela (a chave da Pluggy enxerga todos).
    const ownItem = async (itemId: unknown) => {
      if (typeof itemId !== 'string' || !ID_RE.test(itemId)) throw new HttpError(400, 'Conexão inválida.');
      const item = await call(`/items/${encodeURIComponent(itemId)}`);
      if (!item || item.clientUserId !== user.id) throw new HttpError(403, 'Esta conexão não pertence à sua conta.');
      return item;
    };
    const ownAccount = async (accountId: unknown) => {
      if (typeof accountId !== 'string' || !ID_RE.test(accountId)) throw new HttpError(400, 'Conta inválida.');
      const account = await call(`/accounts/${encodeURIComponent(accountId)}`);
      await ownItem(account?.itemId);
      return account;
    };

    if (body.action === 'connect-token') {
      if (body.itemId) await ownItem(body.itemId); // atualizar uma conexão: só a própria
      const r = await call('/connect_token', { method: 'POST', body: JSON.stringify({ itemId: body.itemId || undefined, options: { clientUserId: user.id } }) });
      return json({ connectToken: r.accessToken });
    }
    if (body.action === 'accounts') {
      await ownItem(body.itemId);
      const r = await call(`/accounts?itemId=${encodeURIComponent(body.itemId)}`);
      return json({ accounts: (r.results || []).map((a: Record<string, unknown>) => ({ id: a.id, name: a.name, type: a.type, number: a.number, balance: a.balance })) });
    }
    if (body.action === 'transactions') {
      const from = typeof body.from === 'string' && DATE_RE.test(body.from) ? body.from : null;
      const to = typeof body.to === 'string' && DATE_RE.test(body.to) ? body.to : null;
      if (!from || !to) throw new HttpError(400, 'Período inválido (use AAAA-MM-DD).');
      await ownAccount(body.accountId);
      const r = await call(`/transactions?accountId=${encodeURIComponent(body.accountId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&pageSize=500`);
      return json({ transactions: (r.results || []).map((t: Record<string, unknown>) => ({ id: t.id, date: String(t.date).slice(0, 10), description: t.description, amount: t.amount, type: t.type })) });
    }
    return json({ error: 'Ação desconhecida.' }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, err instanceof HttpError ? err.status : 500);
  }
});
