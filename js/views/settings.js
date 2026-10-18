// =============================================================
// Ajustes — perfil, aparência, segurança, nuvem, lembretes,
// categorias, credores, regras, dados, ajuda, privacidade e novidades
// =============================================================

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { field, categoryFields, bindCategorySelects, switchField } from '../ui/forms.js';
import { tabsNav, currentTab } from '../ui/tabs.js';
import { togglePush } from '../ui/notify.js';
import { cloudSettingsSection } from '../ui/cloudUI.js';
import { feedbackSection } from '../ui/feedback.js';
import { openAuth } from '../ui/auth.js';
import { removeAttachment } from '../ui/attachments.js';
import { toast, toastError } from '../ui/toast.js';
import { GLOSSARY } from '../ui/help.js';
import { singleKeyShortcuts, setSingleKeyShortcuts } from '../ui/prefs.js';
import { canInstall, isStandalone } from '../ui/pwa.js';
import { catText } from '../ui/forms.js';
import * as E from '../ui/editors.js';
import { download } from '../ui/backup.js';
import { store } from '../core/store.js';
import { ACCENTS, isDiscreet, setDiscreet } from '../core/theme.js';
import { errorLog, clearErrorLog } from '../core/errors.js';
import { cloud } from '../core/cloud.js';
import { formatBRL, plural } from '../core/money.js';
import { formatDateBR, currentYM, todayISO, diffDays } from '../core/dates.js';
import { payrollFor, payrollProfileFor, paydayLabel, nextPaydayFrom } from '../domain/payroll.js';
import * as A from '../domain/actions.js';
import { alertsOf } from '../domain/monthStatus.js';
import { DEFAULT_ALERTS } from '../domain/schema.js';
import { APP_VERSION } from '../version.js';
import { CHANGELOG } from '../changelog.js';
import { renderCategories, renderCreditors, categoryActions } from './settings/categories.js';

const TABBAR_LABELS = { painel: 'Painel', agenda: 'Agenda', contas: 'Contas a pagar', carteira: 'Cartões e contas', salario: 'Salário', metas: 'Metas', investimentos: 'Investimentos', planejamento: 'Planejamento', analise: 'Análise', ajustes: 'Ajustes' };

const TABS = [
  { id: 'geral', label: 'Geral', icon: 'user-cog' },
  { id: 'seguranca', label: 'Segurança', icon: 'lock-keyhole' },
  { id: 'nuvem', label: 'Nuvem', icon: 'cloud' },
  { id: 'lembretes', label: 'Lembretes', icon: 'bell-ring' },
  { id: 'categorias', label: 'Categorias', icon: 'tags', monthNav: true },
  { id: 'credores', label: 'Credores', icon: 'handshake' },
  { id: 'regras', label: 'Regras', icon: 'wand-sparkles' },
  { id: 'dados', label: 'Dados', icon: 'database' },
  { id: 'ajuda', label: 'Ajuda', icon: 'circle-help' },
  { id: 'contato', label: 'Fale conosco', icon: 'mail' },
  { id: 'privacidade', label: 'Privacidade', icon: 'shield-check' },
  { id: 'novidades', label: 'Novidades', icon: 'sparkles' },
];


