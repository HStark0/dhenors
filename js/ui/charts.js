// =============================================================
// charts.js — Gráficos SVG leves (substituem o Chart.js, ~200 KB)
// -------------------------------------------------------------
// • Escalam com o container (viewBox) e seguem o tema via CSS.
// • Valores ao passar o mouse (ou tocar): dica flutuante (data-tip).
// • Clique: barras/meses e fatias podem levar a uma ação
//   (data-action), ex.: abrir o mês ou filtrar as contas pela categoria.
// • Acessibilidade: cada gráfico tem aria-label com um resumo e uma
//   TABELA alternativa ("Ver como tabela") com os mesmos números.
// =============================================================

import { html, raw, escapeHTML } from './dom.js';
import { formatBRL, formatCompactBRL } from '../core/money.js';
import { isDiscreet } from '../core/theme.js';

const fmt = (n) => (Math.round(n * 100) / 100).toString();
/** Dica com valores; `label` (sem valores) é o que aparece no modo discreto. */
const tipAttr = (text, label) => `data-tip="${escapeHTML(text)}" data-tip-label="${escapeHTML(label ?? String(text).split('\n')[0])}"`;

/**
 * Largura de desenho do gráfico ≈ largura real na tela, para que o
 * texto dos eixos fique sempre com ~11px (sem "esticar").
 * `share` = fração da largura do conteúdo que o card ocupa no computador.
 */
/**
 * O SVG escala com o card, e o texto escalaria junto (ficando minúsculo
 * num card estreito). --k desfaz a escala: o texto fica sempre em 11px.
 */
export function fitCharts(root = document) {
  for (const svg of root.querySelectorAll('.chart:not(.chart--donut) svg[viewBox]')) {
    const vb = svg.viewBox.baseVal;
    const w = svg.getBoundingClientRect().width;
    if (vb?.width && w) svg.style.setProperty('--k', (vb.width / w).toFixed(3));
    if (w) uncrowd(svg);
  }
}

/**
 * Rótulos dos eixos que se encostariam (card estreito, muitos meses):
 * mede o tamanho real na tela e esconde os que tocariam o vizinho já
 * mostrado. O primeiro e o último ficam; a dica ao tocar e a tabela
 * "Ver como tabela" continuam com todos os valores.
 */
function uncrowd(svg) {
  const GAP = 4;
  const pass = (list, horizontal) => {
    for (const t of list) t.classList.remove('is-crowded');
    const boxes = list.map((t) => t.getBoundingClientRect());
    const order = horizontal ? list.map((_, i) => i).sort((a, b) => boxes[a].left - boxes[b].left) : list.map((_, i) => i).sort((a, b) => boxes[a].top - boxes[b].top);
    const shown = [];
    const hits = (i, j) => (horizontal ? boxes[i].left < boxes[j].right + GAP && boxes[j].left < boxes[i].right + GAP : boxes[i].top < boxes[j].bottom + 1 && boxes[j].top < boxes[i].bottom + 1);
    // o último sempre aparece (fecha o eixo); os outros, se couberem
    const last = order[order.length - 1];
    for (const i of order) {
      if (i !== last && (shown.some((j) => hits(i, j)) || (order.length > 1 && hits(i, last)))) { list[i].classList.add('is-crowded'); continue; }
      shown.push(i);
    }
  };
  const x = [...svg.querySelectorAll('text.chart__axis:not(.chart__axis--value)')].filter((t) => t.textContent.trim());
  const yv = [...svg.querySelectorAll('text.chart__axis--value')];
  if (x.length > 1) pass(x, true);
  if (yv.length > 1) pass(yv, false);
  // No canto, o valor de baixo do eixo Y pode encostar no 1º mês: sai o valor
  const shownX = x.filter((t) => !t.classList.contains('is-crowded')).map((t) => t.getBoundingClientRect());
  for (const t of yv) {
    if (t.classList.contains('is-crowded')) continue;
    const b = t.getBoundingClientRect();
    if (shownX.some((r) => b.left < r.right && r.left < b.right && b.top < r.bottom && r.top < b.bottom)) t.classList.add('is-crowded');
  }
}

export function chartWidth(share = 1) {
  const view = globalThis.document?.getElementById('view')?.clientWidth || 600;
  const fraction = view < 760 ? 1 : share;
  return Math.round(Math.max(300, Math.min(1400, view * fraction - 48)));
}

