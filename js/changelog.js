// =============================================================
// changelog.js — Novidades (tela "Novidades")
// -------------------------------------------------------------
// Mantido junto com o CHANGELOG.md (para quem lê o código). A tela
// abre sozinha uma vez depois que o app atualiza. Da 1.0.0
// (7 de dezembro de 2025) até a versão atual, da mais nova para a
// mais antiga.
// =============================================================

export const CHANGELOG = [
  {
    version: '3.5.0',
    date: '2026-10-18',
    title: 'Seus dados só na nuvem — e uma tela de entrada nova',
    groups: [
      { title: 'Novidades', items: [
        'Tela de entrada nova, em duas etapas (conta e frase secreta), com os mesmos passos de antes: entrar, criar conta e recuperar a senha.',
        'Nada fica salvo no navegador: os dados abrem da nuvem, na memória, e cada alteração sobe na hora, criptografada. No aparelho fica só o login, pelo tempo que você escolher.',
        'Sem login, dá para ver o app inteiro com dados de exemplo. Para lançar ou alterar, é só entrar.',
        'Fotos de comprovantes vão para a nuvem, cifradas, e abrem em qualquer aparelho.',
        'Fale conosco: mande feedback, sugestão ou reclamação (com anexo e nota) direto para quem desenvolve o app, em Ajustes → Fale conosco. A resposta chega no seu e-mail.',
        'O app abre sempre na versão mais nova, sem nada guardado em cache.',
      ] },
      { title: 'Melhorias', items: [
        'Tudo encaixado em qualquer tela, do celular pequeno ao monitor grande, em pé ou deitado: nada sai do card ou da tela, números grandes se ajustam, gráficos sem rótulos encavalados e nenhum zoom indesejado ao tocar nos campos.',
      ] },
      { title: 'Correções', items: [
        'Os dados antigos do aparelho só saem do navegador depois que a nuvem confirma que chegaram.',
        'Problemas passageiros do servidor e duas abas abertas não tiram mais você da conta; o que não subiu é guardado e juntado com a nuvem.',
        'Cálculos revisados: gasto por dia, faturas com assinaturas, limite do cartão, rescisão, FGTS, DARF, reajustes, "Posso comprar?" e IRPF.',
        'Várias telas mais seguras: erros aparecem, a câmera desliga ao fechar, a seleção em lote age só no que está na tela e itens arquivados podem ser reabertos.',
      ] },
      { title: 'O que saiu', items: [
        'PIN, senha do app e biometria: protegiam os dados guardados no aparelho, que não existem mais. Num aparelho compartilhado, escolha "Só até fechar o app" ao entrar, ou saia da conta.',
        'Uso sem internet e o "Compartilhar" do celular para o Dhenors.',
        'Os dados que estavam neste aparelho sobem para a sua conta no primeiro login e depois saem do navegador.',
      ] },
    ],
  },
  {
    version: '3.4.0',
    date: '2026-10-16',
    title: 'Salário, ganhos e gastos — e os meses que não fecham',
    groups: [
      { title: 'Novidades', items: [
        'Painel: "Seu dinheiro no mês" no topo, com Salário do mês (bruto, adições e descontos), Ganhos do mês (salário + o que veio de fora da folha) e Gasto no mês (pago e o que falta), e o saldo do mês com a situação: folgado, apertado ou não fecha.',
        'Próximos 12 meses: cada mês marcado como folgado, apertado ou não fecha. Toque num mês para ver o que pesa nele e como resolver. Também na aba 12 meses, na Agenda e na Análise.',
        'Ganhos extras que se repetem (aluguel recebido, pensão, freela fixo): em Nova receita → "Repete todo mês".',
        'Selos nas contas: gasto exagerado, fora do comum e que pesa no futuro (até quando).',
        'Dicas em três níveis, com os seus números: simples, médias (antecipar uma parcela, adiar uma conta) e para planejar (guardar nos meses de folga, 13º, plantões, quanto cabe de parcela nova).',
        'Prévia ao lançar parcelamento, compra no cartão, recorrente ou conta grande: "Com esta compra, junho fica negativo em R$ 230".',
        'Ajustes → Alertas e dicas: escolha o que é mês apertado e gasto exagerado.',
        'Lembrete semanal (sem valores) quando algum dos próximos meses não fecha.',
      ] },
      { title: 'Mudanças', items: [
        'Abas e opções com uma pílula que desliza até a escolha; trocar de aba ou de mês desliza o conteúdo para o lado certo; janelas fecham com animação.',
        'O app se atualiza sozinho, sem o aviso de "Nova versão". A atualização entra no primeiro momento em que você não está digitando.',
      ] },
      { title: 'Correções', items: [
        '"Posso comprar?" e o simulador agora contam 13º, férias e PLR, como a aba 12 meses.',
        'Uma compra grande à vista não some mais dentro da estimativa do gasto do dia a dia.',
        '"Nova assinatura" abria "Nova subcategoria"; o lápis do salário no Painel editava o mês errado.',
        'Modo exemplo: a cópia dos seus dados agora fica cifrada com o PIN e é apagada junto com os dados.',
        'Cartão: estorno maior que as compras vira crédito na fatura seguinte; fechamento certo na Agenda.',
        'Fechar o mês, 13º adiantado nas férias e saldo da conta-salário revisados.',
        'Janelas não salvam duas vezes, e o "Desfazer" funciona com uma janela aberta.',
        'Modo discreto: os valores viram um olho cortado com pontos (sem desfoque) e nenhum valor no meio dos textos fica à mostra.',
        'Visual mais limpo: sem faixa escura ao rolar as janelas, sem botão flutuante sobre os cards e janelas na largura toda do celular.',
      ] },
    ],
  },
  {
    version: '3.3.1',
    date: '2026-10-12',
    title: 'Nuvem mais resistente',
    groups: [
      { title: 'Melhorias', items: [
        'Nuvem: cada pessoa cria a própria conta pelo app e a confirma pelo e-mail que o Supabase envia.',
      ] },
      { title: 'Correções', items: [
        'Nuvem: o erro "Uma parte dos dados da nuvem não foi encontrada" não trava mais a abertura. Partes apagadas por engano (a limpeza removia partes ainda em uso) são recuperadas do histórico de versões ou do aparelho e reenviadas. A limpeza não apaga nada quando não consegue ler uma versão do histórico.',
      ] },
      { title: 'Removido', items: [
        'Open Finance (Pluggy): saiu de Ajustes → Dados. Para trazer transações do banco, use a importação de extrato (OFX, CSV ou PDF da fatura).',
      ] },
    ],
  },
  {
    version: '3.3.0',
    date: '2026-10-09',
    title: 'Mais confiável e mais seguro',
    groups: [
      { title: 'Correções', items: [
        'Nuvem: casos em que a sincronização podia sobrescrever ou perder alterações feitas em outro aparelho.',
        'Investimentos: IR na venda de ações (preço médio, isenção mensal e compensação de prejuízo).',
        'Salário: cálculos da folha e das férias (1/3, médias e descontos).',
        'Importação: extratos, faturas e holerites com formatos que antes falhavam ou duplicavam lançamentos.',
        'Acessibilidade e uso: Esc fecha janelas e menus de forma consistente, desfazer mais confiável, foco e anúncios para leitores de tela.',
        'Desempenho: telas com muitos lançamentos abrem e atualizam mais rápido.',
        'Instalação: a página de apresentação, a política de privacidade e o arquivo único voltam a abrir depois de instalar o app; a instalação não mistura arquivos de versões diferentes.',
      ] },
      { title: 'Segurança', items: [
        'Arquivos recebidos pelo "Compartilhar" ficam no aparelho no máximo 24 horas se não forem usados.',
        'Ações do GitHub fixadas, permissões mínimas na publicação e servidor de desenvolvimento só em 127.0.0.1.',
      ] },
    ],
  },
  {
    version: '3.2.0',
    date: '2026-10-04',
    title: 'Análise completa',
    groups: [
      { title: 'Novidades', items: [
        'Relatório do mês em PDF, pronto para imprimir ou guardar.',
        'Gastos fora do padrão (anomalias) destacados na Análise.',
        'Comparar períodos: dois meses ou intervalos lado a lado, categoria por categoria.',
        'Retrospectiva do ano e histórico da saúde financeira mês a mês.',
      ] },
      { title: 'Melhorias', items: [
        'Baixar dados: contracheques e resumo financeiro em planilha (CSV) e holerite em PDF.',
      ] },
    ],
  },
  {
    version: '3.1.0',
    date: '2026-09-20',
    title: 'Visual novo e mais jeitos de usar',
    groups: [
      { title: 'Novidades', items: [
        'Visual novo: superfícies neutras, elevação sutil, vidro nas barras e tipografia com hierarquia clara. A cor só comunica significado (verde = positivo, vermelho = negativo, laranja = atenção, azul = neutro). Fonte Inter com números alinhados e ícones por categoria.',
        'Aparência: tema claro, escuro ou preto (OLED), cor de destaque, densidade compacta e efeitos calmos ou desligados.',
        'Painel configurável (reordenar, esconder e fixar cards) e barra do celular com os atalhos que você escolher.',
        'Gestos: deslizar a conta para pagar, puxar para atualizar; Ctrl+Z para desfazer.',
        'Modo discreto para usar em público, lançamento por voz e "Compartilhar" de outros apps para o Dhenors.',
      ] },
      { title: 'Melhorias', items: [
        'Acessibilidade: foco visível, alvos de toque de 44 px, anúncios para leitores de tela e tabelas alternativas para os gráficos.',
        'Ações em lote e listas agrupadas por data.',
      ] },
    ],
  },
  {
    version: '3.0.0',
    date: '2026-09-06',
    title: 'Nuvem criptografada',
    groups: [
      { title: 'Novidades', items: [
        'Nuvem (Supabase) com criptografia de ponta a ponta: os dados são cifrados no aparelho com a sua frase secreta antes de subir.',
        'Sincronização em blocos e em tempo real: só o que mudou é enviado, e os outros aparelhos atualizam sozinhos.',
        'Conflitos resolvidos item a item, campo a campo, sem perder nada.',
        'Histórico de versões para voltar os dados a um momento anterior, aparelhos conectados (desconectar à distância) e troca da frase secreta.',
        'Lembretes push com o app fechado, sem valores nem nomes.',
        'Open Finance (Pluggy) opcional.',
      ] },
      { title: 'Melhorias', items: [
        'Aviso quando o projeto gratuito do Supabase está perto de pausar por falta de uso.',
      ] },
    ],
  },
  {
    version: '2.9.0',
    date: '2026-08-23',
    title: 'Assinaturas, dívidas e valores a receber',
    groups: [
      { title: 'Novidades', items: [
        'Assinaturas (streaming, apps, academia) com aviso de renovação e custo por ano.',
        'Reajuste automático das recorrentes pelo IGP-M ou IPCA no mês de aniversário.',
        'Contas variáveis (luz, água, gás) estimadas pela média dos últimos meses.',
        'Valores a receber ("alguém me deve"), com recebimento parcial.',
        'Dívidas com simulação de quitação (bola de neve × avalanche) e quitação antecipada de parcelamentos.',
      ] },
      { title: 'Melhorias', items: [
        'Fechar o mês: congela os valores do mês e marca como fechado no histórico.',
      ] },
    ],
  },
  {
    version: '2.8.0',
    date: '2026-08-09',
    title: 'IR anual, rescisão e benefícios',
    groups: [
      { title: 'Novidades', items: [
        'Previsão do IR anual: completa × simplificada, quanto restituir ou pagar.',
        'Rescisão e FGTS: simulação por tipo de saída, saldo do FGTS e multa.',
        'Benefícios: PLR (tabela própria), abono salarial, VA/VR à parte do dinheiro na conta.',
        'Outros vínculos (segundo emprego, CLT + PJ) e linha do tempo da carreira com o ganho real descontando a inflação.',
      ] },
    ],
  },
  {
    version: '2.7.0',
    date: '2026-07-26',
    title: '13º, férias e sobreaviso',
    groups: [
      { title: 'Novidades', items: [
        '13º salário com a média das variáveis habituais (horas extras, noturno, sobreaviso, plantões na folha): 1ª parcela até 30/11 e 2ª = total − 1ª − INSS − IR.',
        'Férias com 1/3, médias e adiantamento do 13º.',
        'Sobreaviso (1/3 da hora) com as horas cumpridas em cada mês.',
        'Salário pago no mês seguinte: competência trabalhada separada da data de pagamento.',
      ] },
      { title: 'Melhorias', items: [
        'Descontos do salário sempre em vermelho, linha a linha, no contracheque.',
      ] },
    ],
  },
  {
    version: '2.6.0',
    date: '2026-07-12',
    title: 'Investimentos: IR e comparações',
    groups: [
      { title: 'Novidades', items: [
        'IR na venda de ações: preço médio, isenção de R$ 20 mil por mês, compensação de prejuízo e DARF.',
        'Comparar a carteira com CDI, IPCA e Ibovespa.',
        'Independência financeira: quanto falta e em quanto tempo.',
        'PGBL × VGBL para escolher a previdência certa.',
      ] },
      { title: 'Melhorias', items: [
        'Metas ligadas a investimentos: o saldo investido conta como guardado.',
      ] },
    ],
  },
  {
    version: '2.5.0',
    date: '2026-06-28',
    title: 'Investimentos',
    groups: [
      { title: 'Novidades', items: [
        'Carteira de investimentos: renda fixa que rende sozinha, ações, FIIs, ETFs, cripto e previdência, com aportes e resgates.',
        'Taxas do Banco Central (CDI, Selic, IPCA, IGP-M) atualizadas com um toque.',
        'Cotações (brapi) e proventos com histórico.',
        'IR regressivo da renda fixa, alocação e carteira ideal.',
      ] },
    ],
  },
  {
    version: '2.4.0',
    date: '2026-06-14',
    title: 'Metas, agenda e saúde financeira',
    groups: [
      { title: 'Novidades', items: [
        'Metas com aportes e a reserva de emergência (o ideal de 6 meses de gastos).',
        'Lista de desejos com preço-alvo, avisando quando o preço chega lá.',
        'Saúde financeira: nota de 0 a 100, o que pesa nela e como melhorar.',
        'Agenda do mês com salário, contas, plantões e faturas, e exportação para o calendário do celular (.ics).',
        'Envelopes, regra 50/30/20 e meta de gastos mensal.',
      ] },
      { title: 'Melhorias', items: [
        'Lembretes de vencimento ao abrir o app: um resumo por dia, por semana ou um aviso por conta.',
      ] },
    ],
  },
  {
    version: '2.3.0',
    date: '2026-05-31',
    title: 'Planejamento',
    groups: [
      { title: 'Novidades', items: [
        'Fluxo de caixa dia a dia até o próximo salário.',
        'Visão de 12 meses: o que entra e o que sai em cada mês, com 13º, férias e despesas anuais.',
        '"Posso comprar?": à vista ou parcelado, com o efeito nos próximos meses.',
        'Simulador com cenários salvos e comparação lado a lado.',
      ] },
      { title: 'Melhorias', items: [
        'Painel mostra quanto dá para gastar por dia até o salário.',
      ] },
    ],
  },
  {
    version: '2.2.0',
    date: '2026-05-17',
    title: 'Busca e lançamento rápido',
    groups: [
      { title: 'Novidades', items: [
        'Busca com filtros (período, categoria, valor, etiqueta) e buscas salvas.',
        'Ctrl+K: telas, ações e lançamentos num só lugar.',
        'Lançamento em linguagem natural: "mercado 120 ontem", "luz 180 todo dia 20", "tv 2400 em 10x".',
        'Etiquetas (#viagem) e divisão de um gasto entre categorias.',
      ] },
      { title: 'Melhorias', items: [
        'Atalhos de teclado: N (novo), / (buscar) e ↑ ↓ nas listas.',
      ] },
    ],
  },
  {
    version: '2.1.0',
    date: '2026-05-03',
    title: 'Fatura em PDF, anexos e boletos',
    groups: [
      { title: 'Novidades', items: [
        'Fatura do cartão em PDF: as compras são lidas do arquivo e entram na fatura certa, parceladas com a parcela correta.',
        'Anexos: foto do comprovante ou do boleto em cada conta.',
        'Boleto e Pix: leitura pela câmera (código de barras e QR Code) ou colando a linha digitável / Pix Copia e Cola.',
      ] },
    ],
  },
  {
    version: '2.0.0',
    date: '2026-04-19',
    title: 'Importação de extratos',
    groups: [
      { title: 'Novidades', items: [
        'Importar extrato OFX ou CSV, com revisão antes de salvar.',
        'Conciliação: saídas que batem com uma conta em aberto (mesmo valor, até 7 dias) marcam essa conta como paga, sem duplicar.',
        'Regras de categoria aprendidas com você ("Sempre colocar UBER em Transporte?").',
      ] },
      { title: 'Melhorias', items: [
        'Arrastar e soltar arquivos na tela de importação; o arquivo é lido no próprio aparelho.',
      ] },
    ],
  },
  {
    version: '1.8.0',
    date: '2026-04-05',
    title: 'Instalável',
    groups: [
      { title: 'Novidades', items: [
        'Instalar como app, com ícone próprio e atalhos no ícone (Novo gasto, Nova conta, Plantão).',
        'Uso sem internet depois da primeira visita.',
        'Biometria (digital ou rosto) para abrir, bloqueio automático e espera crescente após tentativas erradas.',
      ] },
      { title: 'Melhorias', items: [
        'Proteção mais forte da senha (600 mil iterações), com os dados antigos regravados sozinhos.',
      ] },
    ],
  },
  {
    version: '1.7.0',
    date: '2026-03-22',
    title: 'Backup e proteção',
    groups: [
      { title: 'Novidades', items: [
        'Backup em arquivo .json e restauração.',
        'Backup protegido com senha (AES-256).',
        'PIN ou senha para abrir o app, com os dados cifrados.',
      ] },
      { title: 'Melhorias', items: [
        'Lembrete de backup no Painel.',
      ] },
    ],
  },
  {
    version: '1.6.0',
    date: '2026-03-08',
    title: 'Plantões e rendas extras',
    groups: [
      { title: 'Novidades', items: [
        'Escala de plantões: marque os dias no calendário, com valor por tipo (12 h, 24 h, noturno, fim de semana).',
        'Rendas extras fora da folha (freela, venda, reembolso).',
      ] },
      { title: 'Melhorias', items: [
        'Plantões pagos na folha entram no salário do mês certo.',
      ] },
    ],
  },
  {
    version: '1.5.0',
    date: '2026-02-22',
    title: 'Holerite',
    groups: [
      { title: 'Novidades', items: [
        'Importar o holerite em PDF e conferir verba a verba com o cálculo do app.',
        'Horas extras com DSR automático e consignado com controle de parcelas.',
        'Histórico do salário: reajustes com data, sem mudar os meses anteriores.',
      ] },
      { title: 'Melhorias', items: [
        'Aviso quando ainda faltam as tabelas de INSS e IR de um ano.',
      ] },
    ],
  },
  {
    version: '1.4.0',
    date: '2026-02-08',
    title: 'Salário bruto → líquido',
    groups: [
      { title: 'Novidades', items: [
        'Salário bruto com INSS por faixa e IR (desconto simplificado, dependentes) pelas tabelas oficiais de cada ano.',
        'Dia do pagamento: dia fixo ou 5º dia útil, considerando os feriados nacionais.',
        'Adicionais e descontos fixos em folha (insalubridade, noturno, plano de saúde).',
      ] },
      { title: 'Melhorias', items: [
        'Painel mostra o salário do mês e quanto dele já está comprometido.',
      ] },
    ],
  },
  {
    version: '1.3.0',
    date: '2026-01-25',
    title: 'Contas bancárias e carteiras',
    groups: [
      { title: 'Novidades', items: [
        'Contas bancárias e carteiras com saldo inicial e saldo atual calculado.',
        'Transferências entre contas, sem contar como gasto.',
        'Conferência com o saldo do banco: o app mostra a diferença e ajusta.',
      ] },
      { title: 'Melhorias', items: [
        'Cada pagamento indica de qual conta saiu o dinheiro.',
      ] },
    ],
  },
  {
    version: '1.2.0',
    date: '2026-01-11',
    title: 'Cartão de crédito',
    groups: [
      { title: 'Novidades', items: [
        'Cartões com dia de fechamento e de vencimento: cada compra cai na fatura certa.',
        'Compras parceladas no cartão, distribuídas nas faturas seguintes.',
        'Fatura do mês vira uma conta a pagar, com a lista de compras.',
        'Limite usado e disponível de cada cartão.',
      ] },
      { title: 'Melhorias', items: [
        'Painel separa contas avulsas, recorrentes, parcelas e faturas.',
      ] },
    ],
  },
  {
    version: '1.1.0',
    date: '2025-12-21',
    title: 'Parcelamentos e categorias',
    groups: [
      { title: 'Novidades', items: [
        'Parcelamentos (carnês, empréstimos, financiamentos): parcela atual, quanto falta e quando termina.',
        'Recorrentes semanais, quinzenais, bimestrais, trimestrais, semestrais e anuais (IPVA, IPTU, seguro).',
        'Subcategorias e credores (a quem você paga, com o total em aberto).',
      ] },
      { title: 'Melhorias', items: [
        'Gastos por categoria no Painel (gráfico de rosca).',
        'Marcar a conta como paga com a data real do pagamento.',
      ] },
    ],
  },
  {
    version: '1.0.0',
    date: '2025-12-07',
    title: 'Primeira versão',
    groups: [
      { title: 'Novidades', items: [
        'Contas avulsas com valor, vencimento, categoria e observação.',
        'Despesas recorrentes mensais (aluguel, luz, internet), geradas sozinhas em cada mês.',
        'Situação de cada conta: paga, vence hoje, vence logo e atrasada.',
        'Painel do mês: total a pagar, pago e em atraso, e as próximas contas.',
        'Categorias padrão e navegação entre os meses.',
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
