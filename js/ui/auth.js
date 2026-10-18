// =============================================================
// auth.js — Tela de entrada (login, cadastro e frase secreta)
// -------------------------------------------------------------
// Uma página própria, por cima do app, com os MESMOS passos de antes:
//   1. Conta: e-mail e senha (entrar · criar conta · esqueci a senha)
//   2. Frase secreta: cria (conta nova) ou digita; e por quanto tempo
//      lembrar o login neste aparelho.
// Depois disso os dados da nuvem abrem na memória (nada fica salvo no
// navegador). Quem vinha de uma versão que guardava os dados no
// aparelho leva esses dados para a nuvem aqui, e só então eles são
// apagados do navegador (core/legacy.js).
// Sem login, o app mostra um exemplo; esta tela abre ao tocar em
// "Entrar" ou ao tentar salvar qualquer coisa.
// =============================================================

import { html, render } from './dom.js';
import { icon } from './icons.js';
import { toast, toastError } from './toast.js';
import { field } from './forms.js';
import { store } from '../core/store.js';
import { cloud } from '../core/cloud.js';
import { countItems, hasUserData } from '../core/cloud/sync.js';
import { readLegacy, openLegacy, openLegacyFiles, legacyFile, purgeLegacy } from '../core/legacy.js';
import { passwordStrength } from '../core/crypto.js';
import { formatDateBR } from '../core/dates.js';
import { uploadExisting } from './attachments.js';

const REMEMBER = [
  { value: 'always', label: 'Sempre', hint: 'Até sair da conta', icon: 'lock-keyhole' },
  { value: '30d', label: '30 dias', hint: 'Depois pede de novo', icon: 'calendar-days' },
  { value: 'session', label: 'Só agora', hint: 'Até fechar o app', icon: 'clock' },
];

/** Estado da tela: qual passo e o que já se sabe. */
const ctx = {
  view: 'signin', email: '', error: '', busy: false, info: null,
  recovery: null, result: null, legacy: null, legacyState: null, pinKey: null, message: '',
};
let root = null;
let lastFocus = null;

export const authOpen = () => Boolean(root?.isConnected);

/**
 * Abre a tela no passo pedido:
 *   'signin' | 'signup' | 'forgot' | 'passphrase' | 'newpass' (recovery) | 'loading' | 'error' (message)
 */
export async function openAuth(view = 'signin', extra = {}) {
  Object.assign(ctx, { view, error: '', busy: false }, extra);
  if (!root?.isConnected) {
    lastFocus = document.activeElement;
    // Janela aberta por cima (ex.: formulário que pediu login) sai antes
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    root = document.createElement('div');
    root.className = 'auth';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'auth-title');
    document.body.append(root);
    document.body.classList.add('has-auth');
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && canClose()) { ev.preventDefault(); closeAuth(); } });
    ctx.legacy = await readLegacy().catch(() => null);
  }
  if (view === 'passphrase' && !ctx.info) loadInfo();
  paint();
}

export function closeAuth() {
  if (!root) return;
  root.remove();
  root = null;
  document.body.classList.remove('has-auth');
  Object.assign(ctx, { result: null, info: null, recovery: null, legacyState: null, pinKey: null, message: '' });
  if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
}

/** Dá para voltar ao exemplo? (no meio do login, não) */
const canClose = () => !ctx.busy && ['signin', 'signup', 'forgot', 'sent', 'confirm', 'error'].includes(ctx.view);

async function loadInfo() {
  ctx.info = null;
  try {
    ctx.info = await cloud.remoteInfo();
  } catch (err) {
    ctx.view = 'error';
    ctx.message = err.message;
  }
  paint();
}

// ---------- Desenho ----------

function paint() {
  if (!root) return;
  const focused = document.activeElement?.name;
  render(root, html`
    <div class="auth__scroll">
      <div class="auth__wrap">
        ${side()}
        <div class="auth__main">
          <div class="auth__card" data-view="${ctx.view}">
            ${steps()}
            ${VIEWS[ctx.view]?.() || ''}
          </div>
          ${canClose() && store.guest ? html`<button type="button" class="auth__guest" data-go="close">${icon('eye', 'icon--xs')} Continuar vendo o exemplo</button>` : ''}
        </div>
      </div>
    </div>`);
  const target = (focused && root.querySelector(`[name="${focused}"]`)) || root.querySelector('.auth__card input:not([type=hidden]):not([type=radio]), .auth__card .btn--primary');
  target?.focus({ preventScroll: true });
}

