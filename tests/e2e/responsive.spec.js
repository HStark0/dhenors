// Responsividade: todas as telas, abas, janelas e a tela de entrar, em
// vários tamanhos (celular pequeno a 2560 px, retrato e paisagem) e com
// dados de exemplo, dados "difíceis" (nomes longos, valores ×1000) e conta
// vazia. Falha se algo passar da tela, sair do card, se sobrepor, ficar
// espremido (uma letra por linha), cortado, ou se um campo fizer o iPhone
// dar zoom (fonte < 16 px).
//   npm run e2e                         → 7 tamanhos-chave, exemplo + difíceis
//   RESPONSIVE_FULL=1 npm run e2e       → 20 tamanhos × 3 cenários
//   AUDIT_OUT=pasta/r                   → grava o relatório em JSON
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { createFakeSupabase } from './fake-supabase.js';

const OUT = process.env.AUDIT_OUT || '';
const FULL = Boolean(process.env.RESPONSIVE_FULL);
const ALL_SIZES = [
  [320, 568, true], [360, 740, true], [375, 667, true], [390, 844, true], [414, 896, true], [430, 932, true],
  [568, 320, true], [740, 360, true], [844, 390, true], [932, 430, true],
  [600, 960, true], [768, 1024, true], [820, 1180, true], [1024, 768, true], [1180, 820, true],
  [1280, 800, false], [1366, 768, false], [1440, 900, false], [1920, 1080, false], [2560, 1440, false],
];
const KEY = ['320x568', '390x844', '844x390', '768x1024', '1024x768', '1366x768', '1920x1080'];
const SIZES = FULL ? ALL_SIZES : ALL_SIZES.filter(([w, h]) => KEY.includes(`${w}x${h}`));
const MODES = process.env.AUDIT_MODE ? [process.env.AUDIT_MODE] : FULL ? ['exemplo', 'estresse', 'vazio'] : ['exemplo', 'estresse'];
const ROUTES = {
  painel: [], agenda: [], analise: ['comparar', 'historico', 'saude', 'retrospectiva'],
  contas: ['recorrentes', 'parcelas', 'assinaturas', 'receber', 'dividas'], carteira: ['contas'],
  salario: ['plantoes', 'ir', 'rescisao', 'beneficios', 'carreira', 'tabelas'], metas: ['desejos'],
  investimentos: ['proventos', 'comparar', 'ir', 'independencia', 'previdencia'],
  planejamento: ['fluxo', 'ano', 'comprar', 'envelopes', 'regra'],
  ajustes: ['seguranca', 'nuvem', 'lembretes', 'categorias', 'credores', 'regras', 'dados', 'ajuda', 'contato', 'privacidade', 'novidades'],
  busca: [], importar: [],
};
const DIALOGS = {
  'novo': () => import('./js/ui/editors.js').then((E) => E.openNewMenu()),
  'conta': () => import('./js/ui/editors.js').then((E) => E.editExpense()),
  'parcelamento': () => import('./js/ui/editors.js').then((E) => E.editInstallment()),
  'compra-cartao': () => import('./js/ui/editors.js').then((E) => E.editPurchase()),
  'recorrente': () => import('./js/ui/editors.js').then((E) => E.editRecurring()),
  'cartao': () => import('./js/ui/editors.js').then((E) => E.editCard()),
  'meta': () => import('./js/ui/editors.js').then((E) => E.editGoal()),
  'paleta': () => document.dispatchEvent(new CustomEvent('dhenors:palette')),
  'mes': () => document.querySelector('[data-key="outlook"] .mstrip__cell')?.click(),
  'backup': () => import('./js/ui/backup.js').then((B) => B.exportBackup()),
  'alertas': () => document.dispatchEvent(new CustomEvent('dhenors:action', { detail: 'alerts:open' })),
};