export default {
  id: 'ajustes',
  title: 'Ajustes',
  get monthNav() { return currentTab(TABS) === 'categorias'; },

  render() {
    const active = currentTab(TABS);
    const R = {
      geral, seguranca: security, nuvem: () => html`<div class="settings">${cloudSettingsSection()}</div>`, lembretes: reminders,
      categorias: renderCategories, credores: renderCreditors, regras: rules, dados: data, ajuda: help, contato: feedbackSection, privacidade: privacy, novidades: news,
    };
    return html`${tabsNav('ajustes', TABS, active)}${R[active]()}`;
  },

  actions: {
    ...categoryActions,
    'set:profile': () => openDialog({
      title: 'Perfil',
      size: 'sm',
      submitLabel: 'Salvar',
      body: field({ label: 'Como quer ser chamado?', name: 'profileName', value: store.data.settings.profileName, extra: { maxlength: 60, autocomplete: 'given-name' } }),
      onSubmit: (form) => { A.updateProfile({ profileName: form.profileName.value }); toast('Perfil salvo.'); },
    }),
    'set:alerts': () => {
      const a = alertsOf(store.data.settings);
      const num = (label, name, value, min, max, hint) => field({ label, name, type: 'number', value, required: true, hint, extra: { min, max, step: 1, inputmode: 'numeric' } });
      openDialog({
        title: 'Alertas e dicas',
        size: 'sm',
        submitLabel: 'Salvar',
        body: html`
          <div class="form-grid">
            ${num('Mês apertado: sobra menor que (% dos ganhos)', 'tightPct', a.tightPct, 0, 50, 'Padrão 10%. Abaixo disso o mês aparece em amarelo; negativo, em vermelho.')}
            ${num('Gasto exagerado: acima da média em (%)', 'overspendPct', a.overspendPct, 10, 300, 'Padrão 40%. Compara com a mediana dos últimos 6 meses (precisa de 3 meses de histórico).')}
            ${num('Gasto grande: a partir de (% dos ganhos do mês)', 'bigPct', a.bigPct, 1, 100, 'Padrão 10% (mínimo R$ 100). Gastos grandes somam por cima do dia a dia nas previsões.')}
          </div>`,
        footer: html`<button type="button" class="btn btn--ghost" data-reset>Voltar ao padrão</button>`,
        onMount: (dlg) => dlg.querySelector('[data-reset]').addEventListener('click', () => {
          try { A.setAlerts({ ...DEFAULT_ALERTS }); } catch (err) { if (err?.name !== 'GuestError') toastError(err.message); return; }
          dlg.close();
          toast('Limites no padrão.');
        }),
        onSubmit: (form) => {
          A.setAlerts({ tightPct: Number(form.tightPct.value), overspendPct: Number(form.overspendPct.value), bigPct: Number(form.bigPct.value) });
          toast('Limites salvos.');
        },
      });
    },
    'set:alerts-push': () => {
      const on = !alertsOf(store.data.settings).push;
      A.setAlerts({ push: on });
      toast(on ? 'Você será avisado quando um mês dos próximos não fechar.' : 'Aviso de mês que não fecha desligado.', { type: 'info' });
    },
    'app:theme': (el) => A.setAppearance({ theme: el.dataset.value }),
    'app:accent': (el) => A.setAppearance({ accent: el.dataset.value }),
    'app:density': (el) => A.setAppearance({ density: el.dataset.value }),
    'app:motion': (el) => A.setAppearance({ motion: el.dataset.value }),
    'app:tabbar': () => tabbarDialog(),
    'app:dashboard': () => { store.setUI({ dashEdit: true }); location.hash = '#/painel'; },
    'set:wipe-salary': () => wipeSalaryDialog(),
    'set:wipe': async () => {
      if (store.guest) { openAuth('signin'); return; } // sem login não há dados para apagar
      const ok = await confirmDialog({
        title: 'Apagar todos os dados',
        message: 'Isso remove TODAS as contas, cartões, parcelamentos, metas, categorias e anexos da sua conta, em todos os aparelhos. As versões anteriores continuam no histórico da nuvem por um tempo (Nuvem → Histórico de versões).',
        confirmLabel: 'Apagar tudo',
        danger: true,
        typed: 'EXCLUIR',
      });
      if (!ok) return;
      // os anexos também saem da nuvem (o aviso promete isso)
      const files = store.data.expenses.flatMap((e) => (e.attachments || []).map((a) => a.id));
      await store.reset();
      files.forEach((id) => removeAttachment(id));
      toast('Todos os dados foram apagados.');
      location.hash = '#/painel';
    },
    'discreet:set': () => { setDiscreet(!isDiscreet()); store.setUI({}); },
    'keys:toggle': () => { setSingleKeyShortcuts(!singleKeyShortcuts()); toast(singleKeyShortcuts() ? 'Atalhos de uma tecla ligados.' : 'Atalhos de uma tecla desligados.', { type: 'info' }); store.setUI({}); },
    'rem:days': (el) => { const r = store.data.settings.reminders || {}; A.setReminders({ ...r, daysBefore: Number(el.dataset.days) }); },
    'rem:mode': (el) => { const r = store.data.settings.reminders || {}; A.setReminders({ ...r, mode: el.dataset.mode }); },
    'rem:push': () => togglePush(),
    'rule:delete': (el) => E.deleteWithUndo(() => A.deleteRule(el.dataset.id), 'Regra removida.'),
    'rule:new': () => ruleDialog(),
    'salary:edit': () => E.editSalaryBase(currentYM()),
    'err:export': async () => {
      const log = await errorLog();
      download(`dhenors-erros-${todayISO()}.json`, JSON.stringify({ app: 'Dhenors', version: APP_VERSION, exportedAt: new Date().toISOString(), errors: log }, null, 2), 'application/json');
      toast(`${plural(log.length, 'erro exportado', 'erros exportados')}. Anexe o arquivo numa issue do GitHub.`);
    },
    'err:clear': async () => { await clearErrorLog(); toast('Registro de erros limpo.'); store.setUI({ errors: null }); },
  },

  onFilter(name, value) {
    if (name === 'helpQ') store.setUI({ filters: { ...store.ui.filters, helpQ: value } });
  },
};

