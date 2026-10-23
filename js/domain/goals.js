// @ts-check
// =============================================================
// goals.js — Reservas (antigas "Metas"): tipos e a reserva padrão
// -------------------------------------------------------------
// Toda conta tem a "Reserva de emergência" (id fixo, para não duplicar
// entre aparelhos): não pode ser excluída e, por padrão, o alvo é
// calculado sozinho — 6 meses de gastos (ver goalTarget em planning.js).
// Os outros tipos dizem PARA QUE é o dinheiro; "Poupar no mês" tem alvo
// mensal (o progresso recomeça todo mês).
// =============================================================

export const EMERGENCY_GOAL_ID = 'reserva-emergencia';
/** Meses de gastos que a reserva de emergência deve cobrir. */
export const EMERGENCY_MONTHS = 6;

export const GOAL_KINDS = [
  { id: 'emergencia', label: 'Reserva de emergência', icon: 'i:shield', hint: 'Para imprevistos: o ideal é cobrir 6 meses de gastos.' },
  { id: 'compra', label: 'Meta de compra', icon: 'i:shopping-bag', hint: 'Juntar para comprar algo: carro, celular, móveis, a entrada da casa.' },
  { id: 'economias', label: 'Economias', icon: 'i:coins', hint: 'Dinheiro guardado sem destino certo, para o que vier.' },
  { id: 'mensal', label: 'Poupar no mês', icon: 'i:piggy-bank', hint: 'Um valor para guardar TODO mês; o progresso recomeça a cada mês.' },
  { id: 'viagem', label: 'Viagem e lazer', icon: 'i:plane', hint: 'Férias, viagens, festas e passeios.' },
  { id: 'estudos', label: 'Estudos', icon: 'i:graduation-cap', hint: 'Cursos, faculdade, material e formação.' },
  { id: 'aposentadoria', label: 'Aposentadoria e futuro', icon: 'i:tree-palm', hint: 'Longo prazo: independência financeira e aposentadoria.' },
  { id: 'outro', label: 'Outra', icon: 'i:target', hint: 'Qualquer outro objetivo.' },
];
export const GOAL_KIND_IDS = GOAL_KINDS.map((k) => k.id);

export const kindOf = (goal) => GOAL_KINDS.find((k) => k.id === goal?.kind) || GOAL_KINDS[GOAL_KINDS.length - 1];

/** A reserva de emergência que toda conta tem. */
export function defaultEmergencyGoal() {
  return {
    id: EMERGENCY_GOAL_ID, description: 'Reserva de emergência', kind: 'emergencia', emergency: true,
    system: true, autoTarget: true, targetCents: 0, deadline: null, icon: 'i:shield', investmentIds: [], contributions: [],
  };
}

/**
 * Garante a reserva padrão na lista (muta `goals`). Quem já tinha uma
 * reserva de emergência marcada: ela vira a padrão (sem duplicar).
 */
export function ensureEmergencyGoal(goals) {
  if (goals.some((g) => g.system)) return goals;
  const own = goals.find((g) => g.emergency);
  if (own) Object.assign(own, { system: true, kind: 'emergencia' });
  else goals.push(defaultEmergencyGoal());
  return goals;
}

/** A reserva padrão como veio de fábrica (não conta como "dado" do aparelho na sincronização). */
export const isPristineDefault = (g) => Boolean(g?.system && g.autoTarget && !g.contributions?.length && !g.investmentIds?.length && !g.deadline);
