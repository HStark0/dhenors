// =============================================================
// feedback.js (tela) — "Fale conosco": feedback, sugestão ou reclamação
// -------------------------------------------------------------
// Fica em Ajustes → Fale conosco (#/ajustes?aba=contato). O formulário
// é montado uma vez no lugar reservado pela tela (#feedback-root) e
// marcado com data-persist: os redesenhos do app não apagam o que já
// foi digitado. Regras e limites: domain/feedback.js. Envio: core/feedback.js.
// =============================================================

import { html, raw } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { store } from '../core/store.js';
import { cloud } from '../core/cloud.js';
import { sendFeedback, fileToAttachment } from '../core/feedback.js';
import { FEEDBACK_AREAS, FEEDBACK_TYPES, FEEDBACK_LIMITS as L, validateFeedback } from '../domain/feedback.js';
import { APP_VERSION } from '../version.js';

const TYPE_HINT = {
  feedback: 'Conte o que achou: o que funciona bem, o que pode melhorar.',
  sugestao: 'Uma ideia de função nova ou de como algo poderia ser.',
  reclamacao: 'Algo deu errado ou não funcionou como deveria.',
};
const RATING_LABEL = ['', 'Muito ruim', 'Ruim', 'Regular', 'Bom', 'Excelente'];

/** Lugar reservado na tela (Ajustes → Fale conosco). */
export function feedbackSection() {
  return html`<div class="settings"><section class="card feedback-card" id="feedback-root" data-key="feedback-root"></section></div>`;
}

/** Monta o formulário no lugar reservado, se ainda não estiver lá (chamado depois de cada desenho). */
export function mountFeedback(root = document) {
  const host = root.querySelector?.('#feedback-root');
  if (!host || host.querySelector('[data-feedback]')) return;
  host.insertAdjacentHTML('beforeend', String(formHTML()));
  bind(host);
}