function side() {
  return html`
    <aside class="auth__side">
      <div class="auth__brand"><img src="assets/icons/logo-64.png" alt="" width="40" height="40"><span>Dhenors</span></div>
      <h2 class="auth__headline">Suas finanças em ordem, em qualquer aparelho.</h2>
      <ul class="auth__perks">
        ${perk('shield-check', 'Criptografado de ponta a ponta', 'Os dados são cifrados com a sua frase secreta antes de sair do aparelho. Nem o servidor consegue ler.')}
        ${perk('monitor-smartphone', 'Os mesmos números em todo lugar', 'Celular, computador do trabalho, tablet: abriu, está atualizado.')}
        ${perk('cloud', 'Nada fica no navegador', 'Sem cópias no aparelho. Saiu da conta, os dados saem junto.')}
      </ul>
    </aside>`;
}

const perk = (ic, title, text) => html`
  <li class="auth__perk"><span class="auth__perk-icon">${icon(ic)}</span><span><strong>${title}</strong><small>${text}</small></span></li>`;

/** Indicador "1 Conta · 2 Frase secreta". */
function steps() {
  const n = { signin: 1, signup: 1, forgot: 1, sent: 1, confirm: 1, newpass: 1, passphrase: 2, legacy: 2, choose: 2 }[ctx.view];
  if (!n) return '';
  return html`
    <ol class="auth__steps" aria-label="Etapas">
      <li class="${n >= 1 ? 'is-on' : ''}" aria-current="${n === 1 ? 'step' : 'false'}"><span>${n > 1 ? icon('check', 'icon--xs') : '1'}</span>Conta</li>
      <li class="${n >= 2 ? 'is-on' : ''}" aria-current="${n === 2 ? 'step' : 'false'}"><span>2</span>Frase secreta</li>
    </ol>`;
}

const errorLine = () => html`<p class="auth__error" role="alert" ${ctx.error ? '' : 'hidden'}>${icon('circle-alert', 'icon--xs')}<span>${ctx.error}</span></p>`;

const submit = (label) => html`
  <button type="submit" class="btn btn--primary auth__submit" ${ctx.busy ? 'disabled aria-busy="true"' : ''}>
    ${ctx.busy ? html`<span class="auth__spinner" aria-hidden="true"></span>` : ''}<span>${label}</span>
  </button>`;

const head = (ic, title, text, tone = '') => html`
  <div class="auth__head">
    <span class="auth__icon ${tone ? `auth__icon--${tone}` : ''}">${icon(ic)}</span>
    <h1 id="auth-title" class="auth__title">${title}</h1>
    ${text ? html`<p class="auth__lead">${text}</p>` : ''}
  </div>`;

function legacyNote() {
  if (!ctx.legacy) return '';
  return html`<div class="auth__note">${icon('smartphone')}<span>Este aparelho tem dados de uma versão anterior do Dhenors. Ao entrar, eles vão para a sua conta na nuvem e saem do navegador.</span></div>`;
}