/** Roda na página: devolve os problemas visíveis agora. */
function inspect(mobile) {
  const W = document.documentElement.clientWidth;
  const H = innerHeight;
  const issues = [];
  const name = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) s += `#${e.id}`;
      const cls = [...e.classList].filter((c) => !/^is-|^has-/.test(c)).slice(0, 2);
      if (cls.length) s += `.${cls.join('.')}`;
      parts.unshift(s);
    }
    return parts.join(' > ');
  };
  const visible = (el) => {
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return false;
    // Dentro de um <details> fechado (fora do <summary>) nada é desenhado; o
    // Chromium não faz o layout desse conteúdo e devolve medidas sem sentido.
    const closed = el.parentElement?.closest('details:not([open])');
    if (closed && ![...closed.children].some((c) => c.tagName === 'SUMMARY' && c.contains(el))) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // Ancestral que rola ou recorta na horizontal (conteúdo além dele é intencional)
  const clipper = (el) => {
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const ox = getComputedStyle(e).overflowX;
      if (ox !== 'visible') return e;
    }
    return null;
  };
  if (document.documentElement.scrollWidth > W + 1) issues.push({ kind: 'page-hscroll', detail: `${document.documentElement.scrollWidth}px > ${W}px` });

  const root = document.querySelector('dialog[open]') || document.querySelector('.auth') || document.body;
  const all = [...root.querySelectorAll('*')].filter((el) => !el.closest('svg') || el.tagName.toLowerCase() === 'svg');
  const seen = new Set();
  for (const el of all) {
    if (!visible(el) || el.closest('.sr-only')) continue;
    const r = el.getBoundingClientRect();
    // 7. Filhos que se sobrepõem (texto em cima de texto, botão em cima de botão)
    const inSvg = el.namespaceURI === 'http://www.w3.org/2000/svg';
    const kids = [...el.children].filter((k) => visible(k) && !k.closest('.sr-only') && !['absolute', 'fixed'].includes(getComputedStyle(k).position) && k.tagName !== 'svg'
      && (inSvg ? k.tagName === 'text' : !getComputedStyle(k).display.startsWith('inline') || ['inline-block', 'inline-flex', 'inline-grid'].includes(getComputedStyle(k).display)));
    if (kids.length > 1 && kids.length < 40) {
      const rs = kids.map((k) => k.getBoundingClientRect());
      for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) {
        const ix = Math.min(rs[a].right, rs[b].right) - Math.max(rs[a].left, rs[b].left);
        const iy = Math.min(rs[a].bottom, rs[b].bottom) - Math.max(rs[a].top, rs[b].top);
        if (ix > 3 && iy > 3) {
          const key = `overlap:${name(kids[a])}|${name(kids[b])}`;
          if (!seen.has(key)) { seen.add(key); issues.push({ kind: 'overlap', el: `${name(kids[a])}  ×  ${kids[b].getAttribute('class') || kids[b].tagName}`, text: `${kids[a].textContent.trim().slice(0, 20)} / ${kids[b].textContent.trim().slice(0, 20)}`, detail: `${Math.round(ix)}x${Math.round(iy)}px` }); }
        }
      }
    }
    const clip = clipper(el);
    // 1. Sai da tela (sem estar dentro de algo que rola)
    if (!clip || clip === document.body) {
      if (r.right > W + 1 || r.left < -1) {
        const key = `off:${name(el)}`;
        if (!seen.has(key) && !(el.parentElement && (el.parentElement.getBoundingClientRect().right > W + 1))) { seen.add(key); issues.push({ kind: 'offscreen', el: name(el), detail: `left ${Math.round(r.left)} right ${Math.round(r.right)} / ${W}` }); }
      }
    } else {
      // 2. Vaza do recipiente que recorta (texto/elemento cortado)
      const cr = clip.getBoundingClientRect();
      const ox = getComputedStyle(clip).overflowX;
      if (ox === 'hidden' || ox === 'clip') {
        if (r.right > cr.right + 1 || r.left < cr.left - 1) {
          const key = `clip:${name(el)}`;
          if (!seen.has(key) && !el.closest('.sr-only')) { seen.add(key); issues.push({ kind: 'clipped', el: name(el), detail: `${Math.round(r.left)}–${Math.round(r.right)} fora de ${Math.round(cr.left)}–${Math.round(cr.right)} (${name(clip)})` }); }
        }
      }
    }
    // 3. Filho que passa da borda do card
    const card = el.parentElement?.closest('.card, .dialog, .auth__card, .kpi, .sfig');
    if (card && !clip?.contains?.(card) === false) {
      // dentro de algo que rola dentro do card: ignora
    }
    if (card && (!clip || card.contains(clip) === false)) {
      const cr = card.getBoundingClientRect();
      if (r.right > cr.right + 2 || r.left < cr.left - 2) {
        const key = `card:${name(el)}`;
        if (!seen.has(key)) { seen.add(key); issues.push({ kind: 'out-of-card', el: name(el), detail: `${Math.round(r.left)}–${Math.round(r.right)} card ${Math.round(cr.left)}–${Math.round(cr.right)}` }); }
      }
    }
    // 4. Texto cortado sem reticências (nowrap transbordando)
    if (el.children.length === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth + 2) {
      const st = getComputedStyle(el);
      if (st.overflow !== 'visible' && st.textOverflow !== 'ellipsis' && el.clientWidth > 0) {
        const key = `text:${name(el)}`;
        if (!seen.has(key)) { seen.add(key); issues.push({ kind: 'text-cut', el: name(el), detail: el.textContent.trim().slice(0, 40) }); }
      }
    }
  }
  // 8. Texto espremido (uma ou duas letras por linha)
  for (const el of all) {
    if (!visible(el) || el.closest('.sr-only') || el.namespaceURI === 'http://www.w3.org/2000/svg') continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data).join('').trim();
    if (own.length < 6 || !/[A-Za-zÀ-ú]{4}/.test(own)) continue;
    const r = el.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.3;
    if (r.width < 48 && r.height > lh * 3) {
      const key = 'crush:' + name(el);
      if (!seen.has(key)) { seen.add(key); issues.push({ kind: 'crushed-text', el: name(el), detail: Math.round(r.width) + 'px de largura: ' + own.slice(0, 30) }); }
    }
  }
  // 5. Zoom do iPhone: campos com fonte < 16px
  if (mobile) {
    for (const f of root.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]), select, textarea')) {
      if (!visible(f)) continue;
      const fs = parseFloat(getComputedStyle(f).fontSize);
      if (fs < 16) {
        const key = `zoom:${name(f)}`;
        if (!seen.has(key)) { seen.add(key); issues.push({ kind: 'ios-zoom', el: name(f), detail: `${fs}px` }); }
      }
    }
  }
  // 6. Janela maior que a tela
  const dlg = document.querySelector('dialog[open] .dialog, dialog[open]');
  if (dlg && visible(dlg)) {
    const r = dlg.getBoundingClientRect();
    if (r.right > W + 1 || r.left < -1 || r.bottom > H + 1) issues.push({ kind: 'dialog-overflow', el: name(dlg), detail: `${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)} / ${W}x${H}` });
  }
  return issues;
}

