// =============================================================
// changelog.js — Novidades (tela "Novidades")
// -------------------------------------------------------------
// Mantido junto com o CHANGELOG.md (para quem lê o código). A tela
// abre sozinha uma vez depois que o app atualiza.
// =============================================================

export const CHANGELOG = [
  {
    version: '1.0.0',
    date: '2026-10-15',
    title: 'Dhenors 1.0',
    groups: [
      { title: 'Dinheiro', items: [
        'Contas avulsas, recorrentes (semanais a anuais) e parceladas, com status de pago, vence logo e atrasada.',
        'Cartão de crédito com fechamento e vencimento: compras e parcelas na fatura certa, limite usado e importação da fatura em PDF.',
        'Contas e carteiras com saldo real, transferências e conferência com o saldo do banco.',
        'Receitas com tipo (reembolso, venda, presente, rendimento), divisão de um gasto entre categorias e etiquetas (#viagem-natal).',
        'Fotos de comprovantes, leitura de boleto e Pix Copia e Cola.',
        'Assinaturas, reajuste automático pelo IGP-M/IPCA e contas variáveis pela média.',
        'Quem me deve, dívidas com simulação de quitação (bola de neve × avalanche), envelopes e lista de desejos.',
        'Importação de extratos com conciliação, regras aprendidas, busca com filtros e buscas salvas.',
      ] },
      { title: 'Salário', items: [
        'Salário bruto com INSS e IR calculados, importação e conferência do holerite em PDF, verba a verba.',
        'Escala de plantões que gera as rendas extras sozinha.',
        'Previsão do IR anual, rescisão, FGTS estimado, PLR/abono/VA-VR, outros vínculos de trabalho e linha do tempo da carreira.',
      ] },
      { title: 'Investimentos', items: [
        'CDI/Selic/IPCA do Banco Central, cotações de ações e FIIs, proventos, comparação com CDI/IPCA/Ibovespa.',
        'IR na venda de ações, reserva de emergência, independência financeira e PGBL × VGBL.',
      ] },
      { title: 'Planejamento e análise', items: [
        'Saúde financeira com histórico, fluxo de caixa dia a dia até o salário, visão de 12 meses e "Posso comprar?".',
        'Metas, cenários salvos, regra 50/30/20, agenda, relatório do mês em PDF e retrospectiva do ano.',
      ] },
      { title: 'Visual e uso', items: [
        'Visual limpo e nativo: superfícies neutras, tipografia clara, vidro nas barras e animações suaves. A cor aparece só onde comunica: verde é positivo, vermelho é negativo, laranja pede atenção e azul é neutro.',
        'Painel e barra do celular configuráveis, desfazer (Ctrl+Z), deslizar para pagar, modo discreto, tema claro, escuro e OLED.',
        'Funciona offline e pode ser instalado como app.',
      ] },
      { title: 'Segurança e nuvem', items: [
        'PIN ou senha, desbloqueio por biometria e espera crescente após erros.',
        'Backup criptografado com senha, "lembrar neste aparelho" e aparelhos conectados.',
        'Nuvem com criptografia de ponta a ponta, sincronização em tempo real, conflitos resolvidos por você e histórico de versões dos dados.',
      ] },
    ],
  },
];

/** Compara versões: "1.1.0" > "1.0.0". */
export function newerThan(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}
