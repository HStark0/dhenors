// =============================================================
// actions/planning.js — Metas, desejos, envelopes, orçamentos,
// cenários salvos e fechamento de mês
// =============================================================

import { store } from '../../core/store.js';
import { MAX_CENTS } from '../../core/money.js';
import { isValidYM, todayISO, currentYM, formatMonth } from '../../core/dates.js';
import { newId } from '../schema.js';
import { recurringActiveIn, recurringDates, variableEstimate, FREQ_DAYS } from '../ledger.js';
import { buildSnapshot, monthlyReport } from '../analysis.js';
import { financialScore } from '../planning.js';
import { ValidationError, text, cents, date, findOrThrow, entry } from './core.js';
import { GOAL_KIND_IDS } from '../goals.js';
import { toIconValue } from '../defaults.js';

// ---------- Reservas (antigas "Metas") ----------

export function saveGoal(input) {
  return store.commit((d) => {
    const invIds = new Set((d.investments || []).map((i) => i.id));
    const current = input.id ? findOrThrow(d.goals, input.id, 'Reserva') : null;
    // A reserva padrão é sempre de emergência; o tipo das outras vem do formulário
    const kind = current?.system || input.emergency === true ? 'emergencia' : GOAL_KIND_IDS.includes(input.kind) ? input.kind : 'outro';
    const autoTarget = kind === 'emergencia' && input.autoTarget === true;
    const item = {
      description: text(input.description, 'description', 'o nome'),
      kind,
      autoTarget,
      targetCents: autoTarget ? 0 : cents(input.targetCents, 'targetCents'),
      deadline: kind === 'mensal' ? null : date(input.deadline, 'deadline', { required: false }),
      icon: toIconValue(input.icon, 'i:target'),
      emergency: kind === 'emergencia',
      investmentIds: [...new Set((input.investmentIds || []).filter((id) => invIds.has(id)))],
    };
    // Um investimento só pode estar ligado a uma meta (senão contaria em dobro)
    for (const g of d.goals) {
      if (g.id === input.id) continue;
      const clash = (g.investmentIds || []).find((id) => item.investmentIds.includes(id));
      if (clash) {
        const inv = d.investments.find((i) => i.id === clash);
        throw new ValidationError(`"${inv?.name || 'Esse investimento'}" já está ligado à reserva "${g.description}".`, 'investmentIds');
      }
    }
    if (current) {
      Object.assign(current, item);
      return null;
    }
    const goal = { id: newId(), ...item, system: false, contributions: [] };
    if (Number.isInteger(input.initialCents) && input.initialCents > 0) {
      goal.contributions.push({ id: newId(), date: todayISO(), cents: cents(input.initialCents, 'initialCents') });
    }
    d.goals.push(goal);
    return goal;
  });
}

export function deleteGoal(id) {
  return store.commit((d) => {
    if (findOrThrow(d.goals, id, 'Reserva').system) throw new ValidationError('A Reserva de emergência é padrão e não pode ser excluída.');
    d.goals = d.goals.filter((g) => g.id !== id);
    for (const w of d.wishlist || []) if (w.goalId === id) w.goalId = null;
  }, 'change', { undo: 'Reserva excluída' });
}

/** Guarda (positivo) ou retira (negativo) dinheiro de uma reserva. */
export function addContribution(goalId, value, when = todayISO()) {
  return store.commit((d) => {
    const goal = findOrThrow(d.goals, goalId, 'Reserva');
    if (!Number.isInteger(value) || value === 0 || Math.abs(value) > MAX_CENTS) throw new ValidationError('Informe um valor.', 'cents');
    date(when, 'date');
    const saved = goal.contributions.reduce((a, c) => a + c.cents, 0);
    if (saved + value < 0) throw new ValidationError('A retirada é maior que o valor guardado.', 'cents');
    goal.contributions.push({ id: newId(), date: when, cents: value });
    const after = saved + value;
    // Alvo automático ou mensal: a comemoração fica com a tela (ver goalProgress)
    if (goal.autoTarget || goal.kind === 'mensal') return { reached: false };
    return { reached: saved < goal.targetCents && after >= goal.targetCents };
  });
}

export function deleteContribution(goalId, contributionId) {
  return store.commit((d) => {
    const goal = findOrThrow(d.goals, goalId, 'Reserva');
    const rest = goal.contributions.filter((c) => c.id !== contributionId);
    if (rest.reduce((a, c) => a + c.cents, 0) < 0) {
      throw new ValidationError('Remova antes as retiradas: o saldo da reserva ficaria negativo.');
    }
    goal.contributions = rest;
  }, 'change', { undo: 'Lançamento da reserva removido' });
}

// ---------- Lista de desejos ----------

export function saveWish(input) {
  return store.commit((d) => {
    const item = {
      name: text(input.name, 'name', 'o nome', { max: 80 }),
      targetPriceCents: cents(input.targetPriceCents ?? 0, 'targetPriceCents', { allowZero: true }),
      currentPriceCents: cents(input.currentPriceCents ?? 0, 'currentPriceCents', { allowZero: true }),
      url: /^https?:\/\//.test(input.url || '') ? String(input.url).slice(0, 300) : '',
      goalId: d.goals.some((g) => g.id === input.goalId) ? input.goalId : null,
      priority: ['alta', 'media', 'baixa'].includes(input.priority) ? input.priority : 'media',
    };
    if (input.id) {
      const w = findOrThrow(d.wishlist, input.id, 'Desejo');
      if (item.currentPriceCents && item.currentPriceCents !== w.currentPriceCents) {
        w.priceHistory = [...(w.priceHistory || []), { date: todayISO(), cents: item.currentPriceCents }].slice(-30);
      }
      Object.assign(w, item);
      return null;
    }
    const created = { id: newId(), ...item, boughtAt: null, priceHistory: item.currentPriceCents ? [{ date: todayISO(), cents: item.currentPriceCents }] : [] };
    d.wishlist.push(created);
    return created;
  });
}

