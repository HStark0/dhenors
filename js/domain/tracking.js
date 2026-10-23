// @ts-check
// =============================================================
// tracking.js — Mês em que a pessoa começou a usar o app
// -------------------------------------------------------------
// Quem cria a conta em 16/10 e cadastra um aluguel "desde janeiro"
// (ou um parcelamento que começou em janeiro) não deixou de pagar
// de janeiro a setembro: só não usava o app. Os cálculos contam a
// partir do MÊS DE INÍCIO; antes dele, o que o app gera sozinho
// (recorrentes, parcelas, faturas, salário, ganhos "todo mês") não
// existe para os cálculos:
//   • não fica atrasado nem entra em saldo devedor ou limite do cartão;
//   • não entra em médias, medianas, histórico, nota de saúde, previsões.
// Parcelas de antes do início contam como pagas (antes do app).
// Lançamentos AVULSOS que a pessoa cadastrou com data antiga valem
// sempre: foram informados um a um (ex.: uma dívida antiga em aberto).
//
// Mês de início = settings.trackingStartYM (Ajustes) ou, sem ele, o
// mais antigo entre: criação da conta, meses fechados no Histórico e
// o último backup em arquivo (sinais reais de que já usava o app).
// =============================================================

import { ymOf } from '../core/dates.js';

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isYM = (v) => typeof v === 'string' && YM.test(v);

/** Mês de início detectado sozinho (sem a escolha de Ajustes). */
export function detectedStartYM(state) {
  const candidates = [
    state?.createdAt ? ymOf(state.createdAt) : null,
    ...Object.keys(state?.closedMonths || {}),
    state?.lastBackupAt ? ymOf(state.lastBackupAt) : null,
  ].filter(isYM);
  return candidates.length ? candidates.sort()[0] : null;
}

/** Mês em que os cálculos começam ('AAAA-MM'), ou null (sem limite). */
export function trackingStartYM(state) {
  const chosen = state?.settings?.trackingStartYM;
  return isYM(chosen) ? chosen : detectedStartYM(state);
}

/** O mês é anterior ao uso do app? */
export function beforeStart(state, ym) {
  const start = trackingStartYM(state);
  return Boolean(start && ym < start);
}

/** Primeiro mês que conta, entre `ym` e o início (para laços que olham para trás). */
export function clampToStart(state, ym) {
  const start = trackingStartYM(state);
  return start && ym < start ? start : ym;
}
