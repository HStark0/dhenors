// =============================================================
// changelog.js — Novidades (tela "Novidades")
// -------------------------------------------------------------
// Mantido junto com o CHANGELOG.md (para quem lê o código). A tela
// abre sozinha uma vez depois que o app atualiza.
// =============================================================

export const CHANGELOG = [
  {
    version: '3.3.1',
    date: '2026-10-16',
    title: 'Nuvem mais resistente',
    groups: [
      { title: 'Correções', items: [
        'Nuvem: o erro "Uma parte dos dados da nuvem não foi encontrada" não trava mais o desbloqueio. As partes que sumiram são recuperadas do histórico ou deste aparelho e reenviadas.',
      ] },
      { title: 'Mudanças', items: [
        'Nuvem: cada pessoa cria a própria conta pelo app e a confirma pelo e-mail que o Supabase envia.',
      ] },
      { title: 'Removido', items: [
        'Open Finance (Pluggy): a opção saiu de Ajustes → Dados. Para trazer transações do banco, use a importação de extrato (OFX, CSV ou PDF da fatura).',
      ] },
    ],
  },
  {
    version: '3.3.0',
    date: '2026-10-16',
    title: 'Mais confiável e mais seguro',
    groups: [
      { title: 'Correções', items: [
        'Nuvem: a sincronização não sobrescreve nem perde mais alterações feitas em outro aparelho.',
        'IR na venda de ações: preço médio, isenção mensal e compensação de prejuízo revisados.',
        'Salário: cálculos da folha e das férias revisados.',
        'Importação de extratos, faturas e holerites mais robusta, sem lançamentos duplicados.',
        'Esc fecha diálogos e menus, desfazer mais confiável, melhor foco e leitura de tela.',
        'Telas com muitos lançamentos ficaram mais rápidas.',
        'Offline: a página de apresentação, a política de privacidade e as Novidades voltam a abrir; a primeira visita não recarrega mais sozinha.',
      ] },
      { title: 'Segurança', items: [
        'Arquivos recebidos pelo "Compartilhar" ficam no aparelho no máximo 24 horas se não forem usados.',
        'Atualizações não misturam arquivos de versões diferentes.',
      ] },
    ],
  },
  {
    version: '3.2.0',
    date: '2026-10-13',
    title: 'Análise e relatórios',
    groups: [
      { title: 'Análise', items: [
        'Relatório do mês em PDF, comparação de períodos e alerta de gastos fora do comum.',
        'Retrospectiva do ano e histórico da saúde financeira.',
      ] },
      { title: 'Por dentro', items: [
        'Testes no navegador a cada publicação, política de privacidade e de segurança.',
      ] },
    ],
  },
  {
    version: '3.1.0',
    date: '2026-09-21',
    title: 'Visual novo',
    groups: [
      { title: 'Visual', items: [
        'Visual limpo e nativo: superfícies neutras, tipografia clara, vidro nas barras e animações suaves. A cor aparece só onde comunica: verde é positivo, vermelho é negativo, laranja pede atenção e azul é neutro.',
        'Tema claro, escuro e OLED, cor de destaque e densidade compacta.',
      ] },
      { title: 'Uso', items: [
        'Painel e barra do celular configuráveis, desfazer (Ctrl+Z), deslizar para pagar, ações em lote e modo discreto.',
        'Comando de voz, atalhos do ícone, "Compartilhar" de outros apps para o Dhenors e puxar para atualizar.',
        'Acessibilidade: foco visível, alvos de toque maiores e anúncios para leitores de tela.',
      ] },
    ],
  },
  {
    version: '3.0.0',
    date: '2026-08-31',
    title: 'Nuvem',
    groups: [
      { title: 'Nuvem', items: [
        'Nuvem com criptografia de ponta a ponta, sincronização em tempo real, conflitos resolvidos por você e histórico de versões dos dados.',
        'Aparelhos conectados, "lembrar neste aparelho" e troca da frase secreta.',
        'Lembretes com o app fechado (push), sem valores nem nomes.',
      ] },
    ],
  },
  {
    version: '2.2.0',
    date: '2026-08-03',
    title: 'Assinaturas e dívidas',
    groups: [
      { title: 'Dinheiro', items: [
        'Assinaturas, reajuste automático pelo IGP-M/IPCA e contas variáveis pela média.',
        'Quem me deve, dívidas com simulação de quitação (bola de neve × avalanche), envelopes e lista de desejos.',
        'Receitas com tipo (reembolso, venda, presente, rendimento), divisão de um gasto entre categorias e etiquetas (#viagem-natal).',
      ] },
    ],
  },
  {
    version: '2.1.0',
    date: '2026-07-13',
    title: 'Salário completo',
    groups: [
      { title: 'Salário', items: [
        '13º com a média das variáveis (horas extras, noturno, sobreaviso e plantões), 1ª parcela de 50% e 2ª com INSS e IR sobre o total.',
        'Sobreaviso de 1/3 da hora ativo todo mês, com as horas de cada mês informadas à parte; aviso de competência quando o salário cai no mês seguinte.',
        'Previsão do IR anual, rescisão, FGTS estimado, PLR/abono/VA-VR, outros vínculos de trabalho e linha do tempo da carreira.',
      ] },
    ],
  },
  {
    version: '2.0.0',
    date: '2026-06-22',
    title: 'Investimentos',
    groups: [
      { title: 'Investimentos', items: [
        'CDI/Selic/IPCA do Banco Central, cotações de ações e FIIs, proventos, comparação com CDI/IPCA/Ibovespa.',
        'IR na venda de ações, reserva de emergência, independência financeira e PGBL × VGBL.',
      ] },
    ],
  },
  {
    version: '1.1.0',
    date: '2026-05-25',
    title: 'Planejamento',
    groups: [
      { title: 'Planejamento', items: [
        'Saúde financeira, fluxo de caixa dia a dia até o salário, visão de 12 meses e "Posso comprar?".',
        'Metas, cenários salvos, regra 50/30/20 e agenda.',
      ] },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-05-04',
    title: 'Dhenors 1.0',
    groups: [
      { title: 'Importação', items: [
        'Importação de extratos com conciliação, regras aprendidas, busca com filtros e buscas salvas.',
        'Importação da fatura do cartão em PDF.',
      ] },
      { title: 'Comprovantes', items: [
        'Fotos de comprovantes, leitura de boleto e Pix Copia e Cola.',
      ] },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-04-06',
    title: 'Segurança',
    groups: [
      { title: 'Segurança', items: [
        'PIN ou senha, desbloqueio por biometria e espera crescente após erros.',
        'Backup criptografado com senha.',
      ] },
      { title: 'Uso', items: [
        'Funciona offline e pode ser instalado como app.',
      ] },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-03-09',
    title: 'Salário',
    groups: [
      { title: 'Salário', items: [
        'Salário bruto com INSS e IR calculados, importação e conferência do holerite em PDF, verba a verba.',
        'Escala de plantões que gera as rendas extras sozinha.',
      ] },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-02-09',
    title: 'Cartões e carteiras',
    groups: [
      { title: 'Dinheiro', items: [
        'Cartão de crédito com fechamento e vencimento: compras e parcelas na fatura certa e limite usado.',
        'Contas e carteiras com saldo real, transferências e conferência com o saldo do banco.',
      ] },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-01-12',
    title: 'Primeira versão',
    groups: [
      { title: 'Dinheiro', items: [
        'Contas avulsas, recorrentes (semanais a anuais) e parceladas, com status de pago, vence logo e atrasada.',
        'Painel do mês e categorias. Tudo fica no aparelho, sem cadastro.',
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