/** Escala "bonita" para o eixo Y. */
function niceMax(value) {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const f = value / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

/** Eixo com 4 intervalos "redondos" que cobrem [min, max] (inclui o zero). */
function niceScale(minRaw, maxRaw, steps = 4) {
  const lo = Math.min(0, minRaw), hi = Math.max(0, maxRaw);
  const step = niceMax((hi - lo) / steps || 1);
  const min = Math.floor(lo / step) * step;
  let max = Math.ceil(hi / step) * step;
  if (max === min) max = min + step;
  return { min, max, step, ticks: Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + i * step) };
}

function arc(cx, cy, r, start, end) {
  const large = end - start > Math.PI ? 1 : 0;
  const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
  return `M${fmt(x1)} ${fmt(y1)}A${r} ${r} 0 ${large} 1 ${fmt(x2)} ${fmt(y2)}`;
}

/** Tabela alternativa (leitores de tela e quem prefere números). */
function dataTable(caption, head, rows) {
  return html`
    <details class="chart-table">
      <summary>Ver como tabela</summary>
      <div class="table-wrap">
        <table class="table table--compact">
          <caption class="sr-only">${caption}</caption>
          <thead><tr>${head.map((h, i) => html`<th scope="col" ${i ? '' : html`class="text-left"`}>${h}</th>`)}</tr></thead>
          <tbody>${rows.map((r) => html`<tr>${r.map((c, i) => (i ? html`<td class="money">${c}</td>` : html`<th scope="row">${c}</th>`))}</tr>`)}</tbody>
        </table>
      </div>
    </details>`;
}

/**
 * Rosca (distribuição). Até `max` fatias; o resto vira "Outros".
 * segments: [{ label, value (centavos), color, id? }]
 * `action`: nome da ação ao clicar numa fatia/legenda (recebe data-id).
 */
export function donutChart(segments, { center = '', centerSub = '', max = 6, label = 'Distribuição', action = null } = {}) {
  const data = segments.filter((s) => s.value > 0);
  if (data.length > max) {
    const rest = data.splice(max - 1);
    data.push({ label: 'Outros', value: rest.reduce((a, s) => a + s.value, 0), color: '#94A3B8', id: null });
  }
  const total = data.reduce((a, s) => a + s.value, 0);
  if (!total) return emptyChart('Sem gastos para mostrar.');

  const size = 160, cx = 80, cy = 80, r = 62, stroke = 22;
  let angle = -Math.PI / 2;
  const gap = data.length > 1 ? 0.025 : 0;

  const arcs = data.map((s, si) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const start = angle + gap / 2;
    const end = angle + sweep - gap / 2;
    angle += sweep;
    const pct = ((s.value / total) * 100).toFixed(0);
    const d = sweep >= Math.PI * 2 - 0.001
      ? `M${cx} ${cy - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}`
      : arc(cx, cy, r, start, Math.max(start + 0.001, end));
    const clickable = action && s.id !== undefined && s.id !== null;
    return `<path d="${d}" pathLength="1" fill="none" stroke-width="${stroke}" style="stroke:${escapeHTML(s.color)};--s:${si}" ${tipAttr(`${s.label}: ${formatBRL(s.value)} (${pct}%)`, s.label)} ${clickable ? `data-action="${escapeHTML(action)}" data-id="${escapeHTML(s.id)}" class="is-clickable" tabindex="0" role="button" aria-label="Filtrar ${escapeHTML(s.label)}"` : ''}></path>`;
  }).join('');

  const summary = data.map((s) => `${s.label} ${((s.value / total) * 100).toFixed(0)}%`).join(', ');

  return html`
    <figure class="chart chart--donut">
      <svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}: ${summary}">
        ${raw(arcs)}
        <text x="${cx}" y="${cy - 2}" class="chart__center">${center}</text>
        <text x="${cx}" y="${cy + 16}" class="chart__center-sub">${centerSub}</text>
      </svg>
      <ul class="legend">
        ${data.map((s) => {
          const inner = html`
            <span class="legend__dot" style="background:${s.color}"></span>
            <span class="legend__label">${s.label}</span>
            <span class="legend__value">${formatBRL(s.value)}</span>
            <span class="legend__pct">${((s.value / total) * 100).toFixed(0)}%</span>`;
          return action && s.id != null
            ? html`<li><button type="button" class="legend__btn" data-action="${action}" data-id="${s.id}" title="Ver as contas desta categoria">${inner}</button></li>`
            : html`<li>${inner}</li>`;
        })}
      </ul>
      ${dataTable(label, ['Categoria', 'Valor', '%'], data.map((s) => [s.label, formatBRL(s.value), `${((s.value / total) * 100).toFixed(0)}%`]))}
    </figure>`;
}

