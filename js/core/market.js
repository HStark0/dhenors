// @ts-check
// =============================================================
// market.js — Taxas do Banco Central e cotações da bolsa
// -------------------------------------------------------------
// • Banco Central (API pública SGS, sem cadastro):
//     4389  CDI anualizado (% a.a.)      432  Meta Selic (% a.a.)
//     13522 IPCA acumulado 12 meses (%)  433  IPCA mensal (%)
//     189   IGP-M mensal (%)             4391 CDI mensal (%)
//   Atualiza sozinho uma vez por semana (se houver internet) e
//   quando você toca "Atualizar taxas".
// • brapi.dev: cotações de ações, FIIs e ETFs (preço atual) e o
//   Ibovespa mês a mês. Precisa de um token gratuito para a maioria
//   dos ativos (js/config.js → MARKET_CONFIG.brapiToken).
// Só são enviados os CÓDIGOS dos ativos (ex.: PETR4), nunca valores.
// =============================================================

import { MARKET_CONFIG } from '../config.js';

const BCB = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs';
const BRAPI = 'https://brapi.dev/api';

async function getJSON(url, timeout = 12_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error(`Erro ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

/** "15/10/2026" → "2026-10" */
const ymFromBR = (s) => `${s.slice(6, 10)}-${s.slice(3, 5)}`;
const num = (v) => Number(String(v).replace(',', '.'));
const bp = (pct) => Math.round(pct * 100);

async function series(code, last) {
  const rows = await getJSON(`${BCB}.${code}/dados/ultimos/${last}?formato=json`);
  return (Array.isArray(rows) ? rows : []).map((r) => ({ date: r.data, value: num(r.valor) })).filter((r) => Number.isFinite(r.value));
}

/** Acumula variações mensais (%): 12 meses de IGP-M → % no ano. */
export const accumulate = (monthly) => (monthly.reduce((acc, p) => acc * (1 + p / 100), 1) - 1) * 100;

/**
 * Baixa CDI, Selic, IPCA e IGP-M.
 * → { cdiBp, selicBp, ipca12Bp, igpm12Bp, ipcaMonthly, igpmMonthly, cdiMonthly }  (bp = centésimos de %)
 */
export async function fetchRates() {
  const [cdi, selic, ipca12, ipca, igpm, cdiM] = await Promise.all([
    series(4389, 1), series(432, 1), series(13522, 1), series(433, 36), series(189, 36), series(4391, 36),
  ]);
  const monthly = (list) => Object.fromEntries(list.map((r) => [ymFromBR(r.date), bp(r.value)]));
  const lastIgpm = igpm.slice(-12).map((r) => r.value);
  return {
    cdiBp: cdi[0] ? bp(cdi[0].value) : undefined,
    selicBp: selic[0] ? bp(selic[0].value) : undefined,
    ipca12Bp: ipca12[0] ? bp(ipca12[0].value) : undefined,
    igpm12Bp: lastIgpm.length === 12 ? bp(accumulate(lastIgpm)) : undefined,
    ipcaMonthly: monthly(ipca),
    igpmMonthly: monthly(igpm),
    cdiMonthly: monthly(cdiM),
  };
}

const token = () => (MARKET_CONFIG.brapiToken ? `token=${encodeURIComponent(MARKET_CONFIG.brapiToken)}` : '');

/**
 * Cotações atuais: { PETR4: centavos } e, se pedido, proventos anunciados.
 * Faz uma chamada por ativo (o plano gratuito da brapi aceita 1 por vez).
 */
export async function fetchQuotes(tickers, { dividends = false } = {}) {
  const prices = {};
  const events = [];
  const errors = [];
  for (const t of [...new Set(tickers)].slice(0, 40)) {
    try {
      const q = [token(), dividends ? 'dividends=true' : ''].filter(Boolean).join('&');
      const json = await getJSON(`${BRAPI}/quote/${encodeURIComponent(t)}${q ? `?${q}` : ''}`);
      const r = json?.results?.[0];
      if (r && Number.isFinite(r.regularMarketPrice)) prices[t] = Math.round(r.regularMarketPrice * 100);
      for (const d of r?.dividendsData?.cashDividends || []) {
        if (d.paymentDate) events.push({ ticker: t, date: String(d.paymentDate).slice(0, 10), rateCents: Math.round((d.rate || 0) * 100), label: d.label || 'Provento' });
      }
    } catch (err) { errors.push(`${t}: ${err.message}`); }
  }
  return { prices, events, errors };
}

/** Ibovespa no fim de cada mês (12 meses): { "AAAA-MM": variação em bp } */
export async function fetchIbovMonthly() {
  const q = [token(), 'range=2y', 'interval=1mo'].filter(Boolean).join('&');
  const json = await getJSON(`${BRAPI}/quote/%5EBVSP?${q}`);
  const hist = json?.results?.[0]?.historicalDataPrice || [];
  const out = {};
  for (let i = 1; i < hist.length; i++) {
    const prev = hist[i - 1].close;
    const cur = hist[i].close;
    if (!prev || !cur) continue;
    const d = new Date(hist[i].date * 1000);
    out[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`] = bp(((cur - prev) / prev) * 100);
  }
  return out;
}

/** Faz sentido atualizar de novo? (uma vez por semana) */
export const ratesStale = (updatedAt, days = 7) => !updatedAt || Date.now() - Date.parse(updatedAt) > days * 86_400_000;
