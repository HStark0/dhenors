// =============================================================
// help.js — Ajuda dentro do app: glossário e dicas contextuais
// -------------------------------------------------------------
// • helpTip('dsr') desenha um botãozinho "?" ao lado de um termo;
//   ao tocar, abre a explicação curta.
// • Ajustes → Ajuda lista o glossário inteiro, com busca.
// • Dicas de primeira vez (hint): aparecem até você dispensar.
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';
import { openDialog } from './dialog.js';
import { store } from '../core/store.js';
import * as A from '../domain/actions.js';

export const GLOSSARY = {
  darf: { term: 'DARF (IR na venda de ações)', text: 'Guia para pagar o imposto sobre o lucro na venda de ações, FIIs e ETFs. Código 6015, vence no último dia útil do mês seguinte à venda. Ações são isentas quando as VENDAS do mês somam até R$ 20 mil; FIIs pagam 20% e ETFs 15% sobre o lucro, sem isenção.' },
  dietz: { term: 'Rentabilidade da carteira', text: 'Quanto a carteira rendeu descontando o dinheiro que você colocou ou tirou. O app usa o método de Dietz: ganho do mês ÷ (saldo inicial + metade dos aportes).' },
  competencia: { term: 'Competência', text: 'O mês TRABALHADO a que o salário se refere. Se você recebe no 5º dia útil de novembro o salário de outubro, a competência é outubro. Em Salário → Editar dá para dizer se o salário cai no mês seguinte.' },
  dsr: { term: 'DSR (descanso semanal remunerado)', text: 'Quem faz hora extra ou adicional noturno também recebe sobre os domingos e feriados do mês. O cálculo é: valor das horas ÷ dias úteis × domingos e feriados. O app calcula sozinho quando a linha de horas está marcada com "+ DSR".' },
  frase: { term: 'Frase secreta', text: 'Senha que criptografa os dados ANTES de irem para a nuvem. Só você sabe: nem o Supabase consegue ler. É diferente da senha da conta e NÃO pode ser recuperada — anote em lugar seguro.' },
  liquido: { term: 'Líquido × bruto', text: 'Bruto é o salário com todos os adicionais, antes dos descontos. Líquido é o que cai na conta: bruto − INSS − Imposto de Renda − descontos em folha (plano de saúde, consignado…).' },
  inss: { term: 'INSS progressivo', text: 'O INSS é calculado por faixas, como o IR: cada pedaço do salário paga uma alíquota (7,5%, 9%, 12%, 14%), até o teto. Por isso a alíquota "efetiva" é menor que a da faixa.' },
  simplificado: { term: 'Desconto simplificado', text: 'Na hora do IR na fonte, a empresa usa o que for melhor para você: as deduções legais (INSS, dependentes, pensão) ou um desconto fixo mensal. O app faz a mesma conta.' },
  fatura: { term: 'Fechamento e vencimento do cartão', text: 'No dia do FECHAMENTO a fatura é encerrada: compras a partir desse dia vão para a próxima. No VENCIMENTO você paga. O "melhor dia de compra" é o próprio dia do fechamento.' },
  reserva: { term: 'Reserva de emergência', text: 'Dinheiro guardado para imprevistos (perda de renda, saúde). O ideal é cobrir 6 meses de gastos (12, para autônomos), num investimento de liquidez diária. Toda conta já tem a Reserva de emergência (em Reservas), com alvo automático de 6 meses de gastos; guarde nela ou ligue o investimento onde o dinheiro está.' },
  saldoPrevisto: { term: 'Saldo do mês', text: 'Ganhos do mês − tudo que vence no mês (pago ou não). É quanto deve sobrar no fim do mês se tudo for pago. O 13º chega à parte e não entra aqui (mas entra na previsão dos 12 meses).' },
  salarioMes: { term: 'Salário do mês', text: 'O líquido da folha: salário base + adicionais, horas extras, plantões e DSR pagos pelo empregador − INSS, Imposto de Renda, consignado e outros descontos. Toque em "Bruto" para ver linha a linha. Se você conferiu o holerite, vale o valor conferido.' },
  ganhosMes: { term: 'Ganhos do mês', text: 'Tudo o que entra no mês: o salário (folha) + ganhos FORA da folha (freela, venda, Pix recebido, aluguel recebido…) + férias, PLR/benefícios em dinheiro e outros vínculos. Ganhos que se repetem podem ser lançados como "todo mês".' },
  ganhosFixos: { term: 'Ganhos fixos × variáveis', text: 'Fixos: o salário líquido (sem plantões e horas extras), outros vínculos e os ganhos fora da folha lançados como "todo mês". Variáveis: plantões e extras na folha, ganhos avulsos (freela, venda, Pix recebido), férias, PLR e outros benefícios em dinheiro.' },
  limiteParcelas: { term: 'Limite das parcelas', text: 'Quanto dos seus ganhos FIXOS vai para parcelas no mês (parcelamentos e compras parceladas no cartão). Escolha 10% (recomendado), 20% ou 30%. Dentro do limite = até 80% do teto escolhido; na média = entre 80% e 100% (encostando no teto); acima = passou do teto. Ganhos variáveis ficam de fora, porque podem não se repetir.' },
  reservaMensal: { term: 'Quanto guardar na reserva', text: 'Quanto dos seus ganhos FIXOS vai para a reserva de emergência no mês: 10% (padrão), 20% ou 30%. Conta o que entrou no mês nas metas e investimentos marcados como reserva (aportes − resgates). Dentro da reserva = atingiu o percentual; na média = de 80% a 100% dele; abaixo = menos de 80%.' },
  statusMes: { term: 'Folgado, apertado, não fecha', text: 'Para cada mês o app soma o que deve entrar (salário, 13º, férias, plantões, receitas recorrentes) e o que deve sair (recorrentes, parcelas, faturas, IPVA e outras anuais, e o gasto do dia a dia estimado pela mediana dos últimos 3 meses). Não fecha = sobra negativa. Apertado = sobra menor que a folga mínima (10% dos ganhos; muda em Ajustes → Alertas e dicas). Toque num mês para ver o que pesa nele.' },
  pesoFuturo: { term: 'Gastos que pesam no futuro', text: 'Lançamentos deste mês que continuam nos próximos: parcelas que ainda faltam, compras parceladas no cartão (e compras que caem na fatura seguinte), recorrentes que começaram agora e dívidas com pagamento mensal. Mostra quanto pesa em cada mês e até quando.' },
  dicas: { term: 'Dicas em três níveis', text: 'Simples: um fato do mês (ex.: a luz veio 40% acima da média). Médias: uma ação que resolve um mês (antecipar uma parcela, adiar uma conta, cancelar uma assinatura). Para planejar: combinam salário, 13º, férias, plantões e parcelas — quanto guardar nos meses de folga, quantos plantões fecham um mês, quanto cabe de parcela nova. Todas usam os seus números.' },
  saldoReal: { term: 'Saldo real × previsto', text: 'O previsto é o que o app calcula a partir dos lançamentos. O real é o que aparece no app do banco. A diferença mostra gastos que não foram lançados (ou lançados a mais).' },
  conciliacao: { term: 'Conciliação', text: 'Ao importar o extrato, o app procura as contas que você já lançou com o mesmo valor e data próxima e as marca como pagas, em vez de criar gastos repetidos.' },
  envelope: { term: 'Envelopes', text: 'Método de separar o dinheiro do mês em "potes" (mercado, lazer…) logo que o salário cai. Os gastos de cada categoria saem do seu pote; o que sobra pode passar para o mês seguinte.' },
  regra503020: { term: 'Regra 50/30/20', text: '50% da renda para necessidades (moradia, mercado, saúde), 30% para desejos (lazer, compras) e 20% para poupar/investir. Você ajusta os percentuais e escolhe o grupo de cada categoria.' },
  cdi: { term: 'CDI e Selic', text: 'Taxas básicas de juros do Brasil. A maioria das aplicações de renda fixa rende um percentual do CDI (ex.: "110% do CDI"). O app busca os valores atuais no Banco Central.' },
  ir: { term: 'IR regressivo (renda fixa)', text: 'O imposto sobre o rendimento cai com o tempo: 22,5% até 6 meses, 20% até 1 ano, 17,5% até 2 anos e 15% depois disso. LCI, LCA e poupança são isentas.' },
  pgbl: { term: 'PGBL × VGBL', text: 'No PGBL você deduz até 12% da renda tributável no IR (se faz a declaração completa), mas paga IR sobre o valor total no resgate. No VGBL não deduz, e o IR é só sobre o rendimento.' },
  plr: { term: 'PLR', text: 'Participação nos Lucros e Resultados. Tem tabela de IR própria e exclusiva (não soma com o salário).' },
  fgts: { term: 'FGTS', text: 'A empresa deposita 8% do seu bruto todo mês numa conta da Caixa em seu nome. Não sai do seu salário. Rende 3% ao ano + TR + distribuição de lucros. Saca na demissão sem justa causa, compra da casa própria, saque-aniversário etc.' },
  rescisao: { term: 'Rescisão', text: 'Valores pagos ao sair da empresa: saldo de salário, aviso prévio, férias vencidas e proporcionais com 1/3, 13º proporcional e, na demissão sem justa causa, multa de 40% do FGTS.' },
};

