# Dhenors 3.2 — Controle financeiro pessoal

Contas, recorrentes, parcelamentos, renda extra, metas, credores, categorias, análise e histórico.
Funciona offline, salvando no aparelho (IndexedDB), e — se você quiser — sincroniza com a **nuvem (Supabase)**, com os dados **criptografados** por uma frase que só você sabe. Site publicado no **GitHub Pages**. Passo a passo: [`docs/NUVEM.md`](docs/NUVEM.md).

---

## Como usar

| Jeito | Quando usar | Como |
|---|---|---|
| **Arquivo único** | Abrir com dois cliques no computador | Abra `dist/dhenors.html` no Chrome/Edge/Firefox |
| **Servidor local** | Para desenvolver | `npm start` e acesse `http://localhost:5173` (ou `python -m http.server 5173`) |
| **Publicar na internet** | Usar no celular e instalar como app | Envie a pasta (sem `node_modules`, `tests`, `tools`) para qualquer hospedagem estática: GitHub Pages, Netlify, Vercel, Cloudflare Pages. No celular, use "Adicionar à tela inicial" |

> `index.html` usa módulos JavaScript, que **não** funcionam abrindo o arquivo direto (`file://`). Para isso existe o `dist/dhenors.html`.

### Seus dados

- Ficam **somente no navegador e no aparelho onde você usa o app**. Cada navegador/aparelho tem os próprios dados.
- **Faça backup** em *Ajustes → Baixar backup* (arquivo `.json`). O painel avisa quando o último backup tem mais de 30 dias.
- Para usar em outro aparelho: baixe o backup em um e use *Ajustes → Restaurar* no outro.
- Limpar os dados do site no navegador apaga tudo. Por isso, faça backup.
- Os dados antigos do Firestore **não** são migrados automaticamente.

---

## Estrutura do projeto