// ---------- Geral ----------

function salaryLine(s) {
  const ym = currentYM();
  const profile = payrollProfileFor(s, ym);
  if (!profile) return `Não informado · pago ${paydayLabel(s)}`;
  const p = payrollFor(s, ym);
  if (p.legacyNet) return `${formatBRL(p.net)} líquido (cadastro antigo — edite para informar o bruto) · pago ${paydayLabel(s)}`;
  return `Bruto ${formatBRL(p.gross)} → líquido ${formatBRL(p.net)} · pago ${paydayLabel(s)}`;
}

function choice(action, value, current, label, ic) {
  return html`<button type="button" class="segmented__btn" data-action="${action}" data-value="${value}" aria-pressed="${value === current}">${ic ? icon(ic, 'icon--xs') : ''} ${label}</button>`;
}

function geral() {
  const s = store.data.settings;
  const alerts = alertsOf(s);
  return html`
    <div class="settings">
      <section class="card">
        <h2 class="card__title">${icon('user')} Perfil e renda</h2>
        <div class="setting">
          <div><strong>Nome</strong><p class="muted small">${s.profileName || 'Não informado'}</p></div>
          <button type="button" class="btn btn--ghost btn--sm" data-action="set:profile">Editar</button>
        </div>
        <div class="setting">
          <div><strong>Salário</strong><p class="muted small">${salaryLine(s)} · próximo em ${formatDateBR(nextPaydayFrom(s))}</p></div>
          <div class="setting__actions">
            <a class="btn btn--secondary btn--sm" href="#/salario">${icon('banknote', 'icon--xs')} Abrir salário</a>
            <button type="button" class="btn btn--ghost btn--sm" data-action="salary:edit">${icon('calendar-days', 'icon--xs')} Data</button>
          </div>
        </div>
        <div class="setting">
          <div><strong>Meta de gastos mensal</strong><p class="muted small">${s.spendingLimitCents ? formatBRL(s.spendingLimitCents) : 'Desativada'}</p></div>
          <button type="button" class="btn btn--ghost btn--sm" data-action="limit:edit">Alterar</button>
        </div>
      </section>

      <section class="card">
        <h2 class="card__title">${icon('lightbulb')} Alertas e dicas</h2>
        <p class="muted small">Os limites que decidem quando um mês está apertado e quando um gasto é exagerado ou fora do comum. Valem para o Painel, a Agenda, os 12 meses, o "Posso comprar?" e a prévia ao lançar contas.</p>
        <div class="setting">
          <div><strong>Mês apertado</strong><p class="muted small">Quando sobra menos de <strong>${alerts.tightPct}%</strong> dos ganhos do mês. Negativo é "não fecha".</p></div>
          <button type="button" class="btn btn--ghost btn--sm" data-action="set:alerts">Alterar</button>
        </div>
        <div class="setting">
          <div><strong>Gasto exagerado</strong><p class="muted small">Quando passa <strong>${alerts.overspendPct}%</strong> da média dos últimos meses (mesma conta, categoria ou cartão).</p></div>
          <button type="button" class="btn btn--ghost btn--sm" data-action="set:alerts">Alterar</button>
        </div>
        <div class="setting">
          <div><strong>Gasto grande / fora do comum</strong><p class="muted small">Avulsa ou compra a partir de <strong>${alerts.bigPct}%</strong> dos ganhos do mês. Soma por cima do gasto do dia a dia nas previsões.</p></div>
          <button type="button" class="btn btn--ghost btn--sm" data-action="set:alerts">Alterar</button>
        </div>
        <div class="setting">
          <div><strong>Avisar quando um mês não fecha</strong><p class="muted small">Com os lembretes ligados, uma vez por semana. Sem valores na notificação.</p></div>
          <button type="button" class="btn ${alerts.push ? 'btn--primary' : 'btn--ghost'} btn--sm" data-action="set:alerts-push" aria-pressed="${alerts.push}">${alerts.push ? 'Ligado' : 'Desligado'}</button>
        </div>
      </section>

      <section class="card">
        <h2 class="card__title">${icon('palette')} Aparência</h2>
        <div class="setting setting--stack">
          <strong>Tema</strong>
          <div class="segmented" role="group" aria-label="Tema">
            ${choice('app:theme', 'auto', s.theme, 'Automático', 'sun-moon')}${choice('app:theme', 'light', s.theme, 'Claro', 'sun')}${choice('app:theme', 'dark', s.theme, 'Escuro', 'moon')}${choice('app:theme', 'oled', s.theme, 'Preto (OLED)', 'contrast')}
          </div>
          <p class="muted small">"Preto (OLED)" usa preto puro: economiza bateria em telas OLED.</p>
        </div>
        <div class="setting setting--stack">
          <strong>Cor de destaque</strong>
          <div class="swatches" role="radiogroup" aria-label="Cor de destaque">
            ${Object.entries(ACCENTS).map(([k, a]) => html`<button type="button" class="swatch swatch--btn" style="--swatch:${a.primary}" data-action="app:accent" data-value="${k}" role="radio" aria-checked="${(s.accent || 'azul') === k}" aria-label="${a.label}" title="${a.label}"></button>`)}
          </div>
        </div>
        <div class="setting setting--stack">
          <strong>Densidade</strong>
          <div class="segmented" role="group" aria-label="Densidade">
            ${choice('app:density', 'comfortable', s.density || 'comfortable', 'Confortável', 'rows-3')}${choice('app:density', 'compact', s.density, 'Compacta', 'list')}
          </div>
          <p class="muted small">Compacta mostra mais lançamentos na tela.</p>
        </div>
        <div class="setting setting--stack">
          <strong>Efeitos e animações</strong>
          <div class="segmented" role="group" aria-label="Efeitos">
            ${choice('app:motion', 'full', s.motion || 'full', 'Todos')}${choice('app:motion', 'calm', s.motion, 'Calmos')}${choice('app:motion', 'off', s.motion, 'Desligados')}
          </div>
          <p class="muted small">"Calmos" tira o brilho da logo e os cortes diagonais em movimento; "Desligados" tira todas as animações. O "reduzir movimento" do sistema continua valendo.</p>
        </div>
        <div class="setting">
          <div><strong>Atalhos de uma tecla</strong><p class="muted small">N (novo), / (buscar) e D (modo discreto). Desligue se usa comando de voz ou esbarra no teclado; Ctrl+K e Ctrl+Z continuam. Vale só neste aparelho.</p></div>
          <button type="button" class="btn ${singleKeyShortcuts() ? 'btn--primary' : 'btn--ghost'} btn--sm" data-action="keys:toggle" aria-pressed="${singleKeyShortcuts()}">${singleKeyShortcuts() ? 'Ligados' : 'Desligados'}</button>
        </div>
      </section>

      <section class="card">
        <h2 class="card__title">${icon('layout-grid')} Painel e navegação</h2>
        <div class="setting">
          <div><strong>Organizar o Painel</strong><p class="muted small">Reordene, esconda ou fixe os cards.</p></div>
          <button type="button" class="btn btn--ghost btn--sm" data-action="app:dashboard">${icon('sliders-horizontal', 'icon--xs')} Organizar</button>
        </div>
        <div class="setting">
          <div><strong>Atalhos da barra do celular</strong><p class="muted small">${(s.tabbar || ['painel', 'agenda', 'contas']).map((id) => TABBAR_LABELS[id] || id).join(' · ')}</p></div>
          <button type="button" class="btn btn--ghost btn--sm" data-action="app:tabbar">Escolher</button>
        </div>
        ${canInstall() || !isStandalone() ? html`
          <div class="setting">
            <div><strong>Instalar o app</strong><p class="muted small">Abre em tela cheia, com ícone na tela inicial e notificações (no iPhone, só instalado).</p></div>
            <button type="button" class="btn btn--secondary btn--sm" data-action="install:app">${icon('smartphone', 'icon--xs')} Instalar</button>
          </div>` : ''}
      </section>
      <p class="muted small center">Dhenors ${APP_VERSION} · dados só na nuvem, criptografados</p>
    </div>`;
}

