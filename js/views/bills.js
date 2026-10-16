// =============================================================
// Contas — tudo o que você paga, numa tela com abas
// -------------------------------------------------------------
// Mês · Recorrentes · Parcelamentos · Assinaturas · A receber · Dívidas
// (antes eram telas separadas no menu: Contas, Recorrentes e
// Parcelamentos viraram abas daqui).
// =============================================================

import { html } from '../ui/dom.js';
import { tabsNav, currentTab } from '../ui/tabs.js';
import { store } from '../core/store.js';
import { renderMonth, monthActions, onMonthFilter } from './bills/month.js';
import { renderRecurring, recurringActions } from './bills/recurring.js';
import { renderInstallments, installmentActions } from './bills/installments.js';
import { renderSubscriptions, renderReceivables, renderDebts, moreActions, onDebtFilter } from './bills/more.js';

const TABS = [
  { id: 'mes', label: 'Do mês', icon: 'receipt', render: renderMonth, monthNav: true },
  { id: 'recorrentes', label: 'Recorrentes', icon: 'repeat', render: renderRecurring },
  { id: 'parcelas', label: 'Parcelamentos', icon: 'calendar-range', render: renderInstallments },
  { id: 'assinaturas', label: 'Assinaturas', icon: 'tv', render: renderSubscriptions },
  { id: 'receber', label: 'A receber', icon: 'hand-coins', render: renderReceivables },
  { id: 'dividas', label: 'Dívidas', icon: 'landmark', render: renderDebts },
];

export default {
  id: 'contas',
  title: 'Contas',
  get monthNav() { return currentTab(TABS) === 'mes'; },

  render() {
    const active = currentTab(TABS);
    const tab = TABS.find((t) => t.id === active);
    const d = store.data;
    const counts = {
      receber: (d.receivables || []).filter((r) => !r.receivedAt).length || '',
      dividas: (d.debts || []).length || '',
    };
    return html`
      ${tabsNav('contas', TABS.map((t) => ({ ...t, badge: counts[t.id] })), active)}
      ${tab.render()}`;
  },

  actions: { ...monthActions, ...recurringActions, ...installmentActions, ...moreActions },

  onFilter(name, value, el) {
    if (name === 'debtExtra') return onDebtFilter(name, value, el);
    return onMonthFilter(name, value, el);
  },
};
