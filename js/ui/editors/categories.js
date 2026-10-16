// =============================================================
// editors/categories.js — Categorias (ícone próprio, cor, grupo 50/30/20)
// =============================================================

import { html } from '../dom.js';
import { openDialog } from '../dialog.js';
import { toast } from '../toast.js';
import { field, segmentedField, readForm } from '../forms.js';
import { store } from '../../core/store.js';
import * as A from '../../domain/actions.js';
import { CATEGORY_ICONS, CATEGORY_COLORS, GROUP_LABELS } from '../../domain/defaults.js';
import { iconPicker } from './planning.js';

const data = () => store.data;

export function editCategory(category = null) {
  const c = category || { name: '', icon: 'i:tag', color: CATEGORY_COLORS[data().categories.length % CATEGORY_COLORS.length], group: 'needs' };
  openDialog({
    title: category ? 'Editar categoria' : 'Nova categoria',
    submitLabel: category ? 'Salvar' : 'Criar',
    body: html`
      <div class="form-grid">
        ${field({ label: 'Nome', name: 'name', value: c.name, required: true, full: true, extra: { maxlength: 60 } })}
        <div class="field--full">${segmentedField({ label: 'Tipo de gasto (regra 50/30/20)', name: 'group', value: c.group || 'needs', options: Object.entries(GROUP_LABELS).map(([value, label]) => ({ value, label })) })}</div>
        ${iconPicker('icon', CATEGORY_ICONS, c.icon, { svg: true })}
        <fieldset class="field field--full picker">
          <legend class="field__label">Cor</legend>
          <div class="swatches">
            ${CATEGORY_COLORS.map((color) => html`
              <label class="swatch" style="--swatch:${color}">
                <input type="radio" name="color" value="${color}" ${color === c.color ? 'checked' : ''}>
                <span class="sr-only">${color}</span>
              </label>`)}
          </div>
          <p class="field__hint">Vermelho e âmbar ficam de fora: são as cores de "atrasada" e "vence logo".</p>
        </fieldset>
      </div>`,
    onSubmit: (form) => {
      A.saveCategory({
        ...readForm(form), id: category?.id,
        color: form.querySelector('[name="color"]:checked')?.value,
        icon: form.querySelector('[name="icon"]:checked')?.value,
        group: form.querySelector('[name="group"]:checked')?.value,
      });
      toast(category ? 'Categoria atualizada.' : 'Categoria criada.');
    },
  });
}

export function editSubcategory(categoryId, sub = null) {
  openDialog({
    title: sub ? 'Renomear subcategoria' : 'Nova subcategoria',
    size: 'sm',
    submitLabel: 'Salvar',
    body: field({ label: 'Nome', name: 'name', value: sub?.name || '', required: true, extra: { maxlength: 60 } }),
    onSubmit: (form) => {
      A.saveSubcategory(categoryId, { id: sub?.id, name: form.name.value });
      toast('Subcategoria salva.');
    },
  });
}
