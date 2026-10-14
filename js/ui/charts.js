// =============================================================
// charts.js — Gráficos SVG leves (substituem o Chart.js, ~200 KB)
// -------------------------------------------------------------
// • Escalam com o container (viewBox) e seguem o tema via CSS.
// • Cada barra/fatia tem <title> (dica ao passar o mouse) e o
//   gráfico tem aria-label com um resumo para leitores de tela.
// =============================================================

import { html, raw, escapeHTML } from './dom.js';
import { formatBRL, formatCompactBRL } from '../core/money.js';

const fmt = (n) => (Math.round(n * 100) / 100).toString();

/**
 * Largura de desenho do gráfico ≈ largura real na tela, para que o
 * texto dos eixos fique sempre com ~11px (sem "esticar").
 * `share` = fração da largura do conteúdo que o card ocupa no computador.
 */
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

/**
 * Rosca (distribuição). Até `max` fatias; o resto vira "Outros".
 * segments: [{ label, value (centavos), color }]
 */
export function donutChart(segments, { center = '', centerSub = '', max = 6, label = 'Distribuição' } = {}) {
  const data = segments.filter((s) => s.value > 0);
  if (data.length > max) {
    const rest = data.splice(max - 1);
    data.push({ label: 'Outros', value: rest.reduce((a, s) => a + s.value, 0), color: '#94A3B8' });
  }
  const total = data.reduce((a, s) => a + s.value, 0);
  if (!total) return emptyChart('Sem gastos para mostrar.');

  const size = 160, cx = 80, cy = 80, r = 62, stroke = 22;
  let angle = -Math.PI / 2;
  const gap = data.length > 1 ? 0.025 : 0;

  const arcs = data.map((s) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const start = angle + gap / 2;
    const end = angle + sweep - gap / 2;
    angle += sweep;
    const pct = ((s.value / total) * 100).toFixed(0);
    const d = sweep >= Math.PI * 2 - 0.001
      ? `M${cx} ${cy - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}`
      : arc(cx, cy, r, start, Math.max(start + 0.001, end));
    return `<path d="${d}" fill="none" stroke-width="${stroke}" style="stroke:${escapeHTML(s.color)}"><title>${escapeHTML(s.label)}: ${formatBRL(s.value)} (${pct}%)</title></path>`;
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
        ${data.map((s) => html`
          <li>
            <span class="legend__dot" style="background:${s.color}"></span>
            <span class="legend__label">${s.label}</span>
            <span class="legend__value">${formatBRL(s.value)}</span>
            <span class="legend__pct">${((s.value / total) * 100).toFixed(0)}%</span>
          </li>`)}
      </ul>
    </figure>`;
}

/**
 * Barras agrupadas.
 * labels: ['jan/26', ...]
 * series: [{ name, values: [centavos...], className }]  (className define a cor no CSS)
 */
export function barChart(labels, series, { label = 'Gráfico de barras', height = 220, width = 600 } = {}) {
  const all = series.flatMap((s) => s.values);
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
    grid += `<text x="${padL - 6}" y="${yy}" class="chart__axis" text-anchor="end" dominant-baseline="middle">${escapeHTML(formatCompactBRL(v))}</text>`;
  }

  let bars = '';
  labels.forEach((lab, gi) => {
    const gx = padL + gi * groupW + (groupW - barW * series.length) / 2;
    series.forEach((s, si) => {
      const v = s.values[gi] || 0;
      const top = y(Math.max(v, 0)), bottom = y(Math.min(v, 0));
      const h = Math.max(v === 0 ? 0 : 1.5, bottom - top);
      bars += `<rect x="${fmt(gx + si * barW)}" y="${fmt(top)}" width="${fmt(barW - 2)}" height="${fmt(h)}" rx="3" class="chart__bar ${escapeHTML(s.className || '')}"><title>${escapeHTML(s.name)} · ${escapeHTML(lab)}: ${escapeHTML(formatBRL(v))}</title></rect>`;
    });
    bars += `<text x="${fmt(padL + gi * groupW + groupW / 2)}" y="${H - 6}" class="chart__axis" text-anchor="middle">${escapeHTML(lab)}</text>`;
  });

  return html`
    <figure class="chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}" preserveAspectRatio="xMidYMid meet">
        ${raw(grid)}${raw(bars)}
      </svg>
      ${series.length > 1 ? legendInline(series) : ''}
    </figure>`;
}

/**
 * Linha (evolução). Mesmo formato do barChart.
 */
export function lineChart(labels, series, { label = 'Gráfico de linha', height = 220, width = 600 } = {}) {
  const all = series.flatMap((s) => s.values);
  if (!all.length || !all.some((v) => v !== 0)) return emptyChart('Ainda não há dados no período.');

  const W = width, H = height, padL = 60, padB = 26, padT = 12, padR = 12;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const scale = niceScale(Math.min(...all), Math.max(...all));
  const range = scale.max - scale.min;
  const x = (i) => padL + (labels.length === 1 ? plotW / 2 : (i * plotW) / (labels.length - 1));
  const y = (v) => padT + plotH - ((v - scale.min) / range) * plotH;

  let grid = '';
  for (const v of scale.ticks) {
    const yy = fmt(y(v));
    grid += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" class="chart__grid ${v === 0 ? 'is-zero' : ''}"/>`;
    grid += `<text x="${padL - 6}" y="${yy}" class="chart__axis" text-anchor="end" dominant-baseline="middle">${escapeHTML(formatCompactBRL(v))}</text>`;
  }
  labels.forEach((lab, i) => {
    grid += `<text x="${fmt(x(i))}" y="${H - 6}" class="chart__axis" text-anchor="middle">${escapeHTML(lab)}</text>`;
  });

  const lines = series.map((s) => {
    const pts = s.values.map((v, i) => `${fmt(x(i))},${fmt(y(v))}`).join(' ');
    const dots = s.values.map((v, i) =>
      `<circle cx="${fmt(x(i))}" cy="${fmt(y(v))}" r="3.5" class="chart__dot ${escapeHTML(s.className || '')}"><title>${escapeHTML(s.name)} · ${escapeHTML(labels[i])}: ${escapeHTML(formatBRL(v))}</title></circle>`).join('');
    return `<polyline points="${pts}" fill="none" class="chart__line ${escapeHTML(s.className || '')} ${s.dashed ? 'is-dashed' : ''}"/>${dots}`;
  }).join('');

  return html`
    <figure class="chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}" preserveAspectRatio="xMidYMid meet">
        ${raw(grid)}${raw(lines)}
      </svg>
      ${series.length > 1 ? legendInline(series) : ''}
    </figure>`;
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
    ${series.map((s) => html`<li><span class="legend__dot ${s.className || ''}"></span>${s.name}</li>`)}
  </ul>`;
}

function emptyChart(message) {
  return html`<div class="chart-empty">${message}</div>`;
}