```
dhenors/
├── index.html              Página única (a "casca" do app)
├── manifest.webmanifest    Permite instalar como app (PWA)
├── sw.js                   Service worker: abre offline
├── package.json            Scripts: start, test, build
├── assets/icons/           Logo e ícones (≈ 30 KB no total)
├── css/
│   ├── tokens.css          Cores, fontes e espaçamentos (temas claro/escuro)
│   ├── base.css            Reset, foco visível, utilitários
│   ├── layout.css          Menu lateral, barra superior, barra inferior (celular)
│   ├── components.css      Botões, cards, campos, janelas, listas, gráficos
│   └── views.css           Ajustes específicos de cada tela
├── js/
│   ├── main.js             Início: carrega dados, rotas (#/painel…), cliques
│   ├── core/               Base, sem tela
│   │   ├── money.js        Dinheiro em CENTAVOS, formatação R$, "12,50" → 1250
│   │   ├── dates.js        Datas "AAAA-MM-DD" sem bug de fuso e de dia 31
│   │   ├── calendar.js     Feriados nacionais, Páscoa, Nº dia útil
│   │   ├── crypto.js       Criptografia do PIN e da nuvem (PBKDF2 + AES-GCM)
│   │   ├── cloud.js        Sincronização com o Supabase (login, envio, merge)
│   │   ├── pdftext.js      Extrai o texto de PDFs (holerite)
│   │   ├── storage.js      Salvar/ler no IndexedDB (localStorage como reserva)
│   │   └── store.js        Estado central: commit() salva e redesenha
│   ├── domain/             Regras de negócio (funções puras, testadas)
│   │   ├── schema.js       Formato dos dados + validação de backup
│   │   ├── ledger.js       CÁLCULO DO MÊS: única fonte dos números
│   │   ├── payroll.js      Contracheque: bruto → INSS → IR → descontos → líquido (horas, DSR, afastamentos)
│   │   ├── payslip.js      Lê o texto do holerite e monta a importação
│   │   ├── taxTables.js    Tabelas de INSS e IR por ano (atualize aqui todo ano)
│   │   ├── analysis.js     Fechamento, histórico, projeção, insights
│   │   ├── planning.js     Orçamentos, saúde financeira, simulador, agenda/ICS, lembretes
│   │   ├── importer.js     Extratos OFX/CSV e categorização automática
│   │   ├── quickadd.js     Lançamento em linguagem natural ("mercado 120 ontem")
│   │   ├── actions.js      Toda gravação passa aqui (com validação)
│   │   └── defaults.js     Categorias padrão, cores e ícones
│   ├── ui/                 Peças de interface reutilizáveis
│   │   ├── dom.js          html`` que escapa tudo (sem XSS)
│   │   ├── icons.js        Ícones SVG embutidos (substitui o Font Awesome)
│   │   ├── charts.js       Gráficos SVG (substitui o Chart.js)
│   │   ├── dialog.js       Janelas com <dialog> nativo, confirmação e menu
│   │   ├── forms.js        Campos com <label> ligado ao campo
│   │   ├── editors.js      Formulários de cada tipo de lançamento
│   │   ├── payrollEditor.js Janelas do salário (base, adicional, desconto) e contracheque
│   │   ├── select.js       Caixas de opções estilizadas (substituem a lista nativa do navegador)
│   │   ├── exports.js      Holerite em PDF e planilhas (contracheques, resumo mensal)
│   │   ├── items.js        Linha de conta (pagar, desfazer, menu)
│   │   ├── backup.js       Backup JSON, restauração e CSV
│   │   ├── palette.js      Busca rápida e comandos (Ctrl+K)
│   │   ├── lock.js         Tela de bloqueio por PIN
│   │   ├── notify.js       Lembretes por notificação
│   │   ├── payslipImport.js Importar holerite (PDF ou texto)
│   │   └── toast.js        Avisos com "Desfazer"
│   └── views/              Uma tela por arquivo
│       ├── dashboard.js    Painel (com saúde financeira e orçamentos)
│       ├── agenda.js       Calendário do mês e exportação .ics
│       ├── simulator.js    Simulador "e se"
│       ├── importer.js     Importar extrato
│       ├── salary.js       Salário: bruto → líquido, adicionais, descontos, consignados
│       ├── bills.js        Contas do mês (busca e filtros)
│       ├── recurring.js    Recorrentes
│       ├── installments.js Parcelamentos
│       ├── goals.js        Metas
│       ├── creditors.js    Credores
│       ├── categories.js   Categorias e orçamentos
│       ├── analysis.js     Análise e projeção
│       ├── history.js      Histórico, fechamento, relatório
│       └── settings.js     Ajustes e dados
├── tests/*.test.mjs        Testes dos cálculos e recursos (npm test)
├── tools/build.mjs         Gera dist/dhenors.html (npm run build)
└── dist/dhenors.html       Versão em arquivo único, já gerada
```

**Como as peças conversam:** a tela chama uma função de `domain/actions.js` → ela valida e altera `store.data` → `store` salva no navegador e avisa → `main.js` redesenha a tela, que lê os números de `domain/ledger.js`.

---

## Regras de cálculo

- **Dinheiro em centavos inteiros.** R$ 1.000 em 3× = 333,34 + 333,33 + 333,33. A diferença vai para a 1ª parcela e a soma fecha exatamente com o total.
- **Datas:**
  - O dia é limitado ao fim do mês: uma parcela de 31/01 cai em 28/02 (ou 29/02 em ano bissexto), 31/03, 30/04…
  - Datas nunca são lidas em UTC, então não há "um dia a menos" no Brasil.