/**
 * Barras agrupadas, com linha opcional por cima (ex.: saldo).
 * labels: ['jan/26', ...]
 * series: [{ name, values: [centavos...], className }]  (className define a cor no CSS)
 * o.line: { name, values, className } — desenhada sobre as barras
 * o.action + o.keys: ao clicar num mês, dispara a ação com data-key = keys[i]
 */
export function barChart(labels, series, { label = 'Gráfico de barras', height = 220, width = 600, line = null, action = null, keys = null } = {}) {
  const all = [...series.flatMap((s) => s.values), ...(line ? line.values : [])];
  if (!all.some((v) => v !== 0)) return emptyChart('Ainda não há dados no período.');

  const W = width, H = height, padL = 60, padB = 26, padT = 10, padR = 8;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const scale = niceScale(Math.min(...all), Math.max(...all));
  const range = scale.max - scale.min;
  const y = (v) => padT + plotH - ((v - scale.min) / range) * plotH;

  const groupW = plotW / labels.length;
  const barW = Math.min(36, (groupW * 0.7) / series.length);

  let grid = '';
  for (const v of scale.ticks) {
    const yy = fmt(y(v));
    grid += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" class="chart__grid ${v === 0 ? 'is-zero' : ''}"/>`;
    grid += `<text x="${padL - 6}" y="${yy}" class="chart__axis chart__axis--value" text-anchor="end" dominant-baseline="middle">${escapeHTML(formatCompactBRL(v))}</text>`;
  }

  let bars = '';
  labels.forEach((lab, gi) => {
    const gx = padL + gi * groupW + (groupW - barW * series.length) / 2;
    const tip = [lab, ...series.map((s) => `${s.name}: ${formatBRL(s.values[gi] || 0)}`), ...(line ? [`${line.name}: ${formatBRL(line.values[gi] || 0)}`] : [])].join('\n');
    // Área de toque do mês inteiro (dica + clique)
    bars += `<rect x="${fmt(padL + gi * groupW)}" y="${padT}" width="${fmt(groupW)}" height="${fmt(plotH)}" class="chart__hit" ${tipAttr(tip)} ${action && keys ? `data-action="${escapeHTML(action)}" data-key="${escapeHTML(keys[gi])}" tabindex="0" role="button" aria-label="Abrir ${escapeHTML(lab)}"` : ''}></rect>`;
    series.forEach((s, si) => {
      const v = s.values[gi] || 0;
      const top = y(Math.max(v, 0)), bottom = y(Math.min(v, 0));
      const h = Math.max(v === 0 ? 0 : 1.5, bottom - top);
      bars += `<rect x="${fmt(gx + si * barW)}" y="${fmt(top)}" width="${fmt(barW - 2)}" height="${fmt(h)}" rx="3" class="chart__bar ${escapeHTML(s.className || '')} ${v < 0 ? 'is-down' : ''}" style="--b:${gi}" pointer-events="none"></rect>`;
    });
    bars += `<text x="${fmt(padL + gi * groupW + groupW / 2)}" y="${H - 6}" class="chart__axis" text-anchor="middle">${escapeHTML(lab)}</text>`;
  });

  let overlay = '';
  if (line) {
    const pts = line.values.map((v, i) => `${fmt(padL + i * groupW + groupW / 2)},${fmt(y(v))}`).join(' ');
    overlay = `<polyline points="${pts}" pathLength="1" fill="none" class="chart__line ${escapeHTML(line.className || '')}" pointer-events="none"/>`
      + line.values.map((v, i) => `<circle cx="${fmt(padL + i * groupW + groupW / 2)}" cy="${fmt(y(v))}" r="3.5" class="chart__dot ${escapeHTML(line.className || '')}" pointer-events="none"/>`).join('');
  }

  const legendSeries = line ? [...series, line] : series;
  return html`
    <figure class="chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}" preserveAspectRatio="xMidYMid meet">
        ${raw(grid)}${raw(bars)}${raw(overlay)}
      </svg>
      ${legendSeries.length > 1 ? legendInline(legendSeries) : ''}
      ${dataTable(label, ['Mês', ...legendSeries.map((s) => s.name)], labels.map((lab, i) => [lab, ...legendSeries.map((s) => formatBRL(s.values[i] || 0))]))}
    </figure>`;
}

/**
 * Linha (evolução). Mesmo formato do barChart.
 * o.area: preenche abaixo da 1ª série · o.marks: [{ index, label }] destaques
 */