function server() {
  const host = (cloud.config.url || '').replace(/^https:\/\//, '');
  return html`<p class="auth__server">${icon('cloud', 'icon--xs')} <span>${host || 'Servidor não configurado'}</span> · <button type="button" class="link" data-go="config">Alterar servidor</button></p>`;
}

const VIEWS = {
  signin: () => accountView('signin'),
  signup: () => accountView('signup'),

  forgot: () => html`
    ${head('key-round', 'Recuperar a senha', 'Enviaremos um link para o seu e-mail. Ao abrir o link, o Dhenors pede uma senha nova para a conta.')}
    <form class="auth__form" novalidate data-form="forgot">
      ${field({ label: 'E-mail da conta', name: 'email', type: 'email', value: ctx.email, required: true, extra: { autocomplete: 'email', inputmode: 'email' } })}
      <div class="auth__note">${icon('info')}<span>Isso troca só a <strong>senha da conta</strong>. A <strong>frase secreta</strong> continua a mesma e não pode ser recuperada por e-mail.</span></div>
      ${errorLine()}
      ${submit('Enviar link')}
    </form>
    <p class="auth__switch"><button type="button" class="link" data-go="signin">${icon('chevron-left', 'icon--xs')} Voltar para entrar</button></p>`,

  sent: () => html`
    ${head('mail', 'Confira o seu e-mail', html`Se existir uma conta com <strong>${ctx.email}</strong>, o link para criar uma nova senha chega em alguns minutos.`, 'pos')}
    <ul class="auth__list">
      <li>${icon('smartphone', 'icon--xs')} Abra o e-mail neste aparelho (ou em qualquer um com o Dhenors).</li>
      <li>${icon('inbox', 'icon--xs')} Não chegou? Veja o spam e as promoções.</li>
      <li>${icon('clock', 'icon--xs')} O link vale por pouco tempo e só funciona uma vez.</li>
    </ul>
    <button type="button" class="btn btn--secondary auth__submit" data-go="signin">Voltar para entrar</button>`,

  confirm: () => html`
    ${head('mail', 'Confirme o seu e-mail', html`Enviamos um link de confirmação para <strong>${ctx.email}</strong>. Abra o link e depois entre aqui com o e-mail e a senha.`, 'pos')}
    <button type="button" class="btn btn--primary auth__submit" data-go="signin">Já confirmei, entrar</button>
    <p class="auth__switch muted small">Não chegou? Veja o spam e as promoções.</p>`,

  newpass: () => html`
    ${head('key-round', 'Criar uma nova senha', 'Escolha a nova senha da sua conta. Depois, o app pede a frase secreta (a mesma de antes).')}
    <form class="auth__form" novalidate data-form="newpass">
      ${field({ label: 'Nova senha', name: 'password', type: 'password', required: true, hint: 'Mínimo de 6 caracteres.', extra: { autocomplete: 'new-password', minlength: 6 } })}
      ${field({ label: 'Repita a nova senha', name: 'password2', type: 'password', required: true, extra: { autocomplete: 'new-password', minlength: 6 } })}
      ${errorLine()}
      ${submit('Salvar nova senha')}
    </form>`,

  passphrase: () => {
    if (!ctx.info) {
      return html`${head('key-round', 'Frase secreta', '')}<div class="auth__loading"><span class="auth__spinner" aria-hidden="true"></span><span>Conferindo a sua conta…</span></div>`;
    }
    const creating = !ctx.info.exists;
    return html`
      ${creating
        ? head('key-round', 'Crie a sua frase secreta', 'Ela cifra os seus dados antes de irem para a nuvem. Só você sabe — nem o servidor consegue ler.')
        : head('key-round', 'Digite a sua frase secreta', html`É a frase que você criou ao começar a usar a nuvem${ctx.info.device ? html` · último envio: ${ctx.info.device}, ${formatDateBR(String(ctx.info.updatedAt).slice(0, 10))}` : ''}.`)}
      <form class="auth__form" novalidate data-form="passphrase">
        ${field({ label: 'Frase secreta', name: 'pass', type: 'password', required: true,
          hint: creating ? 'Pelo menos 8 caracteres. Ex.: uma frase curta que só você sabe.' : '',
          extra: { autocomplete: 'off', minlength: 8 } })}
        ${creating ? html`<div class="auth__strength" data-strength hidden><span class="auth__meter"><i></i></span><small></small></div>` : ''}
        ${creating ? field({ label: 'Repita a frase', name: 'pass2', type: 'password', required: true, extra: { autocomplete: 'off' } }) : ''}
        ${creating ? html`<div class="auth__note auth__note--warn">${icon('triangle-alert')}<span><strong>Anote em lugar seguro.</strong> Sem a frase, os dados não podem ser recuperados por ninguém. "Esqueci minha senha" troca só a senha da conta.</span></div>` : ''}
        <fieldset class="auth__remember">
          <legend>Lembrar o login neste aparelho</legend>
          <div class="auth__options">
            ${REMEMBER.map((o) => html`
              <label class="auth__option">
                <input type="radio" name="remember" value="${o.value}" ${cloud.remember === o.value ? 'checked' : ''}>
                <span class="auth__option-box">${icon(o.icon)}<strong>${o.label}</strong><small>${o.hint}</small></span>
              </label>`)}
          </div>
        </fieldset>
        ${errorLine()}
        ${submit(creating ? 'Criar e entrar' : 'Abrir meus dados')}
      </form>
      <p class="auth__switch">${cloud.user?.email ? html`<span class="muted">${cloud.user.email}</span> · ` : ''}<button type="button" class="link" data-go="logout">Usar outra conta</button></p>`;
  },

  legacy: () => html`
    ${head('lock-keyhole', ctx.legacy?.envelope ? 'Dados antigos deste aparelho' : 'Anexos antigos deste aparelho', html`Uma versão anterior guardou ${ctx.legacy?.envelope ? 'dados' : 'fotos de comprovantes'} aqui, protegidos por ${ctx.legacy?.kind === 'password' ? 'senha' : 'PIN'}. Digite para levá-los para a sua conta.`)}
    <form class="auth__form" novalidate data-form="legacy">
      ${field({ label: ctx.legacy?.kind === 'password' ? 'Senha do app' : 'PIN do app', name: 'secret', type: 'password', required: true,
        extra: { autocomplete: 'off', ...(ctx.legacy?.kind === 'password' ? {} : { inputmode: 'numeric' }) } })}
      ${errorLine()}
      ${submit('Levar para a nuvem')}
    </form>
    <p class="auth__switch"><button type="button" class="link danger" data-go="legacy-skip">Não levar (apagar deste aparelho)</button></p>`,

  choose: () => {
    const { remote } = ctx.result;
    return html`
      ${head('git-compare', 'Quais dados ficam?', 'Este aparelho e a nuvem têm dados diferentes. Escolha os que continuam na sua conta.')}
      <div class="auth__choices">
        <button type="button" class="auth__choice" data-pick="cloud">
          <span class="auth__choice-icon">${icon('cloud-download')}</span>
          <span><strong>Usar os da nuvem</strong><small>${countItems(remote)} itens · alterados em ${formatDateBR(String(remote.updatedAt || '').slice(0, 10)) || '—'}. Os deste aparelho são descartados.</small></span>
        </button>
        <button type="button" class="auth__choice" data-pick="local">
          <span class="auth__choice-icon">${icon('cloud-upload')}</span>
          <span><strong>Usar os deste aparelho</strong><small>${countItems(ctx.legacyState)} itens. Substituem os da nuvem (as versões antigas continuam no histórico).</small></span>
        </button>
      </div>
      ${errorLine()}`;
  },

  loading: () => html`
    <div class="auth__head">
      <span class="auth__icon">${icon('cloud-download')}</span>
      <h1 id="auth-title" class="auth__title">Abrindo os seus dados</h1>
      <div class="auth__loading"><span class="auth__spinner" aria-hidden="true"></span><span>Baixando e decifrando…</span></div>
    </div>`,

  error: () => html`
    ${head(navigator.onLine === false ? 'wifi-off' : 'cloud-alert', navigator.onLine === false ? 'Sem conexão' : 'Não foi possível abrir',
      html`${ctx.message || 'A nuvem não respondeu.'} Os seus dados ficam na nuvem: conecte-se e tente de novo.`, 'warn')}
    <button type="button" class="btn btn--primary auth__submit" data-go="retry">${icon('refresh-cw', 'icon--xs')} Tentar de novo</button>
    ${cloud.user ? html`<p class="auth__switch"><button type="button" class="link" data-go="logout">Sair da conta</button></p>` : ''}`,
};

function accountView(mode) {
  const signin = mode === 'signin';
  return html`
    <div class="segmented auth__tabs" role="tablist" aria-label="Entrar ou criar conta">
      <button type="button" class="segmented__btn" role="tab" aria-selected="${signin}" aria-pressed="${signin}" data-go="signin">Entrar</button>
      <button type="button" class="segmented__btn" role="tab" aria-selected="${!signin}" aria-pressed="${!signin}" data-go="signup">Criar conta</button>
    </div>
    ${head(signin ? 'log-in' : 'user-plus', signin ? 'Bem-vindo de volta' : 'Crie a sua conta',
      signin ? 'Entre com o e-mail e a senha da sua conta.' : 'É grátis. Use um e-mail que você acessa: ele confirma o cadastro e recupera a senha.')}
    ${legacyNote()}
    <form class="auth__form" novalidate data-form="${mode}">
      ${field({ label: 'E-mail', name: 'email', type: 'email', value: ctx.email, required: true, extra: { autocomplete: 'email', inputmode: 'email', placeholder: 'voce@exemplo.com' } })}
      ${field({ label: 'Senha da conta', name: 'password', type: 'password', required: true,
        hint: signin ? '' : 'Mínimo de 6 caracteres.',
        extra: { autocomplete: signin ? 'current-password' : 'new-password', minlength: 6 } })}
      ${signin ? html`<button type="button" class="link auth__forgot" data-go="forgot">Esqueci minha senha</button>` : ''}
      ${errorLine()}
      ${submit(signin ? 'Entrar' : 'Criar conta')}
    </form>
    ${server()}`;
}

// ---------- Eventos ----------

function onInput(ev) {
  if (ev.target.name === 'email') ctx.email = ev.target.value.trim();
  if (ev.target.name === 'pass' && root.querySelector('[data-strength]')) {
    const box = root.querySelector('[data-strength]');
    const v = ev.target.value;
    const s = passwordStrength(v);
    box.hidden = !v;
    box.dataset.score = String(v.length < 8 ? 0 : s.score);
    box.querySelector('small').textContent = v.length < 8 ? `Faltam ${8 - v.length} caracteres` : `Força: ${s.label}`;
  }
}

async function onClick(ev) {
  const go = ev.target.closest('[data-go]')?.dataset.go;
  const pick = ev.target.closest('[data-pick]')?.dataset.pick;
  if (pick) return finish(pick);
  if (!go) return;
  if (['signin', 'signup', 'forgot'].includes(go)) { Object.assign(ctx, { view: go, error: '' }); return paint(); }
  if (go === 'close') return closeAuth();
  if (go === 'config') {
    closeAuth();
    const { configDialog } = await import('./cloudUI.js');
    return configDialog();
  }
  if (go === 'logout') {
    await cloud.signOut();
    Object.assign(ctx, { view: 'signin', info: null, result: null, error: '' });
    return paint();
  }
  if (go === 'retry') return retry();
  if (go === 'legacy-skip') {
    ctx.legacyState = null;
    ctx.skipLegacy = true; // apaga os dados antigos ao abrir a conta
    return afterUnlock();
  }
  return undefined;
}

async function onSubmit(ev) {
  ev.preventDefault();
  const form = ev.target;
  if (ctx.busy) return;
  ctx.error = '';
  const kind = form.dataset.form;
  const v = (name) => form.elements[name]?.value ?? '';
  try {
    setBusy(true);
    if (kind === 'signin' || kind === 'signup') {
      const email = v('email').trim();
      ctx.email = email;
      if (!/^\S+@\S+\.\S+$/.test(email)) throw fieldError('E-mail inválido.', 'email');
      if (v('password').length < 6) throw fieldError('A senha precisa ter pelo menos 6 caracteres.', 'password');
      if (kind === 'signup') {
        const r = await cloud.signUp(email, v('password'));
        if (r.needsConfirm) { Object.assign(ctx, { view: 'confirm', busy: false }); return paint(); }
      } else {
        await cloud.signIn(email, v('password'));
      }
      Object.assign(ctx, { view: 'passphrase', info: null, busy: false });
      paint();
      return loadInfo();
    }
    if (kind === 'forgot') {
      const email = v('email').trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) throw fieldError('E-mail inválido.', 'email');
      await cloud.requestPasswordReset(email);
      Object.assign(ctx, { view: 'sent', email, busy: false });
      return paint();
    }
    if (kind === 'newpass') {
      const p = v('password');
      if (p.length < 6) throw fieldError('A senha precisa ter pelo menos 6 caracteres.', 'password');
      if (p !== v('password2')) throw fieldError('As senhas não conferem.', 'password2');
      await cloud.completePasswordReset(ctx.recovery, p);
      toast('Senha alterada! Agora digite a sua frase secreta.', { type: 'success' });
      Object.assign(ctx, { view: 'passphrase', info: null, recovery: null, busy: false });
      paint();
      return loadInfo();
    }
    if (kind === 'passphrase') {
      const creating = !ctx.info?.exists;
      if (v('pass').length < 8) throw fieldError('A frase secreta precisa ter pelo menos 8 caracteres.', 'pass');
      if (creating && v('pass') !== v('pass2')) throw fieldError('As frases não conferem.', 'pass2');
      const remember = form.querySelector('[name="remember"]:checked')?.value || 'always';
      ctx.result = await cloud.unlock(v('pass'), { remember });
      return await afterUnlock();
    }
    if (kind === 'legacy') {
      if (ctx.legacy.envelope) {
        const { state, key } = await openLegacy(ctx.legacy.envelope, v('secret'));
        ctx.legacyState = state;
        ctx.pinKey = key;
      } else {
        ctx.pinKey = await openLegacyFiles(ctx.legacy.kdf, v('secret'), ctx.legacy.files);
      }
      return await afterUnlock();
    }
  } catch (err) {
    ctx.busy = false;
    ctx.error = err?.message || String(err);
    paint();
    if (err.field) root?.querySelector(`[name="${err.field}"]`)?.focus();
  }
  return undefined;
}

