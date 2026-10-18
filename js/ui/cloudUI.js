// =============================================================
// cloudUI.js — Nuvem: configurar o servidor, status no topo, detalhes
// (versões, aparelhos, conflitos, frase) e a seção em Ajustes.
// Entrar, criar conta e a frase secreta ficam em ui/auth.js.
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';
import { openDialog, confirmDialog } from './dialog.js';
import { toast, toastError } from './toast.js';
import { field, selectField } from './forms.js';
import { store } from '../core/store.js';
import { cloud, CloudError } from '../core/cloud.js';
import { openAuth } from './auth.js';
import { formatDateBR, todayISO } from '../core/dates.js';
import { formatBRL } from '../core/money.js';

// Cada estado tem ícone E texto curto (nunca só um ícone riscado).
const STATUS = {
  off: { icon: 'cloud-off', label: 'Nuvem desligada', short: 'Nuvem desligada' },
  signedout: { icon: 'log-in', label: 'Sem login (toque para entrar)', short: 'Entrar' },
  locked: { icon: 'key-round', label: 'Falta a frase secreta', short: 'Falta a frase' },
  idle: { icon: 'cloud', label: 'Sincronizado', short: 'Sincronizado' },
  pending: { icon: 'cloud-upload', label: 'Alterações esperando envio', short: 'Enviando…' },
  syncing: { icon: 'refresh-cw', label: 'Sincronizando…', short: 'Sincronizando…' },
  offline: { icon: 'wifi-off', label: 'Sem internet — alterações esperando para subir (não feche o app)', short: 'Sem internet' },
  paused: { icon: 'cloud-alert', label: 'Projeto do Supabase pausado', short: 'Nuvem pausada' },
  error: { icon: 'cloud-alert', label: 'Erro na nuvem', short: 'Erro na nuvem' },
};