export function lineChart(labels, series, { label = 'Gráfico de linha', height = 220, width = 600, area = false, marks = [], action = null, keys = null, every = 1, format = formatBRL } = {}) {
  const axis = format === formatBRL ? formatCompactBRL : format;
  const all = series.flatMap((s) => s.values);
  if (!all.length || !all.some((v) => v !== 0)) return emptyChart('Ainda não há dados no período.');

  const W = width, H = height, padL = 60, padB = 26, padT = 12, padR = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const scale = niceScale(Math.min(...all), Math.max(...all));
  const range = scale.max - scale.min;
  const x = (i) => padL + (labels.length === 1 ? plotW / 2 : (i * plotW) / (labels.length - 1));
  const y = (v) => padT + plotH - ((v - scale.min) / range) * plotH;

  let grid = '';
  for (const v of scale.ticks) {
    const yy = fmt(y(v));
    grid += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" class="chart__grid ${v === 0 ? 'is-zero' : ''}"/>`;
    grid += `<text x="${padL - 6}" y="${yy}" class="chart__axis chart__axis--value" text-anchor="end" dominant-baseline="middle">${escapeHTML(axis(v))}</text>`;
  }
  const step = Math.max(every, Math.ceil(labels.length / Math.max(2, Math.floor(plotW / 54))));
  labels.forEach((lab, i) => {
    if (i % step && i !== labels.length - 1) return;
    grid += `<text x="${fmt(x(i))}" y="${H - 6}" class="chart__axis" text-anchor="middle">${escapeHTML(lab)}</text>`;
  });

  const lines = series.map((s, si) => {
    const pts = s.values.map((v, i) => `${fmt(x(i))},${fmt(y(v))}`).join(' ');
    const fill = area && si === 0
      ? `<polygon points="${fmt(x(0))},${fmt(y(Math.max(scale.min, 0)))} ${pts} ${fmt(x(s.values.length - 1))},${fmt(y(Math.max(scale.min, 0)))}" class="chart__area ${escapeHTML(s.className || '')}"/>`
      : '';
    const dots = labels.length <= 14 ? s.values.map((v, i) => `<circle cx="${fmt(x(i))}" cy="${fmt(y(v))}" r="3.5" class="chart__dot ${escapeHTML(s.className || '')}"/>`).join('') : '';
    return `${fill}<polyline points="${pts}" ${s.dashed ? '' : 'pathLength="1"'} fill="none" class="chart__line ${escapeHTML(s.className || '')} ${s.dashed ? 'is-dashed' : ''}"/>${dots}`;
  }).join('');

  // Faixas invisíveis por ponto: dica e clique
  const hits = labels.map((lab, i) => {
    const left = i === 0 ? padL : (x(i - 1) + x(i)) / 2;
    const right = i === labels.length - 1 ? W - padR : (x(i) + x(i + 1)) / 2;
    const tip = [lab, ...series.map((s) => `${s.name}: ${format(s.values[i])}`)].join('\n');
    // Teclado: um só ponto na ordem do Tab; ← → Home End andam entre eles (ver initChartTips)
    const a11y = `data-point tabindex="${i === 0 ? 0 : -1}" role="${action && keys ? 'button' : 'img'}" aria-label="${escapeHTML(tip.replace(/\n/g, ', '))}"`;
    return `<rect x="${fmt(left)}" y="${padT}" width="${fmt(Math.max(1, right - left))}" height="${fmt(plotH)}" class="chart__hit" ${tipAttr(tip)} ${a11y} ${action && keys ? `data-action="${escapeHTML(action)}" data-key="${escapeHTML(keys[i])}"` : ''}></rect>`;
  }).join('');

  const markSVG = marks.map((m) => `<g class="chart__mark"><line x1="${fmt(x(m.index))}" x2="${fmt(x(m.index))}" y1="${padT}" y2="${padT + plotH}"/><text x="${fmt(x(m.index))}" y="${padT + 10}" text-anchor="middle">${escapeHTML(m.label)}</text></g>`).join('');

  return html`
    <figure class="chart">
      <svg viewBox="0 0 ${W} ${H}" role="group" aria-label="${label} (use as setas para ver cada ponto)" preserveAspectRatio="xMidYMid meet">
        ${raw(grid)}${raw(markSVG)}${raw(lines)}${raw(hits)}
      </svg>
      ${series.length > 1 ? legendInline(series) : ''}
      ${dataTable(label, ['', ...series.map((s) => s.name)], labels.map((lab, i) => [lab, ...series.map((s) => format(s.values[i]))]))}
    </figure>`;
}