function setBusy(on) {
  ctx.busy = on;
  const btn = root?.querySelector('.auth__submit');
  if (!btn) return;
  btn.disabled = on;
  btn.toggleAttribute('aria-busy', on);
  btn.querySelector('.auth__spinner')?.remove();
  if (on) btn.insertAdjacentHTML('afterbegin', '<span class="auth__spinner" aria-hidden="true"></span>');
}

const fieldError = (message, name) => Object.assign(new Error(message), { field: name });

async function retry() {
  Object.assign(ctx, { view: 'loading', error: '' });
  paint();
  try { await cloud.init(); } catch { /* status abaixo */ }
  settle();
}

/** Depois da abertura: fecha a tela ou mostra o passo certo. */
export function settle() {
  const st = cloud.state;
  if (!store.guest) { closeAuth(); return; }
  if (st.status === 'locked') { openAuth('passphrase', { info: null }); return; }
  if (['offline', 'error', 'paused'].includes(st.status) && cloud.user) { openAuth('error', { message: st.error }); return; }
  if (authOpen() && ctx.view === 'loading') closeAuth();
}

// ---------- Depois da frase: dados antigos do aparelho e abertura ----------

async function afterUnlock() {
  const { remote, damaged } = ctx.result;
  const legacy = ctx.skipLegacy ? null : ctx.legacy;
  // A conta tem dados na nuvem, mas nem a parte principal pôde ser lida: nunca
  // tratar como conta nova (isso enviaria um estado vazio por cima)
  if (!remote && damaged) {
    Object.assign(ctx, { view: 'error', busy: false, message: 'Os dados da nuvem estão incompletos e não puderam ser abertos com segurança. Nada foi alterado. Fale com o suporte em Ajustes → Fale conosco.' });
    return paint();
  }
  // Só anexos antigos protegidos por PIN (os dados já subiram antes): pede o PIN
  if (legacy && !legacy.envelope && legacy.kdf && legacy.files.length && !ctx.pinKey) {
    Object.assign(ctx, { view: 'legacy', busy: false, error: '' });
    return paint();
  }
  // Dados antigos cifrados com PIN/senha: pede o segredo (ou dá para não levar)
  if (legacy?.envelope && !ctx.legacyState) {
    const meta = legacy.meta || {};
    const clean = meta.linked && meta.userId === cloud.user?.id && !meta.dirty && !legacy.files.length;
    if (!clean) { Object.assign(ctx, { view: 'legacy', busy: false, error: '' }); return paint(); }
  }
  const local = ctx.legacyState || legacy?.state || null;
  const localHasData = Boolean(local && hasUserData(local));
  if (!remote) return finish(localHasData ? 'local' : 'empty');
  if (!localHasData) return finish('cloud');
  // Cópia de um aparelho que já sincronizava com esta conta, sem nada pendente: a nuvem vale
  const meta = legacy?.meta || {};
  if (meta.linked && meta.userId === cloud.user?.id && !meta.dirty) return finish('cloud');
  ctx.legacyState = local;
  Object.assign(ctx, { view: 'choose', busy: false, error: '' });
  if (damaged) ctx.error = 'Algumas partes dos dados da nuvem tinham sumido; o que foi possível veio do histórico de versões.';
  return paint();
}

