# Novidades do Dhenors

Todas as mudanças importantes do projeto. O app mostra o mesmo conteúdo em **Ajustes → Novidades** (arquivo `js/changelog.js`) e abre a tela sozinho uma vez depois de cada atualização.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem [SemVer](https://semver.org/lang/pt-BR/). A versão vem do `package.json` e é espalhada por `npm run sync` (app, service worker e testes).

## [3.3.1] — 2026-10-16

### Corrigido
- **Nuvem**: "Uma parte dos dados da nuvem não foi encontrada" impedia de desbloquear e sincronizar. Partes apagadas por engano (a limpeza das versões até a 1.0.0 removia partes ainda em uso) agora são recuperadas do histórico de versões ou dos dados do aparelho, e tudo é reenviado. A limpeza não apaga mais nada quando não consegue ler uma versão do histórico.

### Alterado
- **Nuvem**: cada pessoa cria a própria conta pelo app e a confirma pelo e-mail que o Supabase envia. A documentação não recomenda mais fechar o cadastro.

### Removido
- **Open Finance (Pluggy)**: a opção saiu de Ajustes → Dados. Para trazer transações do banco, use a importação de extrato (OFX, CSV ou PDF da fatura).

## [3.3.0] — 2026-10-16

Revisão completa de qualidade: correções de perda de dados, de cálculos e de segurança. A versão volta a subir a partir da 3.2.0 (a 1.0.0 publicada antes foi um retrocesso de numeração), para que quem estava na 3.2.0 veja estas Novidades.

### Corrigido
- **Nuvem**: casos em que a sincronização podia sobrescrever ou perder alterações feitas em outro aparelho.
- **Investimentos**: IR na venda de ações (preço médio, isenção mensal e compensação de prejuízo).
- **Salário**: cálculos da folha e das férias (1/3, médias e descontos).
- **Importação**: extratos, faturas e holerites com formatos que antes falhavam ou duplicavam lançamentos.
- **Acessibilidade e uso**: Esc fecha diálogos e menus de forma consistente, desfazer mais confiável, foco e anúncios para leitores de tela.
- **Desempenho**: telas com muitos lançamentos abrem e atualizam mais rápido.
- **Offline e atualização**: a página de apresentação, a política de privacidade, as Novidades e o arquivo único voltam a abrir normalmente depois de instalar o app; a instalação não mistura arquivos de versões diferentes; a primeira visita não recarrega mais a página sozinha.

### Segurança
- Arquivos recebidos pelo "Compartilhar" ficam no aparelho no máximo 24 horas se não forem usados.
- Ações do GitHub fixadas, permissões mínimas na publicação e servidor de desenvolvimento só em 127.0.0.1.

## [1.0.0] — 2026-10-15

Primeira versão.

### Dinheiro
- Contas avulsas, recorrentes (semanais a anuais) e parceladas, com status de pago, vence logo e atrasada.
- Cartões de crédito com fechamento e vencimento: compras e parcelas na fatura certa, limite usado, importação da fatura em PDF.
- Contas e carteiras com saldo, transferências e conferência com o saldo do banco.
- Divisão de um gasto entre categorias, etiquetas (#viagem), anexos de comprovante, leitura de boleto e Pix.
- Assinaturas com renovação, reajuste pelo IGP-M/IPCA, contas variáveis pela média.
- Valores a receber, dívidas com simulação (bola de neve × avalanche), quitação antecipada.
- Importação de extratos e conciliação com as contas já lançadas; regras aprendidas; busca com filtros e buscas salvas.

### Salário
- Salário bruto com INSS e IR por ano (com aviso quando faltam tabelas), importação e conferência do holerite verba a verba.
- Escala de plantões, previsão do IR anual, rescisão e FGTS, PLR/abono/VA-VR, outros vínculos, carreira.
- 13º com média das variáveis habituais (horas extras, noturno, sobreaviso, plantões na folha): 1ª parcela de 50% até 30/11 e 2ª = total − 1ª − INSS − IR.
- Sobreaviso: taxa fixa de 1/3 da hora, ativo todo mês, com as horas cumpridas informadas a cada mês. Descontos do salário sempre em vermelho.
- Salário pago no mês seguinte: cartão com a competência trabalhada, o valor e a data de pagamento.

### Investimentos
- Taxas do Banco Central, cotações (brapi), proventos, comparação com CDI/IPCA/Ibovespa, IR na venda de ações (DARF), reserva de emergência, independência financeira, PGBL × VGBL, metas ligadas a investimentos.

### Planejamento e análise
- Saúde financeira com histórico, fluxo de caixa diário, visão de 12 meses, "Posso comprar?", cenários salvos, envelopes, regra 50/30/20, agenda, relatório do mês em PDF, anomalias, comparação de períodos e retrospectiva do ano.

### Experiência
- Painel configurável, barra do celular configurável, desfazer (Ctrl+Z), deslizar para pagar, ações em lote, grupos por data, modo discreto, voz, atalhos do ícone, compartilhar arquivos para o app, puxar para atualizar, funcionamento offline.
- Visual limpo e nativo: superfícies neutras, elevação sutil, vidro nas barras, tipografia com hierarquia clara e movimento amortecido. A cor só comunica significado (verde = positivo, vermelho = negativo, laranja = atenção, azul = neutro), no valor, no ícone e nos selos. Fonte Inter com números alinhados, ícones de categoria, tema OLED, cor de destaque, densidade compacta, efeitos calmos/desligados.
- Acessibilidade: foco visível, alvos de toque de 44 px, anúncios para leitores de tela, tabelas alternativas para os gráficos.

### Segurança e nuvem
- PIN ou senha alfanumérica, 600 mil iterações, biometria (WebAuthn PRF), espera crescente e apagar após tentativas.
- Backup criptografado, troca da frase secreta, lembrar neste aparelho, aparelhos conectados, histórico de versões dos dados.
- Nuvem com criptografia de ponta a ponta, sincronização em blocos e em tempo real, conflitos resolvidos campo a campo, aviso de pausa do Supabase, lembretes push sem valores, Open Finance opcional.

### Código
- ESLint, Prettier, checagem de tipos por JSDoc, testes no navegador (Playwright) com capturas, prévia em cada PR, CHANGELOG, política de privacidade e de segurança.