/**
 * Minigráfico (sparkline) para KPIs: linha dos últimos meses, sem eixos.
 * tone: 'up-good' (subir é bom) | 'up-bad' (subir é ruim)
 */
export function sparkline(values, { label = 'Últimos meses', width = 120, height = 32, tone = 'up-good', format = formatBRL } = {}) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2 || !v.some((x) => x !== 0)) return '';
  const min = Math.min(...v), max = Math.max(...v);
  const range = max - min || 1;
  const x = (i) => 2 + (i * (width - 4)) / (v.length - 1);
  const y = (n) => height - 3 - ((n - min) / range) * (height - 6);
  const pts = v.map((n, i) => `${fmt(x(i))},${fmt(y(n))}`).join(' ');
  const up = v[v.length - 1] >= v[v.length - 2];
  const good = tone === 'up-good' ? up : !up;
  return html`
    <svg class="spark ${good ? 'spark--good' : 'spark--bad'}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${label}: ${v.map((n) => format(n)).join(', ')}">
      ${raw(`<polyline points="${pts}" fill="none"/>`)}
      ${raw(`<circle cx="${fmt(x(v.length - 1))}" cy="${fmt(y(v[v.length - 1]))}" r="2.5"/>`)}
    </svg>`;
}

/** Barra de progresso acessível. */
export function meter(value, { max = 100, label = '', tone = '' } = {}) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return html`
    <div class="meter ${tone ? `meter--${tone}` : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100"
      aria-valuenow="${Math.round(pct)}" aria-label="${label}">
      <span class="meter__fill" style="width:${pct.toFixed(1)}%"></span>
    </div>`;
}

function legendInline(series) {
  return html`<ul class="legend legend--inline">
    ${series.map((s) => html`<li><span class="legend__dot ${s.className || ''} ${s.dashed ? 'is-dashed' : ''}"></span>${s.name}</li>`)}
  </ul>`;
}

function emptyChart(message) {
  return html`<div class="chart-empty">${message}</div>`;
}

// ---------- Dica flutuante (valores ao passar o mouse / tocar) ----------

let tipEl = null;

/** Liga as dicas dos gráficos (uma vez). Usa delegação: vale para gráficos desenhados depois. */
export function initChartTips() {
  if (tipEl || !globalThis.document) return;
  tipEl = document.createElement('div');
  tipEl.className = 'chart-tip';
  tipEl.setAttribute('role', 'tooltip');
  tipEl.hidden = true;
  document.body.append(tipEl);
  const show = (target, x, y) => {
    // Modo discreto: só o rótulo (mês/categoria), sem os valores
    tipEl.textContent = isDiscreet() ? (target.getAttribute('data-tip-label') || '') : target.getAttribute('data-tip');
    if (!tipEl.textContent) { hide(); return; }
    tipEl.hidden = false;
    const r = tipEl.getBoundingClientRect();
    tipEl.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, x - r.width / 2))}px`;
    tipEl.style.top = `${Math.max(8, y - r.height - 12)}px`;
    target.classList.add('is-hover');
  };
  const hide = () => {
    tipEl.hidden = true;
    document.querySelectorAll('.chart .is-hover').forEach((n) => n.classList.remove('is-hover'));
  };
  document.addEventListener('pointermove', (ev) => {
    const t = ev.target.closest?.('.chart [data-tip]');
    if (!t) { if (!tipEl.hidden) hide(); return; }
    document.querySelectorAll('.chart .is-hover').forEach((n) => n !== t && n.classList.remove('is-hover'));
    show(t, ev.clientX, ev.clientY);
  }, { passive: true });
  document.addEventListener('focusin', (ev) => {
    const t = ev.target.closest?.('.chart [data-tip]');
    if (!t) return;
    const r = t.getBoundingClientRect();
    show(t, r.left + r.width / 2, r.top);
  });
  document.addEventListener('focusout', hide);
  // Pontos do gráfico de linha: ← → Home End (foco "itinerante")
  document.addEventListener('keydown', (ev) => {
    const t = ev.target.closest?.('.chart [data-point]');
    if (!t || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
    const list = [...t.parentNode.querySelectorAll('[data-point]')];
    const i = list.indexOf(t);
    const next = ev.key === 'Home' ? 0 : ev.key === 'End' ? list.length - 1 : Math.max(0, Math.min(list.length - 1, i + (ev.key === 'ArrowRight' ? 1 : -1)));
    ev.preventDefault();
    list.forEach((n, k) => n.setAttribute('tabindex', k === next ? '0' : '-1'));
    list[next].focus();
  });
  document.addEventListener('scroll', hide, { passive: true, capture: true });
}
