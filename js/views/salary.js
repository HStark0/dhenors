// =============================================================
// Salário — contracheque e tudo o que vem do trabalho
// -------------------------------------------------------------
// Abas: Contracheque · Plantões · IR anual · Rescisão e FGTS ·
// Benefícios e vínculos · Carreira · Tabelas
// (o código de cada aba fica em views/salary/).
// =============================================================

import { html } from '../ui/dom.js';
import { tabsNav, currentTab, routeParams } from '../ui/tabs.js';
import { store } from '../core/store.js';
import { todayISO } from '../core/dates.js';
import { renderPayslip, payslipActions } from './salary/payslip.js';
import { renderShifts, shiftActions } from './salary/shifts.js';
import { renderIrpf, renderExit, renderBenefits, renderCareer, renderTables, moreSalaryActions, onExitFilter } from './salary/more.js';

const TABS = [
  { id: 'contracheque', label: 'Contracheque', icon: 'receipt', render: renderPayslip, monthNav: true },
  { id: 'plantoes', label: 'Plantões', icon: 'stethoscope', render: renderShifts, monthNav: true },
  { id: 'ir', label: 'IR anual', icon: 'landmark', render: renderIrpf },
  { id: 'rescisao', label: 'Rescisão e FGTS', icon: 'briefcase', render: renderExit },
  { id: 'beneficios', label: 'Benefícios e vínculos', icon: 'gift', render: renderBenefits, monthNav: true },
  { id: 'carreira', label: 'Carreira', icon: 'trending-up', render: renderCareer },
  { id: 'tabelas', label: 'Tabelas', icon: 'table', render: renderTables },
];

export default {
  id: 'salario',
  title: 'Salário',
  get monthNav() { return Boolean(TABS.find((t) => t.id === currentTab(TABS))?.monthNav); },

  render() {
    const active = currentTab(TABS);
    // Atalho "Lançar plantão" (ícone do app): abre a escala já com o dia de hoje
    if (active === 'plantoes' && routeParams().get('novo') && !store.ui.filters.shiftHint) {
      store.ui.filters.shiftHint = true;
      setTimeout(() => document.querySelector(`[data-action="shift:day"][data-date="${todayISO()}"]`)?.focus(), 200);
    }
    return html`
      ${tabsNav('salario', TABS, active)}
      ${TABS.find((t) => t.id === active).render()}`;
  },

  actions: { ...payslipActions, ...shiftActions, ...moreSalaryActions },

  onFilter(name, value, el) {
    if (name.startsWith('exit:')) onExitFilter(name, value, el);
  },
};