function formHTML() {
  const name = store.guest ? '' : (store.data.settings.profileName || '');
  const email = cloud.user?.email || '';
  const counter = (n, max) => html`<p class="feedback__count" data-count="${n}" aria-live="polite">0 / ${max}</p>`;
  return html`
    <div data-feedback data-persist>
      <form class="feedback" novalidate>
        <header class="feedback__head">
          <span class="feedback__icon">${icon('mail')}</span>
          <div>
            <h2 class="feedback__title">Fale conosco</h2>
            <p class="muted small">Elogio, ideia ou problema: a mensagem chega direto para quem desenvolve o Dhenors, e a resposta vem no seu e-mail.</p>
          </div>
        </header>

        <fieldset class="feedback__group" data-group="type">
          <legend class="field__label">Tipo de mensagem<span class="req" aria-hidden="true">*</span></legend>
          <div class="feedback__types">
            ${FEEDBACK_TYPES.map((t) => html`
              <label class="feedback__type feedback__type--${t.value}">
                <input type="radio" name="type" value="${t.value}" required>
                <span class="feedback__type-box">
                  <span class="feedback__type-icon">${icon(t.icon)}</span>
                  <strong>${t.label}</strong>
                  <small>${TYPE_HINT[t.value]}</small>
                </span>
              </label>`)}
          </div>
        </fieldset>

        <div class="form-grid">
          ${input({ label: 'Nome completo', name: 'name', value: name, required: true, extra: { autocomplete: 'name', maxlength: L.name } })}
          ${input({ label: 'E-mail para resposta', name: 'email', type: 'email', value: email, required: true, extra: { autocomplete: 'email', inputmode: 'email', maxlength: 160, placeholder: 'voce@exemplo.com' } })}
          <div class="field field--full">
            <label class="field__label" for="fb-area">Área do app<span class="req" aria-hidden="true">*</span></label>
            <select class="input select" id="fb-area" name="area" required>
              <option value="">Escolha a área…</option>
              ${FEEDBACK_AREAS.map((a) => html`<option value="${a}">${a}</option>`)}
            </select>
          </div>
          ${input({ label: 'Assunto', name: 'title', required: true, full: true, extra: { maxlength: L.title, placeholder: 'Resumo em poucas palavras' } })}
          <div class="field field--full">
            <label class="field__label" for="fb-message">Mensagem<span class="req" aria-hidden="true">*</span></label>
            <textarea class="input textarea feedback__text" id="fb-message" name="message" rows="5" maxlength="${L.message}" required placeholder="Escreva com calma: quanto mais detalhes, melhor."></textarea>
            ${counter('message', L.message)}
          </div>

          <div class="field field--full feedback__complaint" data-show="reclamacao" hidden>
            <div class="note note--warn">${icon('info')}<span><strong>Vamos resolver.</strong> Conte o passo a passo do problema. Se der, anexe uma captura da tela. A resposta chega no e-mail informado, normalmente em até 2 dias úteis. Nunca peça nem envie a sua senha ou frase secreta.</span></div>
            <label class="field__label" for="fb-details">Descrição detalhada do problema / erro ocorrido<span class="req" aria-hidden="true">*</span></label>
            <textarea class="input textarea feedback__text" id="fb-details" name="details" rows="5" maxlength="${L.details}" placeholder="1. O que você fez\n2. O que esperava que acontecesse\n3. O que aconteceu (mensagem de erro, se apareceu)"></textarea>
            ${counter('details', L.details)}
          </div>

          <fieldset class="field field--full feedback__group" data-group="rating" data-show="feedback" hidden>
            <legend class="field__label">Como está a sua experiência? <span class="muted">(opcional)</span></legend>
            <div class="feedback__stars" role="radiogroup" aria-label="Nota de 1 a 5">
              ${[1, 2, 3, 4, 5].map((n) => html`
                <label class="feedback__star" title="${RATING_LABEL[n]}">
                  <input type="radio" name="rating" value="${n}">
                  ${icon('star')}<span class="sr-only">${n} — ${RATING_LABEL[n]}</span>
                </label>`)}
              <span class="feedback__rating-text muted small" data-rating-text aria-live="polite">Sem nota</span>
              <button type="button" class="link small" data-rating-clear hidden>Limpar</button>
            </div>
          </fieldset>

          <div class="field field--full" data-group="file">
            <span class="field__label">Anexo <span class="muted">(opcional)</span></span>
            <input type="file" class="sr-only" id="fb-file" name="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf">
            <div class="feedback__file">
              <label for="fb-file" class="btn btn--secondary btn--sm">${icon('paperclip', 'icon--xs')} Anexar imagem ou PDF</label>
              <span class="feedback__file-name muted small" data-file-name>Captura de tela ou documento, até 5 MB.</span>
              <button type="button" class="icon-btn icon-btn--sm" data-file-clear aria-label="Remover anexo" hidden>${icon('x')}</button>
            </div>
          </div>

          <div class="feedback__trap" aria-hidden="true"><label>Não preencha<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
        </div>

        <p class="feedback__privacy muted small">${icon('shield-check', 'icon--xs')} Vão junto só a versão do app (${APP_VERSION}), o tipo de aparelho e a tela em que você estava. Nenhum dado financeiro.</p>
        <p class="form-error" role="alert" data-form-error hidden></p>
        <button type="submit" class="btn btn--primary feedback__submit">${icon('send', 'icon--xs')}<span>Enviar mensagem</span></button>
      </form>

      <div class="feedback__done" data-done hidden tabindex="-1">
        <span class="feedback__done-icon">${icon('circle-check')}</span>
        <h2 class="feedback__title">Mensagem enviada!</h2>
        <p class="muted" data-done-text></p>
        <button type="button" class="btn btn--secondary" data-again>${icon('plus', 'icon--xs')} Enviar outra mensagem</button>
      </div>
    </div>`;
}

