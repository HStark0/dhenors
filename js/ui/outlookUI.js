// =============================================================
// outlookUI.js — Peças visuais da previsão (usadas em várias telas)
// -------------------------------------------------------------
// • statusBadge     folgado / apertado / não fecha (ícone + texto)
// • monthStrip      faixa dos próximos meses (Painel, 12 meses,
//                   Agenda, Planejamento); tocar abre o porquê
// • openMonthDetails  o que pesa no mês e as dicas para resolver
// • flagBadges      selos dos lançamentos (exagerado, fora do comum,
//                   pesa no futuro)
// • impactBox       prévia ao vivo no editor de contas
// • adviceList      dicas simples, médias e para planejar
// Tudo vem do domínio (outlook.js, weights.js, advice.js): aqui só
// se desenha. Nunca depende só de cor: sempre há ícone e texto.
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';
import { openDialog } from './dialog.js';
import { store } from '../core/store.js';
import { formatBRL, formatCompactBRL, plural } from '../core/money.js';
import { formatMonth, formatMonthShort, formatMonthTitle, formatDateBR, todayISO } from '../core/dates.js';
import { monthWhy } from '../domain/outlook.js';
import { adviceFor, LEVELS } from '../domain/advice.js';
import { STATUS_LABELS, STATUS_TONES, STATUS_ICONS } from '../domain/monthStatus.js';

/** "R$ 120,00" / "−R$ 120,00" */
export const signedBRL = (c) => (c < 0 ? `−${formatBRL(-c)}` : formatBRL(c));

/** Selo da situação do mês. */
export function statusBadge(status, { label = null } = {}) {
  return html`<span class="mstatus mstatus--${status}">${icon(STATUS_ICONS[status] || 'info', 'icon--xs')} ${label || STATUS_LABELS[status]}</span>`;
}

const STATUS_SENTENCE = { ok: 'folgado', tight: 'apertado', short: 'não fecha', none: 'sem dados' };

/**
 * Faixa de meses. rows = yearPlan().months
 * opts: { action (null = só informativo), selected, caption }
 */
export function monthStrip(rows, { action = 'outlook:month', selected = null, caption = 'Toque num mês para ver o que pesa nele.' } = {}) {
  if (!rows.length) return '';
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.balance)));
  return html`
    <div class="mstrip-wrap">
      <ol class="mstrip" role="list" aria-label="Situação dos próximos ${rows.length} meses">
        ${rows.map((r) => {
          const label = `${formatMonth(r.ym)}: ${STATUS_SENTENCE[r.status]}, ${r.balance < 0 ? `faltam ${formatBRL(-r.balance)}` : `sobra ${formatBRL(r.balance)}`}`;
          const cls = `mstrip__cell mstrip__cell--${r.status} ${selected === r.ym ? 'is-selected' : ''} ${action ? '' : 'is-static'}`;
          const inner = html`
              <span class="mstrip__month">${formatMonthShort(r.ym).split('/')[0]}<small>${formatMonthShort(r.ym).split('/')[1]}</small></span>
              <span class="mstrip__bar" aria-hidden="true"><span style="--h:${Math.max(6, Math.round((Math.abs(r.balance) / max) * 100))}%" class="${r.balance < 0 ? 'is-neg' : ''}"></span></span>
              <span class="mstrip__value money">${r.balance < 0 ? '−' : ''}${formatCompactBRL(Math.abs(r.balance)).replace('R$ ', '')}</span>
              <span class="mstrip__icon" aria-hidden="true">${icon(STATUS_ICONS[r.status] || 'info', 'icon--xs')}</span>`;
          // Sem ação (ex.: "Posso comprar?", que mostra os meses COM a compra): só informativo
          return html`<li>${action
            ? html`<button type="button" class="${cls}" data-action="${action}" data-ym="${r.ym}" aria-label="${label}">${inner}</button>`
            : html`<span class="${cls}" role="img" aria-label="${label}">${inner}</span>`}</li>`;
        })}
      </ol>
      <ul class="mstrip__legend" aria-hidden="true">
        <li><span class="mstatus-dot mstatus-dot--ok"></span>Folgado</li>
        <li><span class="mstatus-dot mstatus-dot--tight"></span>Apertado</li>
        <li><span class="mstatus-dot mstatus-dot--short"></span>Não fecha</li>
      </ul>
      ${caption ? html`<p class="muted small">${caption}</p>` : ''}
    </div>`;
}

const CAUSE_ICON = { installment: 'calendar-range', invoice: 'credit-card', seasonal: 'calendar-clock', fixed: 'repeat', big: 'zap', expenses: 'receipt', estimate: 'shopping-cart' };