/** Botão "?" ao lado de um termo. */
export function helpTip(id, label = '') {
  const g = GLOSSARY[id];
  if (!g) return '';
  return html`<button type="button" class="help-tip" data-action="help:open" data-id="${id}" aria-label="O que é ${label || g.term}?" title="O que é ${g.term}?">${icon('circle-help', 'icon--xs')}</button>`;
}

export function openHelp(id) {
  const g = GLOSSARY[id];
  if (!g) return;
  openDialog({ title: g.term, size: 'sm', body: html`<p class="dialog__text">${g.text}</p><p class="field__hint"><a href="#/ajustes?aba=ajuda">Ver todo o glossário</a></p>` });
}

/** Dica de primeira vez (some quando dispensada). */
export function hint(id, text) {
  if ((store.data.settings.help?.dismissed || []).includes(id)) return '';
  return html`
    <div class="hint" role="note">
      ${icon('lightbulb')}
      <p>${text}</p>
      <button type="button" class="icon-btn icon-btn--sm" data-action="help:dismiss" data-id="${id}" aria-label="Dispensar dica">${icon('x')}</button>
    </div>`;
}

export const helpActions = {
  'help:open': (el) => openHelp(el.dataset.id),
  'help:dismiss': (el) => A.dismissHelp(el.dataset.id),
};