- **Salário (sempre bruto):** salário base + adicionais (em % do salário, % do salário mínimo ou R$) + plantões pagos na folha = bruto. Sobre ele o app calcula:
  - **INSS:** tabela progressiva do ano, limitada ao teto.
  - **Imposto de Renda:** escolhe o mais vantajoso entre deduções legais (INSS, dependentes, pensão/previdência) e o desconto simplificado. Aplica a redução da Lei 15.270/2025 (isenção até R$ 5.000 e redução parcial até R$ 7.350).
  - **Descontos em folha:** plano de saúde, VT, consignado etc., em R$ ou %.
  - O resultado é o **líquido**, que é o que entra como renda do mês. O contracheque estimado fica no Painel (“Ver contracheque”).
  - Adicionais podem ser marcados como sem impostos (ex.: auxílio-alimentação) e descontos como dedutíveis do IR (pensão, previdência).
  - O salário tem histórico ("vale a partir de"). Um aumento não altera os meses anteriores.
  - É uma **estimativa**: faltas, médias e regras específicas do empregador podem mudar o holerite real.
- **Renda extra:** marcada como "na folha", é bruta e paga INSS/IR junto com o salário (o app mostra quanto ela soma ao líquido). Desmarcada, é somada como valor já líquido.
- **Renda do mês** = líquido da folha + rendas extras fora da folha.
- **Saldo previsto:** renda − todas as contas do mês, pagas ou não. **Pago, A pagar e Em atraso** são partes desse total.
- **Recorrentes:**
  - Têm mês de início e, opcionalmente, mês de fim.
  - Você pode ajustar o valor só de um mês (ex.: conta de luz) ou pular um mês.
  - O pagamento fica salvo por mês, junto com os outros dados.
- **Parcelas:** você informa o valor da parcela, o nº de parcelas, quantas já pagou e o dia do vencimento. O app calcula o total, a data da 1ª e da última parcela. Cada parcela é marcada individualmente como paga e continua contando no total do mês.
- **Fechar mês:**
  - Guarda uma fotografia dos números no Histórico e bloqueia edições naquele mês.
  - **Nada é apagado**, e você pode reabrir o mês.
- **Contas atrasadas de meses anteriores** aparecem no topo do painel até serem pagas.
- **Projeção (Análise):** salário + recorrentes + parcelas agendadas + estimativa de gastos avulsos (mediana dos últimos 3 meses).

---

## O que mudou em relação à versão anterior

**Removido (peso sem benefício):**
- Firebase Auth, Firestore e Analytics, além do login, `login.html`, `firebase.json` e `.firebaserc`.
- Chart.js, Flatpickr e Font Awesome. Os três vinham de CDN sem versão fixa.
- Fonte Inter (7 pesos), `logo-detail.png` (4,4 MB) e logo de 370 KB.
- A pasta `.agents/`, o log de 7 MB e cerca de 25 mil linhas de código duplicado ou morto.

O app inteiro agora tem cerca de 170 KB.

**Bugs corrigidos:**

*Cálculos*
- Renda extra virava `NaN` no saldo.
- A Análise mostrava despesas zeradas.
- Parcelas e recorrentes nos dias 29 a 31 pulavam um mês.
- Erro de fuso horário nas datas.
- Parcela paga sumia do total do mês.
- Status e contagem regressiva do salário estavam errados.
- O período da análise tinha um mês a mais.
- A projeção contava os gastos duas vezes.
- A soma das parcelas não fechava com o total (centavos).

*Funcionamento*
- "Marcar como pago" não salvava.
- "Concluir mês" quebrava, apagava dados e fechava o mês errado.
- Recorrentes apareciam em meses anteriores à criação.
- O nome da subcategoria era salvo errado.
- Datas trocadas nos cards (dia/mês).
- Excluir recorrente falhava.
- O "valor devido" do credor estava inflado.

*Interface*
- Listeners e timers se acumulavam.
- Clique duplo criava registros duplicados.
- Faltava validação de valores e datas.

**Segurança:**
- A senha não é mais guardada no navegador; não há mais senha.
- Todo texto vindo do usuário é escapado (sem XSS).
- O CSV é protegido contra fórmulas.
- "Apagar tudo" exige digitar EXCLUIR.

