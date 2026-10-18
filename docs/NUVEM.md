# Dhenors na nuvem — passo a passo

Ao final você terá:

- o site no ar em **https://SEU-USUARIO.github.io/dhenors/** (abre no celular, no trabalho, em qualquer navegador);
- os dados salvos na sua conta do **Supabase**, **criptografados** com uma frase secreta que só você sabe;
- nada salvo no navegador além do login lembrado: os dados vivem só na nuvem e, com o app aberto, na memória. Cada alteração sobe na hora. **Sem internet, o app não abre os dados**; o que você alterar com o app já aberto espera a conexão voltar (não feche o app até lá).

> O site público (https://hstark0.github.io/dhenors/) já usa o projeto Supabase do desenvolvedor, com cadastro aberto: para só **usar** o Dhenors, basta abrir o site e tocar em **Criar conta**. Este passo a passo é para quem quer publicar **a própria cópia**, com o próprio Supabase (aí quem controla os dados é você).

Tempo: uns 15 minutos. Tudo nos planos **gratuitos**.

---

## Parte 1 — Supabase (onde os dados ficam)

1. Acesse **https://supabase.com** → *Start your project* → entre com o GitHub ou e-mail.
2. *New project*:
   - **Name:** `dhenors`
   - **Database Password:** gere uma e guarde (não é a senha do app).
   - **Region:** *South America (São Paulo)*.
   - *Create new project* e espere ~2 minutos.
3. Menu lateral → **SQL Editor** → *New query* → cole TODO o conteúdo do arquivo [`supabase/schema.sql`](../supabase/schema.sql) → **Run**. Deve aparecer *Success*.
   - Cria as tabelas `dhenors_state` (índice), `dhenors_chunks` (dados em blocos), `dhenors_versions` (histórico de versões), `dhenors_devices` (aparelhos conectados), `dhenors_push` (lembretes) e `dhenors_feedback_log` (limite do Fale conosco, sem acesso público), todas com RLS (cada conta só vê o que é dela); o estado fica ligado ao **Realtime**.
   - Cria também o bucket privado `dhenors-files` (Storage) para os **anexos**, com regras para cada pessoa só acessar a própria pasta.
   - Põe os limites contra abuso: cota de 50 MB por conta (dados + histórico) e 100 MB de anexos, tamanho máximo dos campos de aparelhos/push, no máximo 20 aparelhos e 10 inscrições de push por conta.
   - **Atualizou o Dhenors? Rode o arquivo de novo** (a cada versão nova): ele só cria e atualiza o que falta e mantém seus dados.
4. Menu → **Project Settings → API** (ou o botão **Connect** no topo) e copie:
   - **Project URL** — algo como `https://abcdefghijk.supabase.co`
   - **anon public** key (ou **publishable key**, `sb_publishable_…`)
   > Nunca use a chave `service_role`/`secret` no app.
5. **Authentication → Sign In / Providers → Email**:
   - Deixe *Email* ligado.
   - Deixe **Allow new users to sign up** ligado: cada pessoa cria a própria conta pelo app (Ajustes → Nuvem → Criar conta).
   - Deixe **Confirm email** ligado: o Supabase manda um e-mail de confirmação e a conta só entra depois que a pessoa clica no link.
   - A **cota por conta** (50 MB de partes + histórico; 100 MB de anexos): passou disso, o servidor recusa o envio e o app avisa. Para mudar os limites, edite `dhenors_quota_bytes()` e `dhenors_files_quota_bytes()` no arquivo e rode de novo.
6. (Depois da Parte 2) **Authentication → URL Configuration**:
   - **Site URL**: cole o endereço do seu site (`https://SEU-USUARIO.github.io/dhenors/`). É para onde o link de confirmação de e-mail leva.
   - **Redirect URLs** → *Add URL*: cole o mesmo endereço (`https://SEU-USUARIO.github.io/dhenors/`). Sem isso, o link de **"Esqueci minha senha"** não volta para o app.
7. (Recomendado) **Envio de e-mails**: o servidor de e-mail padrão do Supabase serve para testes e tem um limite baixo de envios por hora. Para não ficar sem o e-mail de nova senha, configure um SMTP próprio em **Project Settings → Authentication → SMTP Settings** (Resend, Brevo, Gmail etc.). Em **Authentication → Email Templates → Reset Password** dá para traduzir o texto do e-mail.

## Parte 2 — GitHub Pages (onde o site fica)

1. Crie uma conta em **https://github.com** (se não tiver).
2. **New repository** → nome `dhenors` → *Public* (o código não tem dados seus; a chave do Supabase é pública por natureza) → *Create repository*.
3. Envie os arquivos do projeto:
   - **Sem instalar nada:** na página do repositório, *uploading an existing file* → arraste **o conteúdo** da pasta `dhenors` (index.html, css, js, assets, .github, etc.) → *Commit changes*.
     > A pasta `.github` é escondida em alguns sistemas. No Windows, ative "Itens ocultos" no Explorador; no Mac, `Cmd + Shift + .` no Finder.
   - **Com Git:** dentro da pasta do projeto:
     ```bash
     git init && git add . && git commit -m "Dhenors"
     git branch -M main
     git remote add origin https://github.com/SEU-USUARIO/dhenors.git
     git push -u origin main
     ```
4. No repositório: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
5. Aba **Actions**: o fluxo *Publicar no GitHub Pages* roda sozinho (lint → tipos → testes → testes no navegador → build → publicação). Em ~1 minuto o site está em `https://SEU-USUARIO.github.io/dhenors/`.
   - A cada novo envio (commit) na `main`, o site se atualiza sozinho.

### (Opcional) Deixar a nuvem pré-configurada no código

Em `js/config.js`, preencha `url` e `anonKey` com os valores da Parte 1 e envie de novo. Assim, em qualquer aparelho o app já sabe qual é o seu Supabase e só pede e-mail, senha e frase secreta. Se deixar em branco, o app pede a URL e a chave na primeira vez em cada aparelho (Ajustes → Nuvem).

### (Opcional) Manter a nuvem acordada

O plano gratuito do Supabase **pausa** o projeto depois de 7 dias sem uso. O app avisa quando a pausa se aproxima, e o fluxo [`supabase-keepalive.yml`](../.github/workflows/supabase-keepalive.yml) faz uma consulta leve duas vezes por semana. Para ligar: **Settings → Secrets and variables → Actions** → crie `SUPABASE_URL` e `SUPABASE_ANON_KEY`.

## Parte 3 — Entrar no app

Sem login, o app mostra **dados de exemplo** (nada é salvo). Para usar com os seus dados:

**Primeira vez (criar a conta):**

1. Abra o site → **Criar conta** (na tela de entrada ou na barra do topo). Se a URL e a chave não estiverem no `config.js`, o app pede antes (Ajustes → Nuvem → Conectar).
2. Informe e-mail e senha e confirme o e-mail pelo link que o Supabase envia; depois, **Entrar**.
3. **Crie a frase secreta** (mín. 8 caracteres). **Anote em lugar seguro**: sem ela, ninguém recupera os dados da nuvem.
4. Escolha por quanto tempo o aparelho deve **lembrar o login**: sempre, por 30 dias ou só até fechar o app. Fica guardado só o acesso — a sessão e a chave derivada da frase, como chave não exportável (nunca a frase nem os dados). Em aparelho compartilhado, use **"Só até fechar o app"**.
5. Pronto: o botão de nuvem mostra "Sincronizado há X min".

> Tem um backup (`.json`) de versões antigas ou de outro endereço? Depois de entrar, **Ajustes → Restaurar backup**. Usava uma versão até a 3.4 **neste mesmo navegador e endereço**? No primeiro login, o que estava guardado aqui sobe para a nuvem e só então é apagado do navegador.

**Nos outros aparelhos:**

1. Abra o site → **Entrar** (na tela de entrada).
2. Use o mesmo e-mail e senha e digite a **mesma frase secreta**.
3. Os dados aparecem. No celular, use **Adicionar à tela inicial** para virar app.

## Esqueci a senha ou a frase secreta

São duas coisas diferentes:

| | Senha da conta | Frase secreta |
|---|---|---|
| Para que serve | Entrar na conta do Supabase | Criptografar os dados antes de irem para a nuvem |
| Quem conhece | O Supabase | **Só você** (nunca sai do aparelho) |
| Esqueci | **Dá para trocar**: *Entrar na nuvem → Esqueci minha senha* → abra o link do e-mail → crie a senha nova → digite a mesma frase secreta de sempre | **Não tem recuperação**, nem pelo Supabase. É isso que garante que ninguém lê os seus dados |

Esqueceu a frase secreta? Os dados da nuvem **não podem ser abertos** sem ela. Enquanto algum aparelho ainda estiver com o login lembrado, ele continua abrindo os dados: aproveite para fazer um **backup** (Ajustes → Baixar backup) e, se quiser, trocar a frase (Ajustes → Nuvem). Fora isso, só os backups que você já tiver. Por isso, anote a frase em lugar seguro e faça backups de vez em quando.

## Como a sincronização funciona

| Situação | O que acontece |
|---|---|
| Você lança algo | Aparece na tela na hora (fica na memória); ~1,5 s depois vai para a nuvem (criptografado). O botão mostra "1 pendente" até enviar — não feche o app antes disso. |
| Os dados são grandes | O estado é dividido em **blocos** (por coleção e por ano) e só os blocos que mudaram são enviados. |
| Outro aparelho mudou algo | Chega em segundos pelo **Realtime** (WebSocket do Supabase). Sem Realtime, o app confere a cada 1 min com o app aberto. |
| Sem internet | O app **não abre os dados** (eles não ficam no aparelho). Se a conexão cair com o app já aberto, as alterações ficam pendentes na memória e são enviadas quando a internet voltar — **desde que você não feche o app**. |
| Mexeu em dois aparelhos ao mesmo tempo | O app **junta as mudanças item a item**. Se o MESMO campo do mesmo item foi alterado nos dois, vira um **conflito**: Ajustes → Nuvem → Conflitos mostra as duas versões e você escolhe. |
| Errou feio | **Histórico de versões** (Ajustes → Nuvem): volte o estado inteiro para uma cópia de dias atrás. |
| Perdeu o celular | **Aparelhos conectados** (Ajustes → Nuvem): veja onde a conta está aberta e desconecte. Desconectar também **encerra no servidor as sessões de todos os outros aparelhos** (os seus precisam entrar de novo com e-mail e senha); o banco não deixa o aparelho desconectado se "religar" sozinho. Troque a **senha da conta** e, se precisar, a frase secreta: os dados são recriptografados. |
| Apagou todos os dados | A conta fica vazia em todos os aparelhos. As versões anteriores continuam em Nuvem → Histórico de versões (as últimas 30). Para excluir a conta inteira, peça pelo Fale conosco (veja docs/PRIVACIDADE.md). |
| App desatualizado | Se a nuvem tiver dados salvos por uma versão mais nova do Dhenors, este aparelho **não aplica nem envia nada** e fica só leitura até você atualizar (recarregar a página). |

## (Opcional) Lembretes com o app fechado (push)

1. Gere as chaves: `npx web-push generate-vapid-keys`.
2. Coloque a chave **pública** em `js/config.js` (`vapidPublicKey`).
3. Publique a função: `supabase functions deploy daily-reminders --no-verify-jwt` e `supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:voce@exemplo.com`.
4. Ligue as extensões **pg_cron** e **pg_net** (Database → Extensions) e rode o `cron.schedule` comentado no fim do `schema.sql`. Guarde a chave `service_role` no **Vault** do Supabase (`vault.create_secret`, como no exemplo) em vez de colar a chave em texto no comando.
5. No app: Ajustes → Lembretes → **Com o app fechado (push)**.

Privacidade: cada aparelho envia só **quantas** contas vencem em cada dia — nunca valores ou nomes. A função só manda notificações para os serviços de push dos navegadores (Google, Mozilla, Microsoft, Apple), por https.

## Fale conosco por e-mail (Ajustes → Fale conosco)

O formulário de feedback, sugestão e reclamação envia a mensagem para **05henderson.dev@gmail.com** pela Edge Function `send-feedback`, usando o [Resend](https://resend.com) (gratuito até 3 mil e-mails por mês). A chave do Resend fica só no Supabase, nunca no app.

1. Crie uma conta no **Resend** com o e-mail **05henderson.dev@gmail.com**. Com o remetente de teste (`onboarding@resend.dev`), o Resend só entrega para o dono da conta — por isso a conta precisa ser desse e-mail. (Com um domínio próprio verificado no Resend, dá para usar qualquer remetente: defina `FEEDBACK_FROM`.)
2. Em **API Keys**, crie uma chave com permissão de envio e copie (`re_...`).
3. No terminal, na pasta do projeto (com a [CLI do Supabase](https://supabase.com/docs/guides/cli) ligada ao projeto):
   ```bash
   supabase secrets set RESEND_API_KEY=re_SUA_CHAVE FEEDBACK_TO=05henderson.dev@gmail.com
   supabase functions deploy send-feedback --no-verify-jwt
   ```
   `--no-verify-jwt` deixa quem ainda não tem conta (visitante) mandar mensagem também. Não precisa de outro secret: `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem em toda Edge Function e são usados para o limite de envios.
4. **Rode o `supabase/schema.sql` de novo**: ele cria a tabela `dhenors_feedback_log`, onde a função conta os envios. Sem ela, a função recusa as mensagens (resposta 503) em vez de enviar sem limite.
5. Se o site não estiver em `https://hstark0.github.io`, informe o endereço: `supabase secrets set ALLOWED_ORIGINS=https://seu-site.com` (vários separados por vírgula). Pedidos sem o cabeçalho `Origin` ou de outros sites são recusados.
6. Mudou o código da função? Publique de novo: `supabase functions deploy send-feedback --no-verify-jwt`.

**Como chega:** assunto `[NOVO FEEDBACK] - Interface / Design - Maria Souza` (ou `[NOVA SUGESTÃO]`, `[NOVA RECLAMAÇÃO]`), corpo em HTML com nome, e-mail, área, tipo, nota, mensagem, a descrição do problema (nas reclamações), versão do app e aparelho, e o anexo junto. **Responder o e-mail responde direto para quem escreveu.**

**Proteções:**

- só aceita pedidos do site (cabeçalho `Origin` obrigatório e da lista `ALLOWED_ORIGINS`);
- lê o corpo com limite real de 8 MB e recusa JSON inválido (400);
- confere tudo de novo com as mesmas regras do app (inclusive nome e sobrenome);
- anexo só imagem (PNG, JPG, WEBP, GIF) ou PDF de até 5 MB, com a **assinatura do arquivo conferida** e a extensão do nome trocada pela do tipo real;
- ignora robôs (campo-isca);
- **limite guardado no banco** (vale para todas as instâncias da função): até 30 mensagens por hora no total, 5 por hora por e-mail e 5 a cada 10 minutos por IP. Só *hashes* SHA-256 do IP e do e-mail são guardados, e os registros com mais de 1 dia são apagados.

## Segurança, em resumo

- **Criptografia de ponta a ponta:** AES-256-GCM com chave derivada da sua frase (PBKDF2-SHA256, 600 mil iterações). O Supabase só guarda blocos ilegíveis.
- **Integridade:** cada bloco é amarrado (AAD do AES-GCM) à conta, ao nome e à versão, e o hash é conferido depois de abrir. O servidor não consegue trocar blocos de lugar nem devolver um índice antigo como se fosse novo. Blocos de versões anteriores do app são recifrados no próximo envio.
- **Isolamento:** as regras do banco (RLS) só deixam cada conta ler e alterar as próprias linhas e a própria pasta de anexos; tamanhos máximos, limites de aparelhos/push e a **cota por conta** (dados e anexos) evitam abuso.
- **Login lembrado:** quem tem acesso ao perfil do navegador usa a conta enquanto o login estiver lembrado. Em aparelho compartilhado, escolha "Só até fechar o app".
- **Contas antigas** (frase criada com 310 mil iterações): na próxima vez que você digitar a frase, tudo é recifrado com 600 mil; os outros aparelhos pedem a frase (a mesma) uma vez.
- **Sem dependências externas:** o app fala com o Supabase pela API REST e pelo WebSocket oficiais, sem bibliotecas de terceiros.
- Detalhes em [SEGURANCA.md](SEGURANCA.md) e [PRIVACIDADE.md](PRIVACIDADE.md).