/** Abre a conta: 'cloud' | 'local' (dados antigos do aparelho) | 'empty' (conta nova). */
async function finish(choice) {
  const { remote, version, damaged } = ctx.result;
  const legacy = ctx.skipLegacy ? null : ctx.legacy;
  const local = ctx.legacyState || legacy?.state || null;
  const pinKey = ctx.pinKey;
  try {
    Object.assign(ctx, { view: 'loading' });
    paint();
    if (choice === 'cloud') await cloud.link('cloud', remote, version);
    else await cloud.link('local', choice === 'local' ? local : null, version);
  } catch (err) {
    Object.assign(ctx, { view: 'error', message: err.message });
    return paint();
  }
  const skipped = ctx.skipLegacy;
  closeAuth();
  ctx.skipLegacy = false;
  if (skipped) { await purgeLegacy(); ctx.legacy = null; }
  else if (legacy) {
    // Os dados antigos só saem do navegador DEPOIS que a nuvem confirmou o envio
    const sent = await cloud.flush();
    if (!sent) {
      toast('Não foi possível enviar os dados deste aparelho para a nuvem agora. Eles continuam guardados aqui: abra o app de novo com internet e entre na conta para terminar.', { type: 'error', duration: 12000 });
      ctx.legacy = null;
      return undefined;
    }
    await moveLegacyFiles(legacy, pinKey);
    ctx.legacy = null;
  }
  toast(choice === 'cloud'
    ? (damaged ? 'Dados da nuvem abertos. Algumas partes vieram do histórico; confira os lançamentos.' : 'Pronto! Os seus dados estão abertos.')
    : choice === 'local' ? 'Pronto! Os dados deste aparelho foram para a nuvem e saíram do navegador.'
    : 'Conta pronta! Tudo o que você lançar fica na nuvem, criptografado.', { type: 'success' });
  return undefined;
}