/** Janela "por que este mês aperta" com as dicas para resolver. */
export function openMonthDetails(ym) {
  const d = store.data;
  const today = todayISO();
  const why = monthWhy(d, ym, today);
  const advice = adviceFor(d, ym, today);
  const tips = [...advice.media, ...advice.complexa].filter((t) => t.ym === ym || t.id === 'room');
  const maxCause = Math.max(1, ...why.causes.map((c) => c.cents));
  const { close } = openDialog({
    title: formatMonthTitle(ym),
    size: 'md',
    body: html`
      <div class="mdetail tone-${STATUS_TONES[why.status]}">
        <div class="mdetail__head">
          ${statusBadge(why.status)}
          <p class="mdetail__balance money ${why.balance < 0 ? 'neg' : ''}">${signedBRL(why.balance)}</p>
          <p class="muted small">${formatBRL(why.income)} de ganhos − ${formatBRL(why.spent)} de gastos${why.forecast ? ' (previsão, com o dia a dia estimado)' : ''}</p>
        </div>
        ${why.status === 'short' ? html`<p class="note note--bad">${icon('circle-alert')}<span>Faltam <strong>${formatBRL(why.gap)}</strong> para fechar o mês${why.toOk > why.gap ? ` e ${formatBRL(why.toOk)} para ter a folga mínima` : ''}.</span></p>`
          : why.status === 'tight' ? html`<p class="note note--warn">${icon('triangle-alert')}<span>Sobra pouco: faltam <strong>${formatBRL(why.toOk)}</strong> para a folga mínima (Ajustes → Alertas e dicas).</span></p>` : ''}
        ${why.incomeNote ? html`<p class="note">${icon('info')}<span>${why.incomeNote}</span></p>` : ''}
        <h3 class="dialog__subtitle">O que pesa neste mês</h3>
        ${why.causes.length ? html`
          <ul class="causes">
            ${why.causes.map((c) => html`
              <li class="causes__row">
                <span class="causes__label">${icon(CAUSE_ICON[c.kind] || 'receipt', 'icon--xs')} ${c.label}${c.note ? html` <small class="muted">· ${c.note}</small>` : ''}</span>
                <span class="money">${formatBRL(c.cents)}</span>
                <span class="causes__bar" aria-hidden="true"><span style="width:${Math.round((c.cents / maxCause) * 100)}%"></span></span>
              </li>`)}
          </ul>` : html`<p class="muted">Nenhum gasto lançado neste mês.</p>`}
        ${tips.length ? html`<h3 class="dialog__subtitle">Como resolver</h3>${tipList(tips)}` : ''}
        <div class="card__actions">
          <button type="button" class="btn btn--secondary btn--sm" data-go-month="${ym}">${icon('receipt', 'icon--xs')} Ver contas do mês</button>
          <a class="btn btn--ghost btn--sm" href="#/planejamento?aba=ano">${icon('calendar-range', 'icon--xs')} 12 meses</a>
        </div>
      </div>`,
    onMount: (dlg) => {
      dlg.querySelector('[data-go-month]')?.addEventListener('click', () => {
        store.setUI({ ym });
        location.hash = '#/contas?aba=mes';
        close();
      });
    },
  });
}

const TIP_ICON = { good: 'trending-up', warn: 'triangle-alert', bad: 'circle-alert', info: 'lightbulb' };

/** Lista de dicas (mesmo visual do "O que fazer agora"). */
export function tipList(tips, { actions = true } = {}) {
  return html`
    <ul class="next-actions">
      ${tips.map((t) => html`
        <li class="next-action next-action--${t.tone}">
          ${icon(TIP_ICON[t.tone] || 'lightbulb')}
          <div><strong>${t.title}</strong><p>${t.text}</p></div>
          ${actions && t.action ? html`<a class="btn btn--secondary btn--sm" href="${t.action.route}">${t.action.label}</a>` : ''}
        </li>`)}
    </ul>`;
}

/** Dicas por nível, com títulos. levels = ['simples', 'media', 'complexa'] */
export function adviceList(advice, { levels = ['simples', 'media', 'complexa'], limit = 4 } = {}) {
  const groups = levels.map((lv) => ({ lv, list: advice[lv].slice(0, limit) })).filter((g) => g.list.length);
  if (!groups.length) return html`<p class="muted small">Nenhuma dica agora: seus próximos meses estão sob controle.</p>`;
  return html`${groups.map((g) => html`
    <section class="advice-group" aria-label="Dicas ${LEVELS[g.lv].toLowerCase()}">
      <h3 class="advice-group__title"><span class="advice-level advice-level--${g.lv}">${LEVELS[g.lv]}</span></h3>
      ${tipList(g.list)}
    </section>`)}`;
}

const WEIGHT_ICON = { installment: 'calendar-range', card: 'credit-card', recurring: 'repeat', debt: 'hand-coins' };