**Acessibilidade e design:**
- Contraste AA nos dois temas.
- Foco visível e todos os campos com rótulo.
- Janelas nativas, que prendem o foco e fecham com Esc.
- Barra de navegação inferior no celular e rótulos no menu.
- Tema escuro sem "piscar" ao abrir.
- Respeita "reduzir movimento".
- O zoom não é mais bloqueado.

**Novidades:**
- Pagar com um toque e "Desfazer".
- Adiar uma conta.
- Ajustar ou pular uma recorrente em um mês.
- Cronograma de parcelas.
- Marcar parcelas já pagas ao cadastrar uma compra antiga.
- Metas com quanto guardar por mês, aportes e retiradas.
- "Dá para gastar R$ X/dia até o salário".
- Dependência da renda extra (plantões).
- Projeção de 6 meses e parcelamentos terminando.
- Relatório mensal imprimível em PDF.
- Exportação CSV.
- Backup e restauração.
- Instalável como app (PWA) e funciona offline.
- Atalho: tecla **N** abre "Novo lançamento".

---

## Novidades da 3.2 — na nuvem, em qualquer lugar

- **Sincronização com o Supabase** (Ajustes → Nuvem): login com e-mail e senha; dados **criptografados no aparelho** (AES-256-GCM, chave PBKDF2 da sua frase secreta) antes de ir para a nuvem.
- **Local primeiro:** tudo é salvo no aparelho na hora e funciona offline; a cópia vai para a nuvem logo depois e é buscada ao abrir/voltar ao app e a cada minuto.
- **Dois aparelhos ao mesmo tempo:** controle de versão na linha do banco + **merge de 3 vias** (junta contas novas dos dois lados, respeita exclusões).
- **Ícone de status** no topo (sincronizado, sincronizando, sem internet, erro) e tela "Já uso em outro aparelho" nas boas-vindas.
- **Publicação automática no GitHub Pages** (`.github/workflows/deploy.yml`): a cada envio, roda os testes, gera o arquivo único e publica.
- Arquivos novos: `js/config.js` (URL e chave pública do Supabase), `js/core/cloud.js` (sincronização, sem bibliotecas), `js/domain/merge.js`, `js/ui/cloudUI.js`, `supabase/schema.sql` (tabela + regras de acesso), `docs/NUVEM.md`, `tests/merge.test.mjs`.

## Novidades da 3.1 — igual ao holerite

Conferido com um holerite real (competência 09/2026): o app chega ao mesmo líquido, centavo a centavo.

| Recurso | Onde | Como funciona |
|---|---|---|
| **INSS como na folha** | automático | Cada faixa é calculada e **truncada** (121,575 → 121,57) antes de somar, como fazem os sistemas de folha. No teto, vale a contribuição máxima publicada. |
| **Salário cai no mês seguinte** | Salário → Editar | O holerite da competência (ex.: setembro) entra na renda do mês em que o dinheiro cai (outubro). A tela Salário mostra a competência; Painel, Agenda e Análise usam o mês do pagamento. |
| **Adicionais por horas** | Salário → Adicional → Horas | Horas extras 50%/100%, sobreaviso (1/3 da hora), adicional noturno (20%, hora reduzida) ou % livre. Valor da hora = salário ÷ divisor (220); horas extras e noturno incluem os adicionais fixos (Súmula 132 do TST). Aceita "100", "12:30" ou "7,5". |
| **DSR automático** | nas horas | DSR = valor das horas ÷ dias úteis × (domingos + feriados) do mês. |
| **Faltas e afastamentos** | Salário → Faltas e afastamentos | Atestado (empresa paga até 15 dias; o holerite separa "dias trabalhados" e "atestado"), afastamento pelo INSS (salário proporcional) e faltas (desconto e saída da base de INSS/FGTS/IR). |
| **Bases como no rodapé** | Contracheque | Sal. Base, Base INSS, Base FGTS, FGTS do mês e Base IRRF. |
| **Salário-família** | Salário → Editar | Filhos até 14 anos: R$ 67,54 por filho para remuneração até R$ 1.980,38 (2026). |
| **Importar holerite (PDF)** | Salário → Importar holerite | Lê o PDF no próprio aparelho (leitor próprio, sem bibliotecas), entende cada verba (salário, atestado, periculosidade, sobreaviso, horas extras, consignado, pensão, sindicato…), mostra o líquido calculado × o do holerite e importa. PDF escaneado? Cole o texto. |

