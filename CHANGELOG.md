# Novidades do Dhenors

Todas as mudanças importantes do projeto, da primeira versão (7 de dezembro de 2025) até hoje. O app mostra o mesmo conteúdo em **Ajustes → Novidades** (arquivo `js/changelog.js`) e abre a tela sozinho uma vez depois de cada atualização.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem [SemVer](https://semver.org/lang/pt-BR/). A versão vem do `package.json` e é espalhada por `npm run sync`.

| Fase | Versões | Período | Foco |
|---|---|---|---|
| Base | 1.0 – 1.8 | dez/2025 – abr/2026 | contas, cartões, contas bancárias, salário, holerite, plantões, backup, instalação |
| Planejamento | 2.0 – 2.9 | abr – ago/2026 | importação, busca, planejamento, metas, investimentos, folha completa, dívidas |
| Nuvem e acabamento | 3.0 – 3.5 | set – out/2026 | nuvem criptografada, visual novo, análise, qualidade, saldo do mês e meses que não fecham |

## [3.5.0] — 2026-10-18

Os dados ficam só na nuvem; nova tela de entrada.

### Alterado
- **Tudo na nuvem, nada no navegador**: os dados não são mais salvos no aparelho (nem IndexedDB, nem cópia no localStorage, nem cache). Ao entrar, o estado é baixado e decifrado na memória; cada alteração sobe na hora, cifrada com a frase secreta, como antes. No navegador fica só o acesso à conta, pelo tempo escolhido ao entrar (sempre, 30 dias ou só até fechar o app) — nunca valores, contas ou anexos. Sair da conta tira os dados do aparelho na hora.
- **Visitante**: sem login, o app abre com dados de exemplo e todas as telas podem ser vistas. Qualquer alteração (lançar, pagar, editar) abre a tela de entrar; tema e modo discreto funcionam sem login.
- **Tela de entrada nova**: página própria, com os mesmos passos de antes — e-mail e senha (entrar, criar conta, esqueci a senha) e depois a frase secreta — mostrados em etapas, com abas Entrar/Criar conta, força da frase, escolha visual de quanto tempo lembrar o login e erros no próprio formulário. Ao abrir com o login lembrado, uma tela de carregamento aparece até os dados chegarem; sem internet, uma tela diz isso e oferece tentar de novo.
- **Anexos na nuvem**: as fotos de comprovantes e boletos vão para o Supabase Storage, cifradas no aparelho com uma chave própria por arquivo (guardada no lançamento, que por sua vez é cifrado). Abrem em qualquer aparelho. Requer rodar de novo `supabase/schema.sql` (cria o bucket privado `dhenors-files`).
- **Service worker mínimo**: só para notificações push e para instalar o app. Sem cache: cada abertura já vem na versão mais nova.
- **Quem já usava**: os dados guardados no aparelho por versões anteriores (inclusive os protegidos por PIN/senha, que são pedidos uma vez) e os anexos sobem para a nuvem no primeiro login e só então são apagados do navegador. Se o aparelho e a nuvem tiverem dados diferentes, você escolhe quais ficam.

### Adicionado
- **Fale conosco** (Ajustes → Fale conosco, também no menu, na busca e no menu lateral): feedback, sugestão ou reclamação, com área do app, assunto, mensagem com contador, anexo (imagem ou PDF até 5 MB) e nota de 1 a 5 estrelas no feedback. Na reclamação, aparece o campo obrigatório "Descrição detalhada do problema / erro ocorrido" e o aviso de suporte. Validação ao lado de cada campo, botão com carregamento e confirmação de envio. Funciona também sem login.
- A mensagem chega por e-mail (Edge Function `send-feedback` + Resend) com o assunto `[NOVO FEEDBACK] - Área - Nome` (`[NOVA SUGESTÃO]`, `[NOVA RECLAMAÇÃO]`), corpo em HTML organizado, o anexo e "responder" indo direto para quem escreveu. O servidor confere tudo de novo, recusa robôs e limita o número de envios.

### Aperfeiçoado
- **Encaixe em qualquer tela**: revisão de todas as telas, abas, janelas e da tela de entrar em 20 tamanhos (de celulares de 320 px a monitores de 2560 px, em pé e deitado), com dados normais, nomes longos e valores altos. Nada passa da tela, sai do card, se sobrepõe ou fica espremido; números grandes diminuem só o necessário para caber; rótulos dos gráficos que se encostariam somem (o valor continua na dica e na tabela); as ações das linhas e as dicas descem quando falta espaço; a barra de baixo fica compacta com o celular deitado; e nenhum campo faz o iPhone dar zoom.
- Teste automático de responsividade (`tests/e2e/responsive.spec.js`) que falha se qualquer um desses problemas voltar.

### Corrigido (revisão completa)
- **Nuvem e migração**: os dados de versões anteriores só saem do navegador depois que a nuvem confirma o envio (antes, uma falha de rede no primeiro login podia apagá-los); anexos protegidos por PIN não se perdem numa segunda tentativa; fechar o app no meio da migração não pula mais os dados antigos; "Usar os deste aparelho" não é desfeito se outro aparelho salvar ao mesmo tempo; nuvem ilegível não vira "conta nova" vazia.
- **Sessão**: erro temporário do servidor (projeto pausado, 5xx, muitas tentativas) não tira mais você da conta; duas abas abertas não se derrubam ao renovar o login; relógio do aparelho errado não quebra a sessão; alterações não enviadas são guardadas e juntadas com a nuvem se a frase for trocada em outro aparelho; trocar a frase é tudo-ou-nada; sair da conta desliga os lembretes push daquela conta e avisa sobre conflitos sem resolver.
- **Envio**: ao trocar de app ou bloquear a tela, as alterações sobem na hora; "Manter a deste aparelho" num conflito volta só os campos em conflito; a chave lembrada fica como chave não exportável.
- **Cálculos**: gasto por dia não sobe mais ao pagar uma conta sem conta bancária; assinatura no cartão entra na fatura certa e conta no limite usado; rescisão com mês comercial, avos de férias por mês de calendário, média das variáveis e FGTS com plantões e férias; DARF sempre em dia útil; reajuste automático não muda meses passados; "Posso comprar?" à vista considera compras pequenas; divisão entre categorias fecha com o total; IRPF não conta farmácia como despesa médica; tabela do IR de jan–abr/2025.
- **Telas**: o assistente reaberto não apaga mais nome e salário; câmera desliga ao fechar a leitura de boleto; erros ao deslizar, marcar parcela ou plantão em mês fechado aparecem; seleção em lote age só sobre o que está na tela; importação em andamento não atravessa entrar/sair da conta; cartões e contas arquivados podem ser reabertos; "Desfazer" dos ícones das categorias e do histórico da meta funciona; atalho "Lançar plantão" do ícone volta a funcionar; textos antigos (PIN, "fica no aparelho", "Compartilhar") saíram.
- **Segurança**: cota por conta também em alterações, limites de tamanho e de aparelhos, cota de anexos (100 MB), limite de envios do Fale conosco guardado no banco, conferência do tipo real dos anexos, app protegido contra ser aberto dentro de outro site, arquivo único fora do site publicado e servidor local sem expor arquivos ocultos.

### Removido
- **PIN, senha do app, biometria e bloqueio automático**: protegiam os dados guardados no aparelho, que não existem mais. A proteção agora é o login + a frase secreta; num aparelho compartilhado, escolha "Só até fechar o app" ou saia da conta.
- **Modo offline** e **"Compartilhar" do celular para o Dhenors** (dependiam de guardar arquivos no aparelho). Para importar extratos e faturas, use Importar extrato.
- **Modo exemplo** separado: o exemplo agora é o que o visitante vê antes de entrar.
- Proteção do armazenamento do navegador (Ajustes → Dados), que não tem mais função.

### Código
- `core/store.js` guarda o estado só na memória (`open`/`close`, `guest`, `GuestError`). `core/storage.js` cuida só do login lembrado. `core/legacy.js` lê e apaga o formato antigo. `ui/auth.js` + `css/auth.css`: tela de entrada.
- Base do merge, índice, conflitos e registro de erros ficam na memória da sessão.
- Saíram `ui/lock.js`, `ui/pinpad.js`, `core/biometric.js`, `views/received.js` e `sw-assets.js` (a lista de cache).
- Testes de ponta a ponta com um Supabase simulado: cadastro, frase, envio cifrado, nada no navegador, outro aparelho, migração dos dados antigos.

## [3.4.0] — 2026-10-16

Salário, ganhos extras e gastos separados; meses que não fecham; o peso futuro de cada conta.

### Adicionado
- **Painel — "Seu dinheiro no mês"**: o primeiro bloco da tela mostra três números — **Salário do mês** (líquido da folha, com bruto, adições e descontos linha a linha), **Ganhos do mês** (salário + o que veio de fora da folha + férias, PLR, outros vínculos) e **Gasto no mês** (pago, falta e em atraso) — e o **saldo do mês** grande, com anel de quanto dos ganhos está comprometido, barra pago/a pagar/em atraso/livre e a situação por extenso (folgado, apertado, não fecha). Pode ser reordenado ou escondido em "Organizar painel" e aparece primeiro também para quem já tinha organizado o painel.
- **Próximos 12 meses**: faixa no Painel, na aba 12 meses e na Análise com cada mês marcado como **folgado / apertado / não fecha** (cor, ícone e texto). Tocar num mês mostra o que pesa nele (parcelas, faturas, anuais como IPVA, contas fixas, dia a dia estimado), quanto falta e as dicas para resolver. A Agenda mostra a situação do mês exibido.
- **Ganhos extras recorrentes** (fora da folha): aluguel recebido, pensão, freela fixo… Em Nova receita → "Repete todo mês". Entram sozinhos nos meses, nas previsões e no saldo da conta bancária; dá para pular um mês.
- **Selos nos lançamentos** (Contas, Painel, Agenda, Busca e fatura do cartão): **gasto exagerado** (bem acima da média da mesma conta, categoria ou cartão), **fora do comum** (avulsa grande ou sem nada parecido antes) e **pesa no futuro** (parcelas que faltam, compras parceladas, recorrentes novas — até quando).
- **Gastos que pesam no futuro**: "3 gastos deste mês ainda vão pesar até mar/27", com quanto pesa em cada mês.
- **Dicas em três níveis** com os seus números: simples ("Luz 40% acima da média"), médias ("Se você antecipar a parcela 3/10 para dezembro, abril passa de −R$ 120 para R$ 110") e para planejar (guardar nos meses de folga e no 13º para cobrir os apertados, despesas anuais, quantos plantões fecham um mês, quanto cabe de parcela nova em 12 meses).
- **Prévia ao lançar**: no parcelamento, na compra no cartão, na recorrente e na avulsa grande, uma linha do tempo atualiza enquanto você digita e avisa antes de salvar ("Com esta compra, junho fica negativo em R$ 230"). Na recorrente, só os meses em que ela pesa ficam destacados; na avulsa, o efeito até o próximo salário.
- **Ajustes → Alertas e dicas**: folga mínima do mês (padrão 10% dos ganhos), limite de gasto exagerado (40% acima da média) e de gasto grande (10% dos ganhos).
- **Lembretes**: aviso semanal, sem valores, quando algum dos próximos 12 meses não fecha (no app e no push).

### Alterado
- **Movimento integrado**: nas abas e nos grupos de opções, a seleção agora é uma pílula que desliza até a opção escolhida (como no iOS); nas abas do celular, a aba ativa rola para o centro. Ao trocar de aba ou de mês, o conteúdo desliza do lado para onde você andou, sem refazer a entrada da tela. Barras e faixas que mudam de valor deslizam até o novo tamanho, cards reorganizados no Painel deslizam até o novo lugar, janelas fecham com animação e "Detalhes" abrem com altura suave. Tudo respeita "reduzir movimento" e Ajustes → Efeitos.
- **Atualização automática**: o aviso "Nova versão disponível · Atualizar" saiu. A versão nova é baixada em segundo plano, assume sozinha e o app recarrega uma vez no primeiro momento seguro (sem janela aberta, sem campo sendo digitado, ou ao voltar para o app). Nada que estava sendo digitado se perde.

### Corrigido
- **Previsão**: o "Posso comprar?" e o simulador deixavam de fora 13º, férias, PLR e outros vínculos, enquanto a aba 12 meses contava. Agora todas as previsões usam a mesma renda e a mesma regra.
- **Previsão**: um gasto grande e pontual (ex.: TV à vista) era "engolido" pela estimativa do dia a dia; agora soma por cima dela.
- **12 meses**: "aperta" era relativo à média do ano (um mês com pouca sobra podia não aparecer); agora usa a folga mínima de Ajustes, a mesma do Painel.
- **Contas → Assinaturas**: "Nova assinatura" abria "Nova subcategoria". No Painel de um mês passado, o lápis do salário editava o mês atual. (Duas telas usavam a mesma ação; agora o app avisa no console se isso voltar a acontecer.)
- **Modo exemplo**: a cópia dos seus dados reais ficava sem criptografia (mesmo com PIN) e sobrevivia a "Apagar todos os dados"; agora é cifrada e apagada junto. Com dados de uma versão mais nova do app, o exemplo não grava mais por cima deles.
- **Cartão**: estorno maior que as compras do mês virava crédito na fatura seguinte no banco, mas sumia no app; agora abate a próxima fatura. Pagar a fatura guarda o valor pago. A Agenda mostrava o fechamento no dia errado (ou sem valor).
- **Fechar o mês**: o mês continuava aparecendo como aberto até a próxima mudança; contas variáveis (luz, água) eram gravadas com o valor do cadastro em vez da estimativa que aparecia.
- **13º adiantado nas férias**: dezembro descontava a 1ª parcela recalculada (com a média de plantões e horas), e não o valor que de fato veio nas férias.
- **Saldo das contas bancárias**: a conta-salário não recebia 13º, férias, PLR e outros vínculos, e divergia do fluxo diário.
- **Simulador**: cancelar uma recorrente que começa no mês da simulação não a cancelava. "Posso comprar?" parcelado perdia centavos.
- **Janelas**: Enter repetido durante o fechamento podia salvar duas vezes; erros no menu de ações sumiam sem aviso; o "Desfazer" ficava atrás do fundo escuro; links internos deixavam a janela aberta por cima da nova tela.
- **Dados**: com o banco do navegador bloqueado por outra aba, o que era feito podia se perder na abertura seguinte. Backup com recorrente inválida (fim antes do início, cartão que não existe) fazia a conta sumir.
- **Modo discreto**: no lugar do desfoque, cada valor vira um olho cortado + "••••" no mesmo lugar (a tela não pula ao ligar). Agora cobre também os valores escritos no meio de frases, avisos e janelas, que antes ficavam à mostra. Tocar num valor continua mostrando ele por 3 segundos.
- **Visual**: a dica de "tem mais para rolar" pintava uma faixa escura com seta por cima do conteúdo das janelas; agora o conteúdo só esmaece na borda. Saiu o botão flutuante de rolagem, que ficava por cima dos cards. No celular, as janelas não ocupavam a largura toda. O card "Meta de gastos" vazio tinha ícone e título fora do centro.
- **Outros**: caixas de seleção em lote apareciam desmarcadas; números animados podiam terminar com o valor do mês anterior; a atualização automática esperava também janelas abertas e avisos de "Desfazer" em segundo plano; o leitor de tela lia duas vezes "conta paga".

### Código
- Removido código sem uso: 14 funções e constantes, 6 ações sem botão, 15 classes CSS e 5 variáveis de estilo de versões anteriores.
- Formato de dados **9**: `recurringIncomes` e `settings.alerts`, com migração automática (nada muda nos dados antigos), sanitização, junção entre aparelhos e backup.
- Novos módulos de domínio (sem DOM, testados): `monthStatus.js`, `outlook.js`, `weights.js`, `advice.js`, `recurringIncome.js`. `projection()` e `yearPlan()` ganharam cache por estado.

## [3.3.1] — 2026-10-12

Recuperação de partes da nuvem e cadastro aberto.

### Aperfeiçoado
- **Nuvem**: cada pessoa cria a própria conta pelo app e a confirma pelo e-mail que o Supabase envia.

### Corrigido
- **Nuvem**: o erro "Uma parte dos dados da nuvem não foi encontrada" não trava mais a abertura. Partes apagadas por engano (a limpeza removia partes ainda em uso) são recuperadas do histórico de versões ou do aparelho e reenviadas. A limpeza não apaga nada quando não consegue ler uma versão do histórico.

### Removido
- **Open Finance (Pluggy)**: saiu de Ajustes → Dados. Para trazer transações do banco, use a importação de extrato (OFX, CSV ou PDF da fatura).

## [3.3.0] — 2026-10-09

Revisão completa de qualidade: perda de dados, cálculos e segurança.

### Corrigido
- **Nuvem**: casos em que a sincronização podia sobrescrever ou perder alterações feitas em outro aparelho.
- **Investimentos**: IR na venda de ações (preço médio, isenção mensal e compensação de prejuízo).
- **Salário**: cálculos da folha e das férias (1/3, médias e descontos).
- **Importação**: extratos, faturas e holerites com formatos que antes falhavam ou duplicavam lançamentos.
- **Acessibilidade e uso**: Esc fecha janelas e menus de forma consistente, desfazer mais confiável, foco e anúncios para leitores de tela.
- **Desempenho**: telas com muitos lançamentos abrem e atualizam mais rápido.
- **Instalação**: a página de apresentação, a política de privacidade e o arquivo único voltam a abrir depois de instalar o app; a instalação não mistura arquivos de versões diferentes.

### Segurança
- Arquivos recebidos pelo "Compartilhar" ficam no aparelho no máximo 24 horas se não forem usados.
- Ações do GitHub fixadas, permissões mínimas na publicação e servidor de desenvolvimento só em 127.0.0.1.

## [3.2.0] — 2026-10-04

Relatórios, comparações e retrospectiva.

### Adicionado
- **Relatório do mês em PDF**, pronto para imprimir ou guardar.
- **Gastos fora do padrão** (anomalias) destacados na Análise.
- **Comparar períodos**: dois meses ou intervalos lado a lado, categoria por categoria.
- **Retrospectiva do ano** e **histórico da saúde financeira** mês a mês.

### Aperfeiçoado
- **Baixar dados**: contracheques e resumo financeiro em planilha (CSV) e holerite em PDF.

### Código
- ESLint, Prettier, checagem de tipos por JSDoc, testes no navegador (Playwright) com capturas, prévia em cada pull request, política de privacidade e de segurança.

## [3.1.0] — 2026-09-20

Visual limpo e nativo, gestos, voz e acessibilidade.

### Adicionado
- **Visual novo**: superfícies neutras, elevação sutil, vidro nas barras e tipografia com hierarquia clara. A cor só comunica significado (verde = positivo, vermelho = negativo, laranja = atenção, azul = neutro). Fonte Inter com números alinhados e ícones por categoria.
- **Aparência**: tema claro, escuro ou preto (OLED), cor de destaque, densidade compacta e efeitos calmos ou desligados.
- **Painel configurável** (reordenar, esconder e fixar cards) e **barra do celular** com os atalhos que você escolher.
- **Gestos**: deslizar a conta para pagar, puxar para atualizar; **Ctrl+Z** para desfazer.
- **Modo discreto** para usar em público, **lançamento por voz** e "Compartilhar" de outros apps para o Dhenors.

### Aperfeiçoado
- **Acessibilidade**: foco visível, alvos de toque de 44 px, anúncios para leitores de tela e tabelas alternativas para os gráficos.
- **Ações em lote** e listas agrupadas por data.

## [3.0.0] — 2026-09-06

Os mesmos dados em todos os aparelhos, cifrados com uma frase que só você sabe.

### Adicionado
- **Nuvem (Supabase)** com criptografia de ponta a ponta: os dados são cifrados no aparelho com a sua **frase secreta** antes de subir.
- **Sincronização em blocos e em tempo real**: só o que mudou é enviado, e os outros aparelhos atualizam sozinhos.
- **Conflitos** resolvidos item a item, campo a campo, sem perder nada.
- **Histórico de versões** para voltar os dados a um momento anterior, **aparelhos conectados** (desconectar à distância) e troca da frase secreta.
- **Lembretes push** com o app fechado, sem valores nem nomes.
- **Open Finance (Pluggy)** opcional.

### Aperfeiçoado
- Aviso quando o projeto gratuito do Supabase está perto de pausar por falta de uso.

## [2.9.0] — 2026-08-23

Contas que mudam de valor, quem te deve e o que você deve.

### Adicionado
- **Assinaturas** (streaming, apps, academia) com aviso de renovação e custo por ano.
- **Reajuste automático** das recorrentes pelo IGP-M ou IPCA no mês de aniversário.
- **Contas variáveis** (luz, água, gás) estimadas pela média dos últimos meses.
- **Valores a receber** ("alguém me deve"), com recebimento parcial.
- **Dívidas** com simulação de quitação (bola de neve × avalanche) e **quitação antecipada** de parcelamentos.

### Aperfeiçoado
- **Fechar o mês**: congela os valores do mês e marca como fechado no histórico.

## [2.8.0] — 2026-08-09

O que acontece com o salário ao longo do ano e da carreira.

### Adicionado
- **Previsão do IR anual**: completa × simplificada, quanto restituir ou pagar.
- **Rescisão e FGTS**: simulação por tipo de saída, saldo do FGTS e multa.
- **Benefícios**: PLR (tabela própria), abono salarial, VA/VR à parte do dinheiro na conta.
- **Outros vínculos** (segundo emprego, CLT + PJ) e **linha do tempo da carreira** com o ganho real descontando a inflação.

## [2.7.0] — 2026-07-26

A folha de pagamento por completo.

### Adicionado
- **13º salário** com a média das variáveis habituais (horas extras, noturno, sobreaviso, plantões na folha): 1ª parcela até 30/11 e 2ª = total − 1ª − INSS − IR.
- **Férias** com 1/3, médias e adiantamento do 13º.
- **Sobreaviso** (1/3 da hora) com as horas cumpridas em cada mês.
- **Salário pago no mês seguinte**: competência trabalhada separada da data de pagamento.

### Aperfeiçoado
- Descontos do salário sempre em vermelho, linha a linha, no contracheque.

## [2.6.0] — 2026-07-12

Quanto a carteira rende de verdade.

### Adicionado
- **IR na venda de ações**: preço médio, isenção de R$ 20 mil por mês, compensação de prejuízo e **DARF**.
- **Comparar** a carteira com CDI, IPCA e Ibovespa.
- **Independência financeira**: quanto falta e em quanto tempo.
- **PGBL × VGBL** para escolher a previdência certa.

### Aperfeiçoado
- **Metas ligadas a investimentos**: o saldo investido conta como guardado.

## [2.5.0] — 2026-06-28

A carteira dentro do controle financeiro.

### Adicionado
- **Carteira de investimentos**: renda fixa que rende sozinha, ações, FIIs, ETFs, cripto e previdência, com aportes e resgates.
- **Taxas do Banco Central** (CDI, Selic, IPCA, IGP-M) atualizadas com um toque.
- **Cotações** (brapi) e **proventos** com histórico.
- IR regressivo da renda fixa, alocação e carteira ideal.

## [2.4.0] — 2026-06-14

Para onde o dinheiro vai — e para onde deveria ir.

### Adicionado
- **Metas** com aportes e a **reserva de emergência** (o ideal de 6 meses de gastos).
- **Lista de desejos** com preço-alvo, avisando quando o preço chega lá.
- **Saúde financeira**: nota de 0 a 100, o que pesa nela e como melhorar.
- **Agenda** do mês com salário, contas, plantões e faturas, e exportação para o calendário do celular (.ics).
- **Envelopes**, **regra 50/30/20** e **meta de gastos mensal**.

### Aperfeiçoado
- **Lembretes** de vencimento ao abrir o app: um resumo por dia, por semana ou um aviso por conta.

## [2.3.0] — 2026-05-31

Olhar para frente antes de gastar.

### Adicionado
- **Fluxo de caixa dia a dia** até o próximo salário.
- **Visão de 12 meses**: o que entra e o que sai em cada mês, com 13º, férias e despesas anuais.
- **"Posso comprar?"**: à vista ou parcelado, com o efeito nos próximos meses.
- **Simulador** com cenários salvos e comparação lado a lado.

### Aperfeiçoado
- Painel mostra quanto dá para gastar por dia até o salário.

## [2.2.0] — 2026-05-17

Achar e lançar qualquer coisa em segundos.

### Adicionado
- **Busca** com filtros (período, categoria, valor, etiqueta) e **buscas salvas**.
- **Ctrl+K**: telas, ações e lançamentos num só lugar.
- **Lançamento em linguagem natural**: "mercado 120 ontem", "luz 180 todo dia 20", "tv 2400 em 10x".
- **Etiquetas** (#viagem) e **divisão de um gasto** entre categorias.

### Aperfeiçoado
- Atalhos de teclado: N (novo), / (buscar) e ↑ ↓ nas listas.

## [2.1.0] — 2026-05-03

Menos digitação.

### Adicionado
- **Fatura do cartão em PDF**: as compras são lidas do arquivo e entram na fatura certa, parceladas com a parcela correta.
- **Anexos**: foto do comprovante ou do boleto em cada conta.
- **Boleto e Pix**: leitura pela câmera (código de barras e QR Code) ou colando a linha digitável / Pix Copia e Cola.

## [2.0.0] — 2026-04-19

O banco conversa com o app.

### Adicionado
- **Importar extrato** OFX ou CSV, com revisão antes de salvar.
- **Conciliação**: saídas que batem com uma conta em aberto (mesmo valor, até 7 dias) marcam essa conta como paga, sem duplicar.
- **Regras de categoria** aprendidas com você ("Sempre colocar UBER em Transporte?").

### Aperfeiçoado
- Arrastar e soltar arquivos na tela de importação; o arquivo é lido no próprio aparelho.

## [1.8.0] — 2026-04-05

O Dhenors como app no celular e no computador.

### Adicionado
- **Instalar como app**, com ícone próprio e atalhos no ícone (Novo gasto, Nova conta, Plantão).
- Uso sem internet depois da primeira visita.
- **Biometria** (digital ou rosto) para abrir, bloqueio automático e espera crescente após tentativas erradas.

### Aperfeiçoado
- Proteção mais forte da senha (600 mil iterações), com os dados antigos regravados sozinhos.

## [1.7.0] — 2026-03-22

Seus dados guardados e protegidos.

### Adicionado
- **Backup** em arquivo .json e restauração.
- **Backup protegido com senha** (AES-256).
- **PIN ou senha** para abrir o app, com os dados cifrados.

### Aperfeiçoado
- Lembrete de backup no Painel.

## [1.6.0] — 2026-03-08

Para quem ganha além do salário fixo.

### Adicionado
- **Escala de plantões**: marque os dias no calendário, com valor por tipo (12 h, 24 h, noturno, fim de semana).
- **Rendas extras** fora da folha (freela, venda, reembolso).

### Aperfeiçoado
- Plantões pagos na folha entram no salário do mês certo.

## [1.5.0] — 2026-02-22

O app confere o seu contracheque.

### Adicionado
- **Importar o holerite em PDF** e conferir **verba a verba** com o cálculo do app.
- **Horas extras** com DSR automático e **consignado** com controle de parcelas.
- **Histórico do salário**: reajustes com data, sem mudar os meses anteriores.

### Aperfeiçoado
- Aviso quando ainda faltam as tabelas de INSS e IR de um ano.

## [1.4.0] — 2026-02-08

O app entende a folha de pagamento brasileira.

### Adicionado
- **Salário bruto** com **INSS** por faixa e **IR** (desconto simplificado, dependentes) pelas tabelas oficiais de cada ano.
- **Dia do pagamento**: dia fixo ou 5º dia útil, considerando os feriados nacionais.
- **Adicionais e descontos fixos** em folha (insalubridade, noturno, plano de saúde).

### Aperfeiçoado
- Painel mostra o salário do mês e quanto dele já está comprometido.

## [1.3.0] — 2026-01-25

Saber onde o dinheiro está.

### Adicionado
- **Contas bancárias e carteiras** com saldo inicial e saldo atual calculado.
- **Transferências** entre contas, sem contar como gasto.
- **Conferência** com o saldo do banco: o app mostra a diferença e ajusta.

### Aperfeiçoado
- Cada pagamento indica de qual conta saiu o dinheiro.

## [1.2.0] — 2026-01-11

Faturas sem surpresa.

### Adicionado
- **Cartões** com dia de fechamento e de vencimento: cada compra cai na fatura certa.
- **Compras parceladas no cartão**, distribuídas nas faturas seguintes.
- **Fatura do mês** vira uma conta a pagar, com a lista de compras.
- **Limite usado e disponível** de cada cartão.

### Aperfeiçoado
- Painel separa contas avulsas, recorrentes, parcelas e faturas.

## [1.1.0] — 2025-12-21

Tudo o que se repete, organizado.

### Adicionado
- **Parcelamentos** (carnês, empréstimos, financiamentos): parcela atual, quanto falta e quando termina.
- **Recorrentes** semanais, quinzenais, bimestrais, trimestrais, semestrais e anuais (IPVA, IPTU, seguro).
- **Subcategorias** e **credores** (a quem você paga, com o total em aberto).

### Aperfeiçoado
- **Gastos por categoria** no Painel (gráfico de rosca).
- Marcar a conta como paga com a data real do pagamento.

## [1.0.0] — 2025-12-07

As contas do mês num lugar só.

### Adicionado
- **Contas avulsas** com valor, vencimento, categoria e observação.
- **Despesas recorrentes** mensais (aluguel, luz, internet), geradas sozinhas em cada mês.
- **Situação de cada conta**: paga, vence hoje, vence logo e atrasada.
- **Painel do mês**: total a pagar, pago e em atraso, e as próximas contas.
- **Categorias** padrão e navegação entre os meses.