export function markWishBought(id, bought = true) {
  return store.commit((d) => { findOrThrow(d.wishlist, id, 'Desejo').boughtAt = bought ? todayISO() : null; });
}

export function deleteWish(id) {
  return store.commit((d) => { d.wishlist = d.wishlist.filter((w) => w.id !== id); }, 'change', { undo: 'Desejo excluído' });
}

// ---------- Envelopes ----------

export function saveEnvelope(input) {
  return store.commit((d) => {
    const catIds = new Set(d.categories.map((c) => c.id));
    const item = {
      id: input.id || newId(),
      name: text(input.name, 'name', 'o nome do envelope', { max: 40 }),
      icon: toIconValue(input.icon, 'i:inbox'),
      monthlyCents: cents(input.monthlyCents, 'monthlyCents'),
      categoryIds: [...new Set((input.categoryIds || []).filter((id) => catIds.has(id)))],
      rollover: input.rollover !== false,
    };
    for (const e of d.settings.envelopes || []) {
      if (e.id === item.id) continue;
      const clash = e.categoryIds.find((id) => item.categoryIds.includes(id));
      if (clash) throw new ValidationError(`A categoria "${d.categories.find((c) => c.id === clash)?.name}" já está no envelope "${e.name}".`, 'categoryIds');
    }
    d.settings.envelopes = [...(d.settings.envelopes || []).filter((e) => e.id !== item.id), item];
  });
}

export function deleteEnvelope(id) {
  return store.commit((d) => { d.settings.envelopes = (d.settings.envelopes || []).filter((e) => e.id !== id); }, 'change', { undo: 'Envelope excluído' });
}

// ---------- Cenários do simulador ----------

export function saveScenario(name, scenario) {
  return store.commit((d) => {
    const n = text(name, 'name', 'o nome do cenário', { max: 60 });
    const list = (d.settings.scenarios || []).filter((s) => s.name.toLowerCase() !== n.toLowerCase());
    list.push({ id: newId(), name: n, scenario: structuredClone(scenario), createdAt: new Date().toISOString() });
    d.settings.scenarios = list.slice(-30);
  });
}

export function deleteScenario(id) {
  return store.commit((d) => { d.settings.scenarios = (d.settings.scenarios || []).filter((s) => s.id !== id); }, 'change', { undo: 'Cenário excluído' });
}

// ---------- Orçamento por categoria ----------

/** Limite mensal para a categoria (0 = sem orçamento). */
export function setBudget(categoryId, value) {
  return store.commit((d) => {
    findOrThrow(d.categories, categoryId, 'Categoria');
    d.settings.budgets ||= {};
    if (!value) delete d.settings.budgets[categoryId];
    else d.settings.budgets[categoryId] = cents(value, 'budget');
  });
}

// ---------- Fechamento de mês ----------

/**
 * Fecha o mês: congela os números (fotografia), guarda a nota de saúde
 * financeira e o relatório automático do mês ("você gastou 12% menos com
 * delivery").
 */
export function closeMonth(ym) {
  return store.commit((d) => {
    if (!isValidYM(ym)) throw new ValidationError('Mês inválido.');
    if (ym > currentYM()) throw new ValidationError('Só é possível fechar o mês atual ou meses anteriores.');
    if (d.closedMonths[ym]) throw new ValidationError(`${formatMonth(ym)} já está fechado.`);
    // Fixa o valor das recorrentes do mês: editar a recorrente depois não muda o mês fechado.
    // Contas variáveis (luz, água) ficam com a estimativa que aparecia no mês, não com o valor do cadastro.
    for (const r of d.recurring) {
      if (!recurringActiveIn(r, ym)) continue;
      const estimate = r.variable ? variableEstimate(d, r, ym) : r.cents;
      for (const due of recurringDates(r, ym)) {
        const [, e] = entry(d, r.id, FREQ_DAYS[r.freq] ? due : ym);
        if (!e.skipped) e.cents ??= estimate;
      }
    }
    // A fotografia é calculada numa CÓPIA: os cálculos guardam cache por
    // objeto de estado, e este rascunho vira o novo estado (já fechado) —
    // calcular sobre ele deixaria em cache o mês como "aberto".
    const view = structuredClone(d);
    const snap = buildSnapshot(view, ym);
    const today = todayISO();
    snap.report = monthlyReport(view, ym, today);
    snap.score = financialScore(view, ym, ym === currentYM() ? today : `${ym}-28`).score;
    d.closedMonths[ym] = snap;
    d.scoreHistory = { ...(d.scoreHistory || {}), [ym]: snap.score };
    return snap;
  });
}

export function reopenMonth(ym) {
  return store.commit((d) => { delete d.closedMonths[ym]; }, 'change', { undo: 'Mês reaberto' });
}