Arquivos novos: `js/core/pdftext.js` (texto do PDF), `js/domain/payslip.js` (leitura do holerite), `js/ui/payslipImport.js` (tela de importação), `tests/payslip.test.mjs`. Esquema de dados 6 (migração automática).

## Novidades da 3.0

**Visual novo** — superfícies de vidro sobre fundo com brilho suave, gradiente da marca (azul → ciano), cantos generosos, menu lateral em seções, barra inferior flutuante no celular e tema escuro refeito.

| Recurso | Onde | O que faz |
|---|---|---|
| **Data do salário** | Salário → Editar | *Dia fixo* (ex.: todo dia 10) **ou** *Nº dia útil* (padrão: 5º). Conta sábado como dia útil (regra do MTE para salário; pode desligar) e pula domingos e feriados nacionais (inclusive Sexta-feira Santa e Consciência Negra; Carnaval e Corpus Christi são ponto facultativo e não entram). Mostra os próximos 3 pagamentos. |
| **Agenda** | Agenda | Calendário do mês com salário, contas, férias e metas; feriados em vermelho. Exporta os vencimentos para o calendário do celular (`.ics`, com alarme). |
| **Lembretes** | Agenda / Ajustes | Notificações de contas que vencem (no dia ou 1, 3, 7 dias antes). |
| **Busca e lançamento rápido** | `Ctrl+K`, `/` ou 🔍 | Ache telas, ações e lançamentos. Escreva em português: “mercado 120 ontem”, “luz 180 dia 20”, “plantão 900 recebi” — a categoria é sugerida sozinha. |
| **Importar extrato** | Importar extrato | OFX ou CSV do banco/cartão (arraste o arquivo). Revisão antes de importar, categorias automáticas, duplicados ignorados, e o app aprende regras com as suas escolhas. |
| **Regras de categorização** | Ajustes | “posto shell → Transporte”: usadas na importação e no lançamento rápido. |
| **Orçamento por categoria** | Categorias e orçamentos | Teto mensal por categoria, com barra de progresso e aviso no Painel. |
| **Saúde financeira** | Painel | Nota de 0 a 100 com 5 fatores (sobra da renda, custos fixos, contas em dia, reserva de emergência, gastos do mês) e uma dica para melhorar. |
| **Simulador “e se”** | Simulador | Aumento de salário, renda extra, nova compra parcelada, cortar recorrentes, quitar parcelamentos com desconto, reduzir gastos do dia a dia — compara o saldo mês a mês por 6, 12 ou 24 meses. Nada é salvo. |
| **Férias** | Salário | Férias + 1/3, abono (venda de até 10 dias, isento), adiantamento do 13º, INSS/IR das férias e salário do mês proporcional aos dias trabalhados. |
| **Bloqueio por PIN** | Ajustes → Segurança | PIN de 4–8 números. Os dados passam a ser salvos **criptografados** (AES-256-GCM, chave PBKDF2) e o app abre bloqueado; bloqueio automático após 0/1/5/30 min fora. Sem PIN não há como recuperar: mantenha um backup. |