function tabbarDialog() {
  const opts = [['painel', 'Painel'], ['agenda', 'Agenda'], ['contas', 'Contas a pagar'], ['carteira', 'Cartões e contas bancárias'], ['salario', 'Salário'], ['metas', 'Metas'], ['investimentos', 'Investimentos'], ['planejamento', 'Planejamento'], ['analise', 'Análise'], ['ajustes', 'Ajustes']];
  const cur = store.data.settings.tabbar || ['painel', 'agenda', 'contas'];
  openDialog({
    title: 'Atalhos da barra do celular',
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      <p class="dialog__text muted">Escolha 3 telas. O botão "+" (novo) e "Mais" ficam sempre.</p>
      <div class="check-list">${opts.map(([id, label]) => html`<label class="check"><input type="checkbox" name="tab" value="${id}" ${cur.includes(id) ? 'checked' : ''}> ${label}</label>`)}</div>`,
    onSubmit: (form) => {
      const ids = [...form.querySelectorAll('[name="tab"]:checked')].map((x) => x.value);
      if (ids.length !== 3) throw new A.ValidationError(`Escolha exatamente 3 (marcados: ${ids.length}).`);
      A.setTabbar(ids);
      toast('Atalhos salvos.');
    },
  });
}

// ---------- Segurança ----------

function security() {
  return html`
    <div class="settings">
      <section class="card">
        <h2 class="card__title">${icon('shield-check')} Onde ficam os seus dados</h2>
        ${store.guest ? html`
          <div class="setting">
            <div><strong>Você está vendo um exemplo</strong><p class="muted small">Entre na sua conta para usar o app com os seus dados.</p></div>
            <button type="button" class="btn btn--primary btn--sm" data-action="auth:open">${icon('log-in', 'icon--xs')} Entrar</button>
          </div>` : html`
          <div class="setting">
            <div><strong>Só na nuvem, criptografados</strong><p class="muted small">Os dados são cifrados neste aparelho com a sua frase secreta (AES-256) antes de subir. Nada fica salvo no navegador: com o app aberto, eles ficam só na memória.</p></div>
            <button type="button" class="btn btn--ghost btn--sm" data-action="cloud:passphrase">${icon('key-round', 'icon--xs')} Trocar frase</button>
          </div>
          <div class="setting">
            <div><strong>Sair da conta</strong><p class="muted small">Tira os dados deste aparelho na hora. Use em aparelhos compartilhados.</p></div>
            <button type="button" class="btn btn--ghost btn--sm danger" data-action="cloud:logout">${icon('log-out', 'icon--xs')} Sair</button>
          </div>
          <div class="setting">
            <div><strong>Aparelhos conectados</strong><p class="muted small">Veja onde a conta está aberta e desconecte à distância.</p></div>
            <button type="button" class="btn btn--ghost btn--sm" data-action="cloud:devices">${icon('monitor-smartphone', 'icon--xs')} Aparelhos</button>
          </div>`}
      </section>
      <section class="card">
        <h2 class="card__title">${icon('eye-off')} Modo discreto</h2>
        <div class="setting">
          <div><strong>Esconder os valores</strong><p class="muted small">Útil em público: no lugar de cada valor aparece um olho cortado; toque nele para ver por 3 segundos. Atalho: ícone de olho no topo ou tecla D. Vale só neste aparelho.</p></div>
          <button type="button" class="btn ${isDiscreet() ? 'btn--primary' : 'btn--ghost'} btn--sm" data-action="discreet:set" aria-pressed="${isDiscreet()}">${icon(isDiscreet() ? 'eye-off' : 'eye', 'icon--xs')} ${isDiscreet() ? 'Ligado' : 'Desligado'}</button>
        </div>
      </section>
      <section class="card">
        <h2 class="card__title">${icon('shield-check')} Proteções do site</h2>
        <ul class="tips">
          <li>Política de segurança de conteúdo (CSP): o app só carrega arquivos dele mesmo e só conversa com o Supabase (nuvem) e, quando você pede, com as APIs públicas do Banco Central e da brapi.</li>
          <li>No navegador fica só o acesso à conta (pelo tempo que você escolheu ao entrar) e as preferências de aparência — nenhum valor, conta ou anexo.</li>
          <li>Nenhum anúncio, rastreador ou biblioteca de terceiros.</li>
          <li>Backups podem ser criptografados com senha (Dados → Baixar backup).</li>
        </ul>
      </section>
    </div>`;
}

// ---------- Lembretes ----------

function reminders() {
  const r = store.data.settings.reminders || {};
  return html`
    <div class="settings">
      <section class="card">
        <h2 class="card__title">${icon('bell-ring')} Lembretes de vencimento</h2>
        <div class="setting">
          <div><strong>Avisos ao abrir o app</strong><p class="muted small">${r.enabled ? 'Ligados.' : 'Desligados'}</p></div>
          <button type="button" class="btn ${r.enabled ? 'btn--ghost' : 'btn--secondary'} btn--sm" data-action="agenda:notify">${r.enabled ? 'Desligar' : 'Ligar'}</button>
        </div>
        <div class="setting setting--stack">
          <strong>Como avisar</strong>
          <div class="segmented" role="group" aria-label="Modo dos lembretes">
            ${[['daily', 'Um resumo por dia'], ['weekly', 'Resumo aos domingos'], ['each', 'Uma por conta']].map(([m, l]) => html`
              <button type="button" class="segmented__btn" data-action="rem:mode" data-mode="${m}" aria-pressed="${(r.mode || 'daily') === m}">${l}</button>`)}
          </div>
          <p class="muted small">O resumo evita várias notificações seguidas.</p>
        </div>
        <div class="setting setting--stack">
          <strong>Avisar com antecedência</strong>
          <div class="segmented" role="group" aria-label="Antecedência dos lembretes">
            ${[[0, 'No dia'], [1, '1 dia'], [3, '3 dias'], [7, '7 dias']].map(([n, l]) => html`
              <button type="button" class="segmented__btn" data-action="rem:days" data-days="${n}" aria-pressed="${(r.daysBefore ?? 1) === n}">${l}</button>`)}
          </div>
        </div>
        <div class="setting">
          <div><strong>Com o app fechado (push)</strong><p class="muted small">Chega "Você tem 2 contas amanhã" mesmo com o app fechado. O servidor recebe só QUANTAS contas vencem por dia — nunca valores ou nomes. Requer a nuvem e a função de lembretes publicada (docs/NUVEM.md).</p></div>
          <button type="button" class="btn ${r.push ? 'btn--ghost' : 'btn--secondary'} btn--sm" data-action="rem:push" ${cloud.linked ? '' : 'disabled'}>${r.push ? 'Desligar' : 'Ligar'}</button>
        </div>
        <div class="setting">
          <div><strong>Calendário do celular</strong><p class="muted small">Exporte os vencimentos com alarme para Google Agenda, iPhone ou Outlook.</p></div>
          <a class="btn btn--ghost btn--sm" href="#/agenda">${icon('calendar-days', 'icon--xs')} Abrir agenda</a>
        </div>
      </section>
    </div>`;
}

// ---------- Regras ----------

function rules() {
  const d = store.data;
  const s = d.settings;
  return html`
    <div class="settings">
      <section class="card">
        <h2 class="card__title">${icon('wand-sparkles')} Regras de categorização</h2>
        <p class="muted small">Quando a descrição contém o texto, a categoria é escolhida sozinha na importação de extratos, no lançamento rápido e nas compras. O app também pergunta "Sempre colocar UBER em Transporte?" quando você troca a categoria de um gasto.</p>
        ${(s.rules || []).length ? html`
          <ul class="mini-list">
            ${s.rules.map((rule) => {
              const cat = d.categories.find((c) => c.id === rule.categoryId);
              return html`
                <li>
                  <span class="rule"><code>${rule.pattern}</code> ${icon('arrow-right', 'icon--xs')} ${cat ? catText(cat) : 'categoria removida'}</span>
                  <span class="mini-list__actions"><button type="button" class="icon-btn icon-btn--sm danger" data-action="rule:delete" data-id="${rule.id}" aria-label="Remover regra ${rule.pattern}">${icon('trash-2')}</button></span>
                </li>`;
            })}
          </ul>` : html`<p class="muted small">Nenhuma regra ainda.</p>`}
        <div class="card__actions">
          <button type="button" class="btn btn--ghost btn--sm" data-action="rule:new">${icon('plus', 'icon--xs')} Nova regra</button>
          <a class="btn btn--ghost btn--sm" href="#/importar">${icon('file-up', 'icon--xs')} Importar extrato</a>
        </div>
      </section>
    </div>`;
}

function ruleDialog() {
  const d = store.data;
  openDialog({
    title: 'Nova regra',
    size: 'sm',
    submitLabel: 'Criar regra',
    body: html`
      <div class="form-grid">
        ${field({ label: 'Se a descrição contém', name: 'pattern', required: true, full: true, placeholder: 'Ex.: posto shell', extra: { maxlength: 60, autocomplete: 'off' } })}
        ${categoryFields(d)}
      </div>`,
    onMount: (dlg) => bindCategorySelects(dlg, d),
    onSubmit: (form) => {
      if (!form.categoryId.value) throw new A.ValidationError('Escolha a categoria.', 'categoryId');
      const n = A.learnRule({ pattern: form.pattern.value.trim(), categoryId: form.categoryId.value, subcategoryId: form.subcategoryId?.value || null });
      toast(`Regra criada${n ? ` e aplicada em ${plural(n, 'lançamento')} sem categoria` : ''}.`);
    },
  });
}

// ---------- Dados ----------

function data() {
  const d = store.data;
  if (store.ui.errors == null) errorLog().then((l) => store.setUI({ errors: l }));
  const errors = store.ui.errors || [];
  const last = d.lastBackupAt ? diffDays(todayISO(new Date(d.lastBackupAt)), todayISO()) : null;
  return html`
    <div class="settings">
      <section class="card">
        <h2 class="card__title">${icon('database')} Seus dados</h2>
        <p class="muted small">Tudo fica na <strong>sua conta na nuvem</strong>, criptografado, com histórico de versões. O backup em arquivo é uma cópia extra que fica com você.</p>
        <div class="setting">
          <div><strong>Backup</strong><p class="muted small ${last != null && last > 30 ? 'state--warn' : ''}">${last == null ? 'Nenhum backup feito ainda' : `Último: ${formatDateBR(todayISO(new Date(d.lastBackupAt)))} (${last === 0 ? 'hoje' : `há ${last} dias`})`} · pode ser protegido com senha</p></div>
          <div class="setting__actions">
            <button type="button" class="btn btn--primary btn--sm" data-action="backup:export">${icon('download', 'icon--xs')} Baixar backup</button>
            <button type="button" class="btn btn--ghost btn--sm" data-action="backup:import">${icon('upload', 'icon--xs')} Restaurar</button>
          </div>
        </div>
        <div class="setting">
          <div><strong>Planilhas, holerites e relatório</strong><p class="muted small">Contracheques, resumo mensal, investimentos, relatório do mês em PDF.</p></div>
          <button type="button" class="btn btn--ghost btn--sm" data-action="export:open" data-kind="summary">${icon('file-spreadsheet', 'icon--xs')} Baixar dados</button>
        </div>
        <div class="setting">
          <div><strong>Importar extrato ou fatura</strong><p class="muted small">OFX, CSV ou PDF da fatura do cartão. Liga as transações às contas já lançadas (conciliação).</p></div>
          <a class="btn btn--ghost btn--sm" href="#/importar">${icon('file-up', 'icon--xs')} Importar</a>
        </div>
      </section>

      <section class="card">
        <h2 class="card__title">${icon('activity')} Registro de erros</h2>
        <div class="setting">
          <div><strong>${errors.length ? plural(errors.length, 'erro registrado', 'erros registrados') : 'Nenhum erro registrado'}</strong>
            <p class="muted small">Fica só na memória enquanto o app está aberto, sem valores dos seus dados. Exporte e anexe numa issue para ajudar a corrigir.${errors.length ? ` Último: ${errors[errors.length - 1].message}` : ''}</p></div>
          <div class="setting__actions">
            <button type="button" class="btn btn--ghost btn--sm" data-action="err:export" ${errors.length ? '' : 'disabled'}>${icon('download', 'icon--xs')} Exportar</button>
            <button type="button" class="btn btn--ghost btn--sm" data-action="err:clear" ${errors.length ? '' : 'disabled'}>Limpar</button>
          </div>
        </div>
      </section>

      <section class="card card--danger">
        <h2 class="card__title">${icon('triangle-alert')} Zona de perigo</h2>
        <div class="setting">
          <div><strong>Apagar só o salário</strong><p class="muted small">Remove o salário, adicionais, descontos em folha e o vínculo. Contas, cartões, metas, investimentos e o resto do app continuam. Dá para desfazer logo em seguida.</p></div>
          <button type="button" class="btn btn--ghost danger btn--sm" data-action="set:wipe-salary">Apagar salário</button>
        </div>
        <div class="setting">
          <div><strong>Apagar todos os dados</strong><p class="muted small">Remove tudo da sua conta, em todos os aparelhos. Faça um backup antes.</p></div>
          <button type="button" class="btn btn--danger btn--sm" data-action="set:wipe">Apagar tudo</button>
        </div>
      </section>
    </div>`;
}

// ---------- Ajuda, privacidade e novidades ----------

function help() {
  const q = (store.ui.filters.helpQ || '').toLowerCase();
  const entries = Object.entries(GLOSSARY).filter(([, g]) => !q || g.term.toLowerCase().includes(q) || g.text.toLowerCase().includes(q));
  return html`
    <div class="settings">
      <section class="card">
        <h2 class="card__title">${icon('book-open')} Glossário</h2>
        <div class="search">${icon('search')}<label class="sr-only" for="help-q">Buscar no glossário</label><input id="help-q" class="input" type="search" placeholder="Buscar: DSR, competência, frase secreta…" value="${store.ui.filters.helpQ || ''}" data-filter="helpQ"></div>
        <dl class="glossary">${entries.map(([id, g]) => html`<div id="g-${id}"><dt>${g.term}</dt><dd>${g.text}</dd></div>`)}</dl>
      </section>
      <section class="card">
        <h2 class="card__title">${icon('keyboard')} Atalhos de teclado</h2>
        <ul class="mini-list">
          <li><span><kbd>Ctrl</kbd> + <kbd>K</kbd> ou <kbd>/</kbd></span><span>Buscar ou lançar</span></li>
          <li><span><kbd>N</kbd></span><span>Novo lançamento</span></li>
          <li><span><kbd>D</kbd></span><span>Modo discreto</span></li>
          <li><span><kbd>Ctrl</kbd> + <kbd>Z</kbd></span><span>Desfazer a última exclusão</span></li>
          <li><span><kbd>↑</kbd> <kbd>↓</kbd> nas listas</span><span>Andar entre as contas</span></li>
          <li><span><kbd>Enter</kbd> / <kbd>Espaço</kbd> / <kbd>M</kbd></span><span>Pagar… / pagar hoje / menu</span></li>
        </ul>
      </section>
      <section class="card">
        <h2 class="card__title">${icon('smartphone')} No celular</h2>
        <ul class="tips">
          <li>Deslize uma conta para a <strong>direita</strong> para pagar e para a <strong>esquerda</strong> para ver as opções.</li>
          <li>No topo da página, <strong>puxe para baixo</strong> para atualizar e sincronizar.</li>
          <li>Toque e segure o ícone do app para os atalhos "Novo gasto" e "Plantão".</li>
        </ul>
      </section>
    </div>`;
}

function privacy() {
  return html`
    <div class="settings">
      <section class="card prose">
        <h2 class="card__title">${icon('shield-check')} Política de privacidade (curta)</h2>
        <p><strong>O que o Dhenors guarda:</strong> só o que você digita (contas, salário, metas…), na <strong>sua conta</strong> do Supabase, <strong>criptografado no aparelho</strong> com uma frase que só você sabe. O servidor guarda blocos ilegíveis, a lista de aparelhos conectados (nome e data) e o e-mail da conta. Não há anúncios, rastreadores nem análise de uso.</p>
        <p><strong>No navegador:</strong> só o acesso à conta (pelo tempo que você escolheu ao entrar) e as preferências de aparência. Nenhum dado financeiro, cópia ou anexo fica no aparelho.</p>
        <p><strong>Notificações push (opcional):</strong> o servidor recebe só quantas contas vencem por dia, sem valores nem nomes.</p>
        <p><strong>Fale conosco:</strong> o que você escreve no formulário (nome, e-mail, mensagem e o anexo, se houver), a versão do app e o tipo de aparelho vão por e-mail (serviço Resend) para quem desenvolve o Dhenors, só para responder você. Nenhum dado financeiro vai junto.</p>
        <p><strong>Serviços externos, só quando você usa:</strong> Banco Central (CDI, Selic, IPCA — nada é enviado), brapi (só os códigos dos ativos, ex.: PETR4) e reconhecimento de voz do navegador (o áudio pode ser processado pelo fornecedor do navegador).</p>
        <p><strong>Anexos</strong> (fotos de comprovantes) vão cifrados para a sua conta, cada um com uma chave própria.</p>
        <p><strong>Seus direitos (LGPD):</strong> você pode baixar tudo (Dados → Baixar backup), apagar os dados da conta (Dados → Apagar tudo) e pedir a exclusão da conta e do e-mail cadastrado em Ajustes → Fale conosco.</p>
        <p class="muted small">Responsável pelos dados: o desenvolvedor do Dhenors — contato pelo Fale conosco ou 05henderson.dev@gmail.com. Detalhes em docs/PRIVACIDADE.md.</p>
      </section>
    </div>`;
}

function news() {
  return html`
    <div class="settings">
      ${CHANGELOG.map((c) => html`
        <section class="card">
          <h2 class="card__title">${icon('sparkles')} ${c.title} <span class="muted small">· ${formatDateBR(c.date)}${c.version === APP_VERSION ? ' · versão atual' : ''}</span></h2>
          ${c.groups.map((g) => html`<h3 class="dialog__subtitle">${g.title}</h3><ul class="tips">${g.items.map((t) => html`<li>${t}</li>`)}</ul>`)}
        </section>`)}
    </div>`;
}



/** Apagar só o salário: escolhe o que mais sai junto e confirma. */
function wipeSalaryDialog() {
  openDialog({
    title: 'Apagar só o salário',
    size: 'sm',
    danger: true,
    submitLabel: 'Apagar salário',
    body: html`
      <p class="dialog__text">Sempre sai: <strong>salário bruto, adicionais, descontos em folha, consignados, variáveis, sobreaviso, líquidos conferidos, admissão/13º e dia do pagamento</strong>.</p>
      <p class="dialog__text muted small">Contas, cartões, parcelamentos, metas, investimentos, categorias, rendas extras fora da folha e ajustes do app <strong>não</strong> são tocados.</p>
      ${switchField({ label: 'Também apagar férias, faltas e afastamentos', name: 'vacations', checked: true })}
      ${switchField({ label: 'Também apagar a escala de plantões e as rendas pagas na folha', name: 'shifts', checked: false })}
      ${switchField({ label: 'Também apagar benefícios, outros vínculos, FGTS e dados do IR anual', name: 'benefits', checked: false })}`,
    onSubmit: (form) => {
      A.clearSalaryData({ vacations: form.vacations.checked, shifts: form.shifts.checked, benefits: form.benefits.checked });
      toast('Dados do salário apagados.', { action: { label: 'Desfazer', run: () => { store.undo(); toast('Salário restaurado.'); } } });
    },
  });
}