/** Lista do que pesa no futuro: ícone e nome lado a lado, prazo embaixo, valor por mês à direita. */
export function weightList(fw, limit = 20) {
  return html`
    <ul class="mini-list weight-list">
      ${fw.list.slice(0, limit).map((w) => html`
        <li>
          <span class="weight-row">${icon(WEIGHT_ICON[w.kind] || 'hourglass', 'icon--xs')}
            <span class="weight-row__text"><span>${w.label}</span>
              <small class="muted">${w.endless ? 'todo mês, sem data para acabar' : `${plural(w.months.length, 'mês', 'meses')} · até ${formatMonthShort(w.until)}`}</small></span></span>
          <span class="money">${formatBRL(w.perMonth)}<small class="muted">/mês</small></span>
        </li>`)}
    </ul>`;
}

const FLAG_ICON = { over: 'trending-up', unusual: 'zap', future: 'hourglass' };
const FLAG_SR = { over: 'Gasto exagerado', unusual: 'Gasto fora do comum', future: 'Pesa no futuro' };

/** Selos de um lançamento (discretos, com texto completo no title e para leitores de tela). */
export function flagBadges(flags) {
  if (!flags?.length) return '';
  return html`${flags.map((f) => html`<span class="flag flag--${f.type}" title="${FLAG_SR[f.type]}: ${f.text}">${icon(FLAG_ICON[f.type], 'icon--xs')}<span class="sr-only">${FLAG_SR[f.type]}: </span>${f.label}</span>`)}`;
}

/**
 * Prévia do impacto (editor de contas). preview = impactPreview()
 * mode: 'all' mostra todos os meses afetados (parcelas, compra);
 *       'weighs' só os meses em que pesa (recorrente).
 */
export function impactBox(preview, { mode = 'all' } = {}) {
  if (!preview) return '';
  const { headline } = preview;
  const list = mode === 'weighs' ? preview.weighs : preview.affected.filter((r) => r.has || r.delta);
  const shown = list.slice(0, 24);
  return html`
    <div class="impact impact--${headline.tone}">
      <p class="impact__headline">${icon(TIP_ICON[headline.tone] || 'info')}<span>${headline.text}</span></p>
      ${shown.length ? html`
        <ol class="impact__months" role="list" aria-label="Saldo previsto dos meses ${mode === 'weighs' ? 'em que pesa' : 'afetados'}">
          ${shown.map((r) => html`
            <li class="impact__m impact__m--${r.statusAfter} ${r.weighs ? 'is-weighs' : ''}" title="${formatMonth(r.ym)}: ${signedBRL(r.before)} → ${signedBRL(r.after)}">
              <span class="impact__mon">${formatMonthShort(r.ym)}</span>
              <strong class="money">${signedBRL(r.after)}</strong>
              <small>${r.delta ? `${r.delta < 0 ? '−' : '+'}${formatBRL(Math.abs(r.delta))}` : 'sem mudança'}</small>
              ${r.weighs ? html`<span class="impact__tag">${icon(STATUS_ICONS[r.statusAfter], 'icon--xs')} ${STATUS_LABELS[r.statusAfter].toLowerCase()}</span>` : ''}
            </li>`)}
        </ol>`
      : mode === 'weighs' && preview.affected.length ? html`<p class="small muted">${icon('circle-check', 'icon--xs')} Em nenhum dos próximos meses ela deixa o mês apertado (${plural(preview.affected.filter((r) => r.has).length, 'mês', 'meses')} com cobrança).</p>` : ''}
      ${preview.beyond ? html`<p class="small muted">+ ${plural(preview.beyond, 'parcela', 'parcelas')} depois de ${formatMonthShort(preview.months[preview.months.length - 1].ym)}.</p>` : ''}
      ${preview.untilPay ? html`<p class="small">${icon('calendar', 'icon--xs')} Até o salário de ${formatDateBR(preview.untilPay.nextPay)}: livre ${signedBRL(preview.untilPay.free)} → <strong class="${preview.untilPay.after < 0 ? 'neg' : ''}">${signedBRL(preview.untilPay.after)}</strong></p>` : ''}
    </div>`;
}

/**
 * Liga a prévia a um formulário: recalcula ao digitar (com espera
 * curta, sem refazer a previsão a cada tecla) e desenha em `box`.
 * read(form) → draft | null (incompleto)
 */
export function bindImpact(form, box, read, { mode = 'all', delay = 220 } = {}) {
  let timer = null;
  let last = '';
  const run = async () => {
    try {
      const draft = read(form);
      const key = JSON.stringify(draft);
      if (key === last) return;
      last = key;
      if (!draft) { box.innerHTML = ''; return; }
      const { impactPreview } = await import('../domain/outlook.js');
      box.innerHTML = String(impactBox(impactPreview(store.data, draft, todayISO()), { mode }));
    } catch (err) {
      console.warn('[prévia]', err);
      box.innerHTML = '';
    }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(run, delay); };
  form.addEventListener('input', schedule);
  form.addEventListener('change', schedule);
  run();
}

/** Ações globais (main.js). */
export const outlookActions = {
  'outlook:month': (el) => openMonthDetails(el.dataset.ym),
};