Arquivos novos: `js/core/calendar.js` (feriados e dias úteis), `js/core/crypto.js`, `js/domain/planning.js` (orçamentos, nota, simulador, agenda/ICS, lembretes), `js/domain/importer.js` (OFX/CSV e categorização), `js/domain/quickadd.js`, `js/ui/palette.js`, `js/ui/lock.js`, `js/ui/notify.js`, `js/views/agenda.js`, `js/views/simulator.js`, `js/views/importer.js`. Os backups antigos continuam válidos (migração automática para o esquema 5).

## Novidades da 2.3

- **Adicionais e descontos fixos ou variáveis.** Fixos entram todo mês; variáveis (adicional noturno, horas extras, faltas, 1/3 de férias…) só no mês lançado. No mês seguinte o app oferece repetir os variáveis do mês anterior para você ajustar.
- **INSS: faixa e efetivo.** O contracheque mostra a faixa (ex.: "12%", o número que aparece na coluna de referência do holerite) e a alíquota efetiva (o desconto real, calculado faixa a faixa).
- **Previdência com alíquota fixa** para servidor público (RPPS), ex.: 14% sobre o bruto.
- **13º salário automático**, proporcional à data de admissão: 1ª parcela em novembro (sem descontos) e 2ª em dezembro (com INSS e IR exclusivo).
- **FGTS informativo** (8% depositado pela empresa) no contracheque.
- **Conferir com o holerite:** informe o líquido que caiu de verdade; o app usa esse valor na renda e mostra a diferença para a estimativa.
- **Baixar dados:** holerite do mês em PDF (imprimir/salvar), planilha de contracheques (proventos, descontos, totais), resumo mensal (renda, gastos, saldo, FGTS), contas do mês e backup. Em Salário, Análise e Ajustes.

## Novidades da 2.2

- Nova tela **Salário** no menu: líquido em destaque com a composição (líquido, INSS, IR, descontos), salário base, adicionais, descontos em folha, contracheque, plantões do mês e histórico.
- **Consignado parcelado:** no desconto em folha, ligue "Desconto parcelado" e informe o nº de parcelas e quantas já foram descontadas. O desconto aparece em **todos os meses da 1ª à última parcela** (mesmo antes do mês em que foi cadastrado e mesmo se o salário mudar no meio do caminho) e **sai sozinho** depois da última.
- Adicionais e descontos comuns valem do mês em que foram incluídos **em diante**, inclusive em meses que já tinham um aumento cadastrado.
- **Caixas de opções estilizadas:** categorias, subcategorias, credores, filtros e as sugestões de texto agora abrem uma lista no visual do app (tema claro/escuro), com busca quando há muitas opções e navegação pelo teclado.

## Novidades da 2.1

- Salário informado **bruto**, com adicionais (% ou R$), dependentes e descontos em folha. INSS e IR calculados automaticamente (tabelas 2025 e 2026), com contracheque estimado.
- Renda extra "na folha" (plantões) entra no bruto e paga impostos junto com o salário.
- Parcelamentos por **valor da parcela + nº de parcelas + já pagas**: total, início e fim calculados automaticamente.
- Dados da versão 2.0 são convertidos sozinhos: o salário antigo (líquido) continua valendo até você editá-lo e informar o bruto.

**Todo ano:** quando saírem as novas tabelas de INSS/IR, adicione o ano em `js/domain/taxTables.js` (copie o bloco anterior e troque os valores).

## Desenvolvimento

```bash
npm test          # testes dos cálculos (Node 18+, sem instalar nada)
npm install       # só para gerar o arquivo único
npm run build     # gera dist/dhenors.html
```

- **Ao publicar uma nova versão:** aumente `VERSION` em `sw.js` para os aparelhos baixarem os arquivos novos. Se criar um arquivo novo, inclua-o na lista `APP_SHELL`.
- **Para adicionar uma tela:**
  1. Crie `js/views/minhatela.js` exportando `{ id, title, render(), actions }`.
  2. Registre a tela em `VIEWS` e `NAV` no `main.js`.
  3. Use `data-action="nome"` nos botões.