function input({ label, name, type = 'text', value = '', required = false, full = false, extra = {} }) {
  const attrs = Object.entries(extra).map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`).join(' ');
  return html`
    <div class="field ${full ? 'field--full' : ''}">
      <label class="field__label" for="fb-${name}">${label}${required ? html`<span class="req" aria-hidden="true">*</span>` : ''}</label>
      <input class="input" id="fb-${name}" name="${name}" type="${type}" value="${value}" ${required ? 'required' : ''} ${raw(attrs)}>
    </div>`;
}

// ---------- Comportamento ----------

function bind(host) {
  const box = host.querySelector('[data-feedback]');
  const form = box.querySelector('form');
  const done = box.querySelector('[data-done]');
  let file = null;

  const type = () => form.querySelector('[name="type"]:checked')?.value || '';
  const syncType = () => {
    const t = type();
    for (const el of form.querySelectorAll('[data-show]')) {
      const show = el.dataset.show === t;
      el.hidden = !show;
      if (!show) for (const f of el.querySelectorAll('textarea')) f.required = false;
    }
    const details = form.querySelector('[name="details"]');
    details.required = t === 'reclamacao';
    if (t !== 'feedback') clearRating();
    form.querySelector('.feedback__submit span').textContent = t === 'reclamacao' ? 'Enviar reclamação' : t === 'sugestao' ? 'Enviar sugestão' : 'Enviar mensagem';
  };
  const count = (ta) => {
    const out = form.querySelector(`[data-count="${ta.name}"]`);
    if (!out) return;
    const n = ta.value.length;
    out.textContent = `${n} / ${ta.maxLength}`;
    out.classList.toggle('is-near', n > ta.maxLength * 0.9);
  };
  const paintStars = () => {
    const v = Number(form.querySelector('[name="rating"]:checked')?.value || 0);
    form.querySelectorAll('.feedback__star').forEach((s, i) => s.classList.toggle('is-on', i < v));
    form.querySelector('[data-rating-text]').textContent = v ? `${v} de 5 — ${RATING_LABEL[v]}` : 'Sem nota';
    form.querySelector('[data-rating-clear]').hidden = !v;
  };
  const clearRating = () => {
    form.querySelectorAll('[name="rating"]').forEach((r) => { r.checked = false; });
    paintStars();
  };
  const setFile = (f) => {
    file = f || null;
    const input = form.querySelector('[name="file"]');
    if (!f) input.value = '';
    form.querySelector('[data-file-name]').textContent = f ? `${f.name} · ${(f.size / 1024 / 1024).toFixed(f.size > 1048576 ? 1 : 2)} MB` : 'Captura de tela ou documento, até 5 MB.';
    form.querySelector('[data-file-clear]').hidden = !f;
    clearFieldError(form, 'file');
  };

  form.addEventListener('change', (ev) => {
    const n = ev.target.name;
    if (n === 'type') { syncType(); clearFieldError(form, 'type'); }
    if (n === 'rating') paintStars();
    if (n === 'file') setFile(ev.target.files?.[0]);
    if (n === 'area') clearFieldError(form, 'area');
  });
  form.addEventListener('input', (ev) => {
    if (ev.target.tagName === 'TEXTAREA') count(ev.target);
    if (ev.target.getAttribute('aria-invalid')) clearFieldError(form, ev.target.name);
  });
  form.querySelector('[data-rating-clear]').addEventListener('click', clearRating);
  form.querySelector('[data-file-clear]').addEventListener('click', () => setFile(null));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('.feedback__submit');
    if (btn.disabled) return;
    clearAllErrors(form);
    const v = (n) => form.elements[n]?.value ?? '';
    const input = {
      name: v('name'), email: v('email'), area: v('area'), type: type(), title: v('title'), message: v('message'),
      details: v('details'), rating: form.querySelector('[name="rating"]:checked')?.value ?? null,
      file: file ? { name: file.name, type: file.type, size: file.size } : null,
    };
    const { ok, errors, data } = validateFeedback(input);
    if (!ok) return showErrors(form, errors);
    // Robô preencheu o campo escondido: finge que enviou e não manda nada
    if (v('website')) return finish(data);

    setLoading(btn, true);
    try {
      const attachment = file ? await fileToAttachment(file) : null;
      await sendFeedback({ ...data, attachment });
      finish(data);
    } catch (err) {
      if (err.field) showErrors(form, [{ field: err.field, message: err.message }]);
      else {
        const box2 = form.querySelector('[data-form-error]');
        box2.textContent = err.message || 'Não foi possível enviar agora. Tente de novo.';
        box2.hidden = false;
        box2.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    } finally {
      setLoading(btn, false);
    }
    return undefined;
  });

  const finish = (data) => {
    const t = FEEDBACK_TYPES.find((x) => x.value === data.type);
    done.querySelector('[data-done-text]').textContent = `${t.label} sobre "${data.area}" recebida. Obrigado, ${data.name.split(' ')[0]}! A resposta chega em ${data.email}.`;
    form.hidden = true;
    done.hidden = false;
    done.focus({ preventScroll: true });
    done.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    toast(`${t.label} enviada. Obrigado!`, { type: 'success' });
  };

  done.querySelector('[data-again]').addEventListener('click', () => {
    // mantém nome e e-mail para a próxima mensagem
    const keep = { name: form.elements.name.value, email: form.elements.email.value };
    form.reset();
    form.elements.name.value = keep.name;
    form.elements.email.value = keep.email;
    setFile(null);
    clearRating();
    syncType();
    form.querySelectorAll('textarea').forEach(count);
    done.hidden = true;
    form.hidden = false;
    form.querySelector('[name="type"]').focus();
  });

  syncType();
}

function setLoading(btn, on) {
  btn.disabled = on;
  btn.toggleAttribute('aria-busy', on);
  btn.querySelector('.auth__spinner')?.remove();
  if (on) btn.insertAdjacentHTML('afterbegin', '<span class="auth__spinner" aria-hidden="true"></span>');
  btn.querySelector('.icon')?.toggleAttribute('hidden', on);
}

// ---------- Erros ao lado de cada campo ----------

function target(form, field) {
  if (field === 'type' || field === 'rating') return form.querySelector(`[data-group="${field}"]`);
  if (field === 'file') return form.querySelector('[data-group="file"]');
  return form.querySelector(`[name="${field}"]`);
}

function showErrors(form, errors) {
  for (const { field, message } of errors) {
    const el = target(form, field);
    if (!el) continue;
    const wrap = el.matches('fieldset, [data-group]') ? el : el.closest('.field');
    if (!el.matches('fieldset, [data-group]')) {
      el.setAttribute('aria-invalid', 'true');
      el.setAttribute('aria-describedby', `fb-${field}-err`);
    } else wrap.classList.add('is-invalid');
    // logo abaixo do campo (antes do contador de caracteres, se houver)
    const where = el.matches('textarea') ? el : wrap;
    where.insertAdjacentHTML(el.matches('textarea') ? 'afterend' : 'beforeend', `<p class="field__error" id="fb-${field}-err" data-error-for="${field}"></p>`);
    wrap.querySelector(`[data-error-for="${field}"]`).textContent = message;
  }
  const first = target(form, errors[0].field);
  const focusable = first?.matches('input, select, textarea') ? first : first?.querySelector('input, select, textarea');
  first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  focusable?.focus({ preventScroll: true });
}

function clearFieldError(form, field) {
  const el = target(form, field);
  if (!el) return;
  el.removeAttribute('aria-invalid');
  el.removeAttribute('aria-describedby');
  const wrap = el.matches('fieldset, [data-group]') ? el : el.closest('.field');
  wrap?.classList.remove('is-invalid');
  wrap?.querySelector(`[data-error-for="${field}"]`)?.remove();
}

function clearAllErrors(form) {
  form.querySelectorAll('[data-error-for]').forEach((e) => e.remove());
  form.querySelectorAll('[aria-invalid]').forEach((e) => { e.removeAttribute('aria-invalid'); e.removeAttribute('aria-describedby'); });
  form.querySelectorAll('.is-invalid').forEach((e) => e.classList.remove('is-invalid'));
  const box = form.querySelector('[data-form-error]');
  box.hidden = true;
  box.textContent = '';
}