/**
 * Anexos que só existiam neste aparelho: sobem cifrados para a nuvem
 * (mesmo id, chave nova no lançamento). Só depois tudo sai do navegador.
 */
async function moveLegacyFiles(legacy, pinKey) {
  const ids = new Set(legacy?.files || []);
  const missing = store.data.expenses.flatMap((e) => (e.attachments || []).filter((a) => !a.k && ids.has(a.id)).map((a) => a.id));
  const keys = {};
  let failed = 0;
  for (const id of missing) {
    try {
      const f = await legacyFile(id, pinKey); // null = o arquivo já não existe; erro = não abriu
      if (f) keys[id] = await uploadExisting(id, f.bytes);
    } catch { failed++; }
  }
  if (Object.keys(keys).length) {
    store.commit((d) => {
      for (const e of d.expenses) for (const a of e.attachments || []) if (keys[a.id]) a.k = keys[a.id];
    });
  }
  // A chave de cada anexo precisa estar na nuvem antes de apagar a cópia local
  const saved = await cloud.flush();
  if (failed || !saved) {
    toastError(`${failed || 'Alguns'} anexo(s) não puderam ser enviados agora. Eles continuam neste aparelho e sobem no próximo login.`);
    await purgeLegacy({ keepFiles: true, kdf: legacy.kdf });
  } else {
    await purgeLegacy();
  }
}

/** Ações do despachante central (data-action). */
export const authActions = {
  'auth:open': () => openAuth('signin'),
  'auth:signup': () => openAuth('signup'),
};