for (const mode of MODES) for (const [w, h, mobile] of SIZES) {
  test(`responsivo ${w}x${h} (${mode})`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'cria os próprios tamanhos: roda uma vez só');
    test.setTimeout(600_000);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const cloud = createFakeSupabase();
    await cloud.attach(page);
    await page.clock.setFixedTime(new Date('2026-10-15T12:00:00-03:00'));
    await page.goto('/index.html#/painel');
    await page.waitForSelector('#view .card');
    await page.addStyleTag({ content: '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important}' });
    if (mode !== 'exemplo') {
      await page.evaluate(async (m) => {
        const { store } = await import('./js/core/store.js');
        const { createEmptyState } = await import('./js/domain/schema.js');
        if (m === 'vazio') { store.data = createEmptyState(); store.data.onboarded = true; }
        else {
          const LONG = ' com um nome bem comprido para testar quebra de linha';
          const walk = (o) => {
            if (Array.isArray(o)) return o.forEach(walk);
            if (!o || typeof o !== 'object') return;
            for (const [k, v] of Object.entries(o)) {
              if (/^(description|name|person|label)$/.test(k) && typeof v === 'string') o[k] = v + LONG;
              else if (/[cC]ents$/.test(k) && typeof v === 'number') o[k] = v * 1000;
              else walk(v);
            }
          };
          walk(store.data);
          store.data.settings.profileName = 'Maria Aparecida dos Santos Oliveira';
        }
        store.version++;
        store.setUI({});
      }, mode);
      await page.waitForTimeout(200);
    }
    const report = [];
    // Achou algo? Espera a tela assentar (animações, ajuste dos gráficos) e mede de novo:
    // só conta o que continua errado na segunda medida.
    const check = async (where) => {
      let found = await page.evaluate(inspect, mobile);
      if (found.length) { await page.waitForTimeout(600); found = await page.evaluate(inspect, mobile); }
      for (const i of found) report.push({ where, ...i });
    };
    for (const [r, tabs] of Object.entries(ROUTES)) {
      for (const tab of [null, ...tabs]) {
        await page.evaluate((hh) => { location.hash = hh; }, `#/${r}${tab ? `?aba=${tab}` : ''}`);
        await page.waitForTimeout(120);
        await check(`${r}${tab ? `/${tab}` : ''}`);
      }
    }
    await page.evaluate(() => { location.hash = '#/painel'; });
    await page.waitForTimeout(150);
    for (const [d, js] of Object.entries(DIALOGS)) {
      await page.evaluate(js);
      await page.waitForTimeout(200);
      await check(`janela:${d}`);
      await page.keyboard.press('Escape');
      await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((x) => x.close()); document.querySelector('.palette')?.remove?.(); });
      await page.waitForTimeout(80);
    }
    await page.evaluate(() => import('./js/ui/auth.js').then((a) => a.openAuth('signin')));
    await page.waitForTimeout(150);
    await check('entrar');
    await page.evaluate(() => import('./js/ui/auth.js').then((a) => a.openAuth('passphrase', { info: { exists: false } })));
    await page.waitForTimeout(150);
    await check('frase');
    if (OUT) writeFileSync(`${OUT}-${mode}-${w}x${h}.json`, JSON.stringify(report, null, 1));
    await ctx.close();
    expect(report.map((r) => `${r.where} · ${r.kind} · ${r.el || ''} · ${r.detail}`)).toEqual([]);
  });
}