const when = (ms) => {
  if (!ms) return 'nunca';
  const d = new Date(ms);
  const sameDay = todayISO(d) === todayISO();
  return `${sameDay ? 'hoje' : formatDateBR(todayISO(d))} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

/** "agora", "há 2 min", "há 3 h", "ontem", "há 4 dias" */
export function timeAgo(ms, now = Date.now()) {
  if (!ms) return 'nunca';
  const s = Math.round((now - ms) / 1000);
  if (s < 45) return 'agora';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86_400) return `há ${Math.round(s / 3600)} h`;
  const days = Math.round(s / 86_400);
  return days === 1 ? 'ontem' : `há ${days} dias`;
}

/** Texto do status com detalhes: "Sincronizado há 2 min", "3 alterações pendentes". */
export function statusText(st = cloud.state) {
  if (st.status === 'idle') return `Sincronizado ${timeAgo(st.lastSync)}${st.live ? ' · ao vivo' : ''}`;
  if ((st.status === 'pending' || st.status === 'offline' || st.status === 'error') && st.pending) {
    return `${st.pending} ${st.pending === 1 ? 'alteração pendente' : 'alterações pendentes'}${st.status === 'offline' ? ' (sem internet)' : ''}`;
  }
  return (STATUS[st.status] || STATUS.idle).label;
}

/** Botão de status no topo, com texto. Sem login, vira "Entrar". */
export function cloudButton({ compact = false } = {}) {
  const st = cloud.state;
  if (store.guest) {
    return html`<button type="button" class="cloud-btn cloud-btn--signin ${compact ? 'cloud-btn--compact' : ''}" data-action="auth:open">${icon('log-in')}<span class="cloud-btn__text">Entrar</span></button>`;
  }
  const s = STATUS[st.status] || STATUS.idle;
  const text = statusText(st);
  return html`
    <button type="button" class="cloud-btn cloud-btn--${st.status} ${compact ? 'cloud-btn--compact' : ''}" data-action="cloud:open"
      aria-label="Nuvem: ${text}${st.error ? `. ${st.error}` : ''}" title="${text}${st.error ? ` · ${st.error}` : ''}">
      ${icon(s.icon)}<span class="cloud-btn__text">${st.status === 'idle' ? `Sincronizado ${timeAgo(st.lastSync)}` : st.pending && st.status !== 'syncing' ? `${st.pending} pendente${st.pending > 1 ? 's' : ''}` : s.short}</span>
      ${st.conflicts ? html`<span class="cloud-btn__badge" title="Conflitos para resolver">${st.conflicts}</span>` : ''}
    </button>`;
}

/** Abre o passo certo conforme a situação. */
export function openCloud() {
  if (!cloud.configured) return configDialog();
  const st = cloud.state.status;
  if (!cloud.user || st === 'signedout') return openAuth('signin');
  if (store.guest || st === 'locked') return openAuth('passphrase');
  return statusDialog();
}

/** Aviso de pausa do projeto gratuito (Painel e Ajustes). */
export function pauseBanner() {
  const r = cloud.pauseRisk();
  if (!r || (!r.warn && !r.paused)) return '';
  return html`
    <div class="banner banner--warn" role="note">
      ${icon('cloud-alert')}
      <p>${r.paused
        ? html`O projeto gratuito do Supabase <strong>pausou</strong> por falta de uso. Abra <strong>supabase.com</strong> → seu projeto → <strong>Restore project</strong>. Seus dados continuam lá; enquanto isso, as alterações ficam esperando para subir (não feche o app).`
        : html`A nuvem não é usada há <strong>${r.days} dias</strong>. O Supabase gratuito <strong>pausa projetos após 7 dias sem uso</strong>${r.left ? ` (faltam ${r.left})` : ''}. Sincronize agora para evitar.`}</p>
      ${r.paused ? '' : html`<button type="button" class="btn btn--secondary btn--sm" data-action="cloud:sync">${icon('refresh-cw', 'icon--xs')} Sincronizar</button>`}
    </div>`;
}

// ---------- 1. Configurar o Supabase ----------

export function configDialog() {
  const c = cloud.config;
  openDialog({
    title: 'Conectar à nuvem',
    submitLabel: 'Continuar',
    body: html`
      <p class="dialog__text muted">Use um projeto <strong>gratuito</strong> do Supabase. O passo a passo completo está no arquivo <code>docs/NUVEM.md</code>. Em resumo:</p>
      <ol class="steps">
        <li>Crie o projeto em <strong>supabase.com</strong>.</li>
        <li>No <em>SQL Editor</em>, rode o arquivo <code>supabase/schema.sql</code>.</li>
        <li>Em <em>Project Settings → API</em>, copie a URL e a chave <strong>anon/publishable</strong> e cole aqui.</li>
      </ol>
      <div class="form-grid">
        ${field({ label: 'URL do projeto', name: 'url', value: c.url, required: true, full: true, placeholder: 'https://abcdefgh.supabase.co', extra: { autocomplete: 'off', spellcheck: 'false', inputmode: 'url' } })}
        ${field({ label: 'Chave pública (anon / publishable)', name: 'anonKey', value: c.anonKey, required: true, full: true, placeholder: 'eyJhbGciOi… ou sb_publishable_…', extra: { autocomplete: 'off', spellcheck: 'false' } })}
      </div>
      <p class="field__hint">Essa chave é pública por natureza. Seus dados ficam protegidos pelo login e pela criptografia com a sua frase secreta.</p>`,
    onSubmit: (form) => {
      try { cloud.setConfig({ url: form.url.value, anonKey: form.anonKey.value }); } catch (err) { throw wrap(err, 'url'); }
      setTimeout(() => openAuth('signin'), 50);
    },
  });
}

// ---------- 4. Status ----------

const REMEMBER_OPTIONS = [
  { value: 'always', label: 'Sempre (até eu sair da conta)' },
  { value: '30d', label: 'Por 30 dias' },
  { value: 'session', label: 'Só até fechar o app' },
];

async function statusDialog() {
  const st = cloud.state;
  const [copies, conflicts] = await Promise.all([cloud.conflictBackups(), cloud.conflicts()]);
  const risk = cloud.pauseRisk();
  openDialog({
    title: 'Nuvem',
    body: html`
      <div class="cloud-status cloud-status--${st.status}">
        ${icon((STATUS[st.status] || STATUS.idle).icon)}
        <div><strong>${statusText(st)}</strong>
          <small>${cloud.user?.email || ''} · última sincronização: ${when(st.lastSync)}${st.live ? ' · tempo real ligado' : ' · consulta a cada minuto'}</small>
          ${st.error ? html`<small class="neg">${st.error}</small>` : ''}</div>
      </div>
      ${risk?.warn || risk?.paused ? pauseBanner() : ''}
      ${conflicts.length ? html`
        <div class="note note--warn">${icon('triangle-alert')}<span><strong>${conflicts.length === 1 ? '1 item foi alterado' : `${conflicts.length} itens foram alterados`} em dois aparelhos ao mesmo tempo.</strong> Ficou a versão da nuvem; escolha qual manter.
          <button type="button" class="link" data-conflicts>Resolver agora</button></span></div>` : ''}
      ${copies.map((c) => html`
        <div class="note">${icon('info')}<span>Há uma cópia completa guardada de ${when(c.at)} (versão de ${c.origin}).
          <button type="button" class="link" data-restore="${c.at}">Restaurar essa cópia</button> · <button type="button" class="link" data-discard="${c.at}">Descartar</button></span></div>`)}
      <ul class="sheet-list">
        <li><button type="button" class="sheet-item" data-versions>${icon('history')}<span>Histórico de versões<small>Volte os dados para como estavam (últimas 30 versões)</small></span></button></li>
        <li><button type="button" class="sheet-item" data-devices>${icon('monitor-smartphone')}<span>Aparelhos conectados<small>Veja quem acessa e desconecte à distância</small></span></button></li>
        <li><button type="button" class="sheet-item" data-pass>${icon('key-round')}<span>Trocar a frase secreta<small>Recriptografa tudo com a frase nova</small></span></button></li>
        <li><button type="button" class="sheet-item" data-remember>${icon('smartphone')}<span>Lembrar o login neste aparelho<small>${REMEMBER_OPTIONS.find((o) => o.value === cloud.remember)?.label}</small></span></button></li>
      </ul>
      <p class="field__hint">Os dados ficam só na nuvem, criptografados com a sua frase. Cada alteração sobe na hora (só as partes que mudaram). Neste aparelho fica apenas o login.</p>
      <div class="card__actions">
        <button type="button" class="btn btn--primary btn--sm" data-sync>${icon('refresh-cw', 'icon--xs')} Sincronizar agora</button>
        <button type="button" class="btn btn--ghost btn--sm danger" data-logout>${icon('log-out', 'icon--xs')} Sair da conta</button>
      </div>`,
    onMount: (dlg) => {
      const go = (fn) => () => { dlg.close(); setTimeout(fn, 50); };
      dlg.querySelector('[data-sync]').addEventListener('click', async () => { await cloud.syncNow(); dlg.close(); toast(cloud.state.status === 'idle' ? 'Sincronizado.' : cloud.state.error || 'Não foi possível agora.'); });
      dlg.querySelector('[data-conflicts]')?.addEventListener('click', go(conflictsDialog));
      dlg.querySelector('[data-versions]').addEventListener('click', go(versionsDialog));
      dlg.querySelector('[data-devices]').addEventListener('click', go(devicesDialog));
      dlg.querySelector('[data-pass]').addEventListener('click', go(changePassphraseDialog));
      dlg.querySelector('[data-remember]').addEventListener('click', go(rememberDialog));
      dlg.querySelector('[data-logout]').addEventListener('click', async () => {
        dlg.close();
        await signOutFlow();
      });
      const copyOf = (btn, attr) => copies.find((c) => String(c.at) === btn.dataset[attr]);
      dlg.querySelectorAll('[data-restore]').forEach((btn) => btn.addEventListener('click', async () => {
        const copy = copyOf(btn, 'restore');
        dlg.close();
        const ok = await confirmDialog({ title: 'Restaurar cópia', message: 'Os dados atuais serão substituídos pela cópia guardada (em todos os aparelhos).', confirmLabel: 'Restaurar' });
        if (ok && copy) { await store.replace(copy.data); await cloud.clearConflict(copy.at); toast('Cópia restaurada.'); }
      }));
      dlg.querySelectorAll('[data-discard]').forEach((btn) => btn.addEventListener('click', async () => {
        const copy = copyOf(btn, 'discard');
        if (copy) await cloud.clearConflict(copy.at);
        dlg.close();
        toast('Cópia descartada.');
      }));
    },
  });
}

// ---------- Conflitos: os dois lados, você escolhe ----------

const FIELD_LABELS = { cents: 'Valor', description: 'Descrição', dueDate: 'Vencimento', paidAt: 'Pago em', categoryId: 'Categoria', subcategoryId: 'Subcategoria', notes: 'Observação', dueDay: 'Dia', name: 'Nome', targetCents: 'Valor da meta', tags: 'Etiquetas', count: 'Parcelas', date: 'Data' };

function showValue(key, v) {
  if (v == null || v === '') return '—';
  if (/cents$/i.test(key) || key === 'cents') return formatBRL(v);
  if (/date|At$/.test(key) && typeof v === 'string') return formatDateBR(v.slice(0, 10));
  if (key === 'categoryId') return store.data.categories.find((c) => c.id === v)?.name || '—';
  if (Array.isArray(v)) return v.join(', ') || '—';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
  return String(v);
}

function sideTable(c) {
  if (!c.local || !c.remote || typeof c.local !== 'object') {
    return html`<div class="conflict__sides"><div><h4>Este aparelho</h4><p>${c.local == null ? 'Apagado aqui' : showValue('', c.local)}</p></div><div><h4>Nuvem (${c.from})</h4><p>${c.remote == null ? 'Apagado lá' : showValue('', c.remote)}</p></div></div>`;
  }
  const keys = (c.fields?.length ? c.fields.map((f) => f.split('.')[0]) : Object.keys({ ...c.local, ...c.remote })).filter((k, i, a) => a.indexOf(k) === i && k !== 'id');
  return html`
    <table class="table table--compact conflict__table">
      <thead><tr><th scope="col">Campo</th><th scope="col">Este aparelho</th><th scope="col">Nuvem</th></tr></thead>
      <tbody>${keys.map((k) => html`<tr class="${JSON.stringify(c.local[k]) !== JSON.stringify(c.remote[k]) ? 'is-diff' : ''}"><th scope="row">${FIELD_LABELS[k] || k}</th><td>${showValue(k, c.local[k])}</td><td>${showValue(k, c.remote[k])}</td></tr>`)}</tbody>
    </table>`;
}

export async function conflictsDialog() {
  const render = async () => {
    const list = await cloud.conflicts();
    if (!list.length) return html`<div class="empty empty--sm">${icon('circle-check', 'icon--lg pos')}<p><strong>Nenhum conflito.</strong></p></div>`;
    return html`
      <p class="dialog__text muted">O mesmo item foi alterado neste aparelho e em outro antes de sincronizar. Por enquanto vale a versão da <strong>nuvem</strong>. Escolha o que fica:</p>
      <ul class="conflicts">
        ${list.map((c) => html`
          <li class="conflict">
            <p class="conflict__title"><strong>${c.label}</strong> <small class="muted">${when(c.at)}</small></p>
            ${sideTable(c)}
            <div class="card__actions">
              <button type="button" class="btn btn--secondary btn--sm" data-keep="local" data-id="${c.id}">Manter a deste aparelho</button>
              <button type="button" class="btn btn--ghost btn--sm" data-keep="remote" data-id="${c.id}">Manter a da nuvem</button>
            </div>
          </li>`)}
      </ul>`;
  };
  const { dialog } = openDialog({ title: 'Conflitos de sincronização', size: 'lg', body: await render(),
    footer: html`<button type="button" class="btn btn--ghost" data-all-remote>Manter tudo como está (nuvem)</button>` });
  const body = dialog.querySelector('.dialog__body');
  dialog.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-keep]');
    if (btn) {
      try {
        await cloud.resolveConflict(btn.dataset.id, btn.dataset.keep);
      } catch (err) { toastError(err?.message || 'Não foi possível restaurar.'); return; }
      body.innerHTML = (await render()).toString();
      toast(btn.dataset.keep === 'local' ? 'Versão deste aparelho restaurada (vai para a nuvem).' : 'Mantida a versão da nuvem.');
    }
    if (ev.target.closest('[data-all-remote]')) { await cloud.clearConflicts(); dialog.close(); toast('Conflitos dispensados.'); }
  });
}

// ---------- Histórico de versões ----------

export async function versionsDialog() {
  let list;
  try { list = await cloud.listVersions(); } catch (err) { toast(err.message, { type: 'error' }); return; }
  const { dialog } = openDialog({
    title: 'Histórico de versões',
    body: list.length ? html`
      <p class="dialog__text muted">Cada sincronização guarda uma versão (as últimas 30). Restaurar volta TODOS os dados para aquele momento — e vira uma versão nova, então dá para desfazer.</p>
      <ul class="mini-list">
        ${list.map((v, i) => html`
          <li>
            <span><strong>${when(Date.parse(v.created_at))}</strong> <small class="muted">${v.device || 'aparelho'}${i === 0 ? ' · atual' : ''}</small></span>
            <span class="mini-list__actions">${i === 0 ? '' : html`<button type="button" class="btn btn--ghost btn--sm" data-restore="${v.version}">${icon('rotate-ccw', 'icon--xs')} Restaurar</button>`}</span>
          </li>`)}
      </ul>` : html`<p class="muted">Ainda não há versões guardadas. Elas aparecem a partir da próxima sincronização.</p>`,
  });
  dialog.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-restore]');
    if (!btn) return;
    const ok = await confirmDialog({ title: 'Restaurar versão', message: 'Os dados atuais (em todos os aparelhos) voltam para como estavam nessa versão. A versão atual continua no histórico.', confirmLabel: 'Restaurar', danger: true });
    if (!ok) return;
    try { await cloud.restoreVersion(Number(btn.dataset.restore)); dialog.close(); toast('Versão restaurada.'); } catch (err) { toast(err.message, { type: 'error' }); }
  });
}

// ---------- Aparelhos conectados ----------

export async function devicesDialog() {
  const render = async () => {
    let list = [];
    try { list = await cloud.listDevices(); } catch (err) { return html`<p class="neg">${err.message}</p>`; }
    return html`
      <ul class="mini-list">
        ${list.map((d) => html`
          <li class="${d.revoked ? 'is-muted' : ''}">
            <span>${icon(/Android|iPhone/.test(d.name || '') ? 'smartphone' : 'laptop', 'icon--xs')} <strong>${d.name || 'Aparelho'}</strong>${d.current ? html` <span class="badge badge--good">este</span>` : ''}${d.revoked ? html` <span class="badge badge--muted">desconectado</span>` : ''}
              <small class="muted">visto ${timeAgo(Date.parse(d.last_seen))} · v${d.app_version || '?'}</small></span>
            <span class="mini-list__actions">
              ${d.current ? html`<button type="button" class="btn btn--ghost btn--sm" data-rename>Renomear</button>`
                : d.revoked ? html`<button type="button" class="icon-btn icon-btn--sm" data-forget="${d.device_id}" aria-label="Remover da lista">${icon('trash-2')}</button>`
                : html`<button type="button" class="btn btn--ghost btn--sm danger" data-revoke="${d.device_id}">Desconectar</button>`}
            </span>
          </li>`)}
      </ul>
      <p class="field__hint">Desconectar: aquele aparelho sai da nuvem (os dados dele continuam lá, mas param de sincronizar). Por segurança, as sessões de TODOS os outros aparelhos também são encerradas no servidor: os que você usa precisam entrar de novo com e-mail e senha.</p>`;
  };
  const { dialog } = openDialog({ title: 'Aparelhos conectados', body: await render(),
    footer: html`<button type="button" class="btn btn--ghost danger" data-others>Encerrar a sessão de todos os outros</button>` });
  const body = dialog.querySelector('.dialog__body');
  dialog.addEventListener('click', async (ev) => {
    const t = ev.target;
    try {
      if (t.closest('[data-revoke]')) { await cloud.revokeDevice(t.closest('[data-revoke]').dataset.revoke); toast('Aparelho desconectado. Os outros aparelhos precisam entrar de novo.'); }
      else if (t.closest('[data-forget]')) await cloud.forgetDevice(t.closest('[data-forget]').dataset.forget);
      else if (t.closest('[data-rename]')) {
        const name = prompt('Nome deste aparelho', cloud.deviceName);
        if (name) cloud.setDeviceName(name);
        await new Promise((r) => setTimeout(r, 600));
      } else if (t.closest('[data-others]')) {
        const ok = await confirmDialog({ title: 'Encerrar outras sessões', message: 'Todos os outros aparelhos precisarão entrar de novo com e-mail e senha.', confirmLabel: 'Encerrar', danger: true });
        if (ok) { await cloud.signOutOthers(); toast('Sessões dos outros aparelhos encerradas.'); }
      } else return;
      body.innerHTML = (await render()).toString();
    } catch (err) { toast(err.message, { type: 'error' }); }
  });
}

// ---------- Trocar a frase secreta ----------

export function changePassphraseDialog() {
  openDialog({
    title: 'Trocar a frase secreta',
    size: 'sm',
    submitLabel: 'Trocar e recriptografar',
    body: html`
      <p class="dialog__text muted">Todos os dados da nuvem são criptografados de novo com a frase nova. Nos outros aparelhos, o app vai pedir a frase nova.</p>
      <div class="form-grid">
        ${field({ label: 'Frase atual', name: 'current', type: 'password', required: true, full: true, extra: { autocomplete: 'off' } })}
        ${field({ label: 'Frase nova', name: 'next', type: 'password', required: true, full: true, hint: 'Pelo menos 8 caracteres.', extra: { autocomplete: 'off', minlength: 8 } })}
        ${field({ label: 'Repita a frase nova', name: 'next2', type: 'password', required: true, full: true, extra: { autocomplete: 'off' } })}
      </div>
      <div class="note note--warn">${icon('triangle-alert')}<span>Anote a frase nova: ela também não pode ser recuperada.</span></div>`,
    onSubmit: async (form) => {
      if (form.next.value !== form.next2.value) throw new CloudFieldError('As frases não conferem.', 'next2');
      try { await cloud.changePassphrase(form.current.value, form.next.value); } catch (err) { throw wrap(err, 'current'); }
      toast('Frase secreta trocada. Os dados foram recriptografados.');
    },
  });
}

/** Sair da conta: envia o que faltar e tira os dados da memória. */
export async function signOutFlow() {
  const sent = await cloud.flush();
  // Conflitos e cópias guardadas só existem enquanto o app está aberto
  const [conflicts, copies] = await Promise.all([cloud.conflicts(), cloud.conflictBackups()]);
  const loose = conflicts.length + copies.length;
  const risky = !sent || loose > 0;
  const ok = await confirmDialog({
    title: 'Sair da conta',
    message: !sent
      ? 'Há alterações que ainda não subiram para a nuvem (sem conexão?). Se sair agora, elas se perdem.'
      : loose
        ? `Há ${conflicts.length ? `${conflicts.length} conflito(s) sem resolver` : ''}${conflicts.length && copies.length ? ' e ' : ''}${copies.length ? `${copies.length} cópia(s) guardada(s)` : ''} em Nuvem → Detalhes. Ao sair, a versão deste aparelho desses itens é descartada (fica a da nuvem).`
        : 'Os dados saem deste aparelho e continuam na sua conta. Para voltar, entre de novo com e-mail, senha e frase secreta.',
    confirmLabel: risky ? 'Sair mesmo assim' : 'Sair',
    danger: risky,
  });
  if (!ok) return;
  await cloud.signOut();
  location.hash = '#/painel';
  toast('Você saiu da conta.');
}

function rememberDialog() {
  openDialog({
    title: 'Lembrar o login neste aparelho',
    size: 'sm',
    submitLabel: 'Salvar',
    body: html`
      ${selectField({ label: 'Por quanto tempo', name: 'remember', value: cloud.remember, options: REMEMBER_OPTIONS })}
      <p class="field__hint">Num aparelho compartilhado, escolha "Só até fechar o app". No navegador fica só o acesso à conta (nunca os seus dados).</p>`,
    onSubmit: async (form) => { await cloud.setRemember(form.remember.value); toast('Preferência salva.'); },
  });
}

// ---------- Ajustes ----------

export function cloudSettingsSection() {
  const st = cloud.state;
  return html`
    <section class="card" id="nuvem">
      <h2 class="card__title">${icon('cloud')} Nuvem</h2>
      ${pauseBanner()}
      ${cloud.linked ? html`
        <div class="setting">
          <div><strong>${statusText(st)}</strong><p class="muted small">${cloud.user?.email} · última sincronização: ${when(st.lastSync)}${st.error ? ` · ${st.error}` : ''}</p></div>
          <div class="setting__actions">
            <button type="button" class="btn btn--secondary btn--sm" data-action="cloud:sync">${icon('refresh-cw', 'icon--xs')} Sincronizar</button>
            <button type="button" class="btn btn--ghost btn--sm" data-action="cloud:open">Detalhes</button>
          </div>
        </div>
        ${st.conflicts ? html`
          <div class="setting">
            <div><strong>Conflitos para resolver</strong><p class="muted small">${st.conflicts} item(ns) alterado(s) em dois aparelhos.</p></div>
            <button type="button" class="btn btn--secondary btn--sm" data-action="cloud:conflicts">Resolver</button>
          </div>` : ''}
        <div class="setting">
          <div><strong>Versões e aparelhos</strong><p class="muted small">Restaure uma versão anterior ou desconecte um aparelho à distância.</p></div>
          <div class="setting__actions">
            <button type="button" class="btn btn--ghost btn--sm" data-action="cloud:versions">${icon('history', 'icon--xs')} Versões</button>
            <button type="button" class="btn btn--ghost btn--sm" data-action="cloud:devices">${icon('monitor-smartphone', 'icon--xs')} Aparelhos</button>
          </div>
        </div>
        <div class="setting">
          <div><strong>Conta</strong><p class="muted small">${cloud.user?.email || ''} · login lembrado: ${(REMEMBER_OPTIONS.find((o) => o.value === cloud.remember)?.label || '').toLowerCase()}</p></div>
          <button type="button" class="btn btn--ghost btn--sm danger" data-action="cloud:logout">${icon('log-out', 'icon--xs')} Sair</button>
        </div>
        <div class="setting">
          <div><strong>Criptografia</strong><p class="muted small">Ativa: os dados vão para a nuvem cifrados com a sua frase secreta (AES-256).</p></div>
          <button type="button" class="btn btn--ghost btn--sm" data-action="cloud:passphrase">${icon('key-round', 'icon--xs')} Trocar frase</button>
        </div>`
      : html`
        <div class="setting">
          <div><strong>Entre para usar com os seus dados</strong><p class="muted small">Os dados ficam na sua conta, criptografados com uma frase que só você sabe, e abrem no celular, no trabalho ou em casa. Nada fica salvo no navegador.</p></div>
          <button type="button" class="btn btn--primary btn--sm" data-action="cloud:open">${icon('log-in', 'icon--xs')} ${!cloud.configured ? 'Conectar' : !cloud.user ? 'Entrar' : 'Digitar a frase'}</button>
        </div>`}
    </section>`;
}

/** Ações da nuvem para o despachante central. */
export const cloudActions = {
  'cloud:conflicts': () => conflictsDialog(),
  'cloud:versions': () => versionsDialog(),
  'cloud:devices': () => devicesDialog(),
  'cloud:passphrase': () => changePassphraseDialog(),
  'cloud:logout': () => signOutFlow(),
};

// ---------- utilidades ----------

class CloudFieldError extends Error {
  constructor(message, field) { super(message); this.field = field; this.name = 'ValidationError'; }
}
const wrap = (err, fieldName) => (err instanceof CloudError ? new CloudFieldError(err.message, fieldName) : err);
