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

// ---------- Metas ----------

export function saveGoal(input) {
  return store.commit((d) => {
    const invIds = new Set((d.investments || []).map((i) => i.id));
    const item = {
      description: text(input.description, 'description', 'a descrição'),
      targetCents: cents(input.targetCents, 'targetCents'),
      deadline: date(input.deadline, 'deadline', { required: false }),
      icon: text(input.icon || '🎯', 'icon', 'o ícone', { max: 24 }),
      emergency: input.emergency === true,
      investmentIds: [...new Set((input.investmentIds || []).filter((id) => invIds.has(id)))],
    };
    // Um investimento só pode estar ligado a uma meta (senão contaria em dobro)
    for (const g of d.goals) {
      if (g.id === input.id) continue;
      const clash = (g.investmentIds || []).find((id) => item.investmentIds.includes(id));
      if (clash) {
        const inv = d.investments.find((i) => i.id === clash);
        throw new ValidationError(`"${inv?.name || 'Esse investimento'}" já está ligado à meta "${g.description}".`, 'investmentIds');
      }
    }
    if (input.id) {
      Object.assign(findOrThrow(d.goals, input.id, 'Meta'), item);
      return null;
    }
    const goal = { id: newId(), ...item, contributions: [] };
    if (Number.isInteger(input.initialCents) && input.initialCents > 0) {
      goal.contributions.push({ id: newId(), date: todayISO(), cents: cents(input.initialCents, 'initialCents') });
    }
    d.goals.push(goal);
    return goal;
  });
}

export function deleteGoal(id) {
  return store.commit((d) => {
    d.goals = d.goals.filter((g) => g.id !== id);
    for (const w of d.wishlist || []) if (w.goalId === id) w.goalId = null;
  }, 'change', { undo: 'Meta excluída' });
}

/** Guarda (positivo) ou retira (negativo) dinheiro de uma meta. */
export function addContribution(goalId, value, when = todayISO()) {
  return store.commit((d) => {
    const goal = findOrThrow(d.goals, goalId, 'Meta');
    if (!Number.isInteger(value) || value === 0 || Math.abs(value) > MAX_CENTS) throw new ValidationError('Informe um valor.', 'cents');
    date(when, 'date');
    const saved = goal.contributions.reduce((a, c) => a + c.cents, 0);
    if (saved + value < 0) throw new ValidationError('A retirada é maior que o valor guardado.', 'cents');
    goal.contributions.push({ id: newId(), date: when, cents: value });
    const after = saved + value;
    return { reached: saved < goal.targetCents && after >= goal.targetCents };
  });
}

export function deleteContribution(goalId, contributionId) {
  return store.commit((d) => {
    const goal = findOrThrow(d.goals, goalId, 'Meta');
    const rest = goal.contributions.filter((c) => c.id !== contributionId);
    if (rest.reduce((a, c) => a + c.cents, 0) < 0) {
      throw new ValidationError('Remova antes as retiradas: o saldo da meta ficaria negativo.');
    }
    goal.contributions = rest;
  }, 'change', { undo: 'Lançamento da meta removido' });
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
      icon: text(input.icon || '🫙', 'icon', 'o ícone', { max: 24 }),
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
