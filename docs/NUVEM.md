# Dhenors na nuvem — passo a passo

Ao final você terá:

- o site no ar em **https://SEU-USUARIO.github.io/dhenors/** (abre no celular, no trabalho, em qualquer navegador);
- os dados salvos na sua conta do **Supabase**, **criptografados** com uma frase secreta que só você sabe;
- tudo funcionando **offline** também: o app salva no aparelho na hora e envia para a nuvem quando tiver internet.

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
   - Cria as tabelas `dhenors_state` (índice), `dhenors_chunks` (dados em blocos), `dhenors_versions` (histórico de versões), `dhenors_devices` (aparelhos conectados) e `dhenors_push` (lembretes), todas com RLS (cada conta só vê o que é dela) e ligadas ao **Realtime**.
   - Já usava a versão 3? Rode o arquivo de novo: ele só cria o que falta e mantém seus dados.
4. Menu → **Project Settings → API** (ou o botão **Connect** no topo) e copie:
   - **Project URL** — algo como `https://abcdefghijk.supabase.co`
   - **anon public** key (ou **publishable key**, `sb_publishable_…`)
   > Nunca use a chave `service_role`/`secret` no app.
5. **Authentication → Sign In / Providers → Email**:
   - Deixe *Email* ligado.
   - **Confirm email**: pode deixar ligado (mais seguro: você confirma pelo e-mail uma vez) ou desligar (entra direto).
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

## Parte 3 — Ligar a nuvem no app

**No primeiro aparelho** (onde estão seus dados hoje):

1. Abra o site → **Ajustes → Nuvem → Conectar**.
2. Cole a URL e a chave (se não estiverem no `config.js`).
3. **Criar conta** com e-mail e senha (confirme o e-mail se o Supabase pedir e depois **Entrar**).
4. **Crie a frase secreta** (mín. 8 caracteres). **Anote em lugar seguro**: sem ela, ninguém recupera os dados da nuvem.
5. Escolha se o aparelho deve **lembrar a frase**: só nesta sessão, por 30 dias ou sempre (guardada cifrada pelo PIN/senha do app, se houver).
6. Pronto: o botão de nuvem mostra "Sincronizado há X min".

> Seus dados estão hoje em outro endereço (ex.: o arquivo `dhenors.html` ou `localhost`)? Cada endereço tem o próprio armazenamento. Lá, faça **Ajustes → Baixar backup**; no site novo, **Ajustes → Restaurar** e depois ligue a nuvem.

**Nos outros aparelhos:**

1. Abra o site → na tela de boas-vindas, **Já uso em outro aparelho** (ou Ajustes → Nuvem).
2. Entre com o mesmo e-mail e senha e digite a **mesma frase secreta**.
3. Os dados aparecem. No celular, use **Adicionar à tela inicial** para virar app.

## Esqueci a senha ou a frase secreta

São duas coisas diferentes:

| | Senha da conta | Frase secreta |
|---|---|---|
| Para que serve | Entrar na conta do Supabase | Criptografar os dados antes de irem para a nuvem |
| Quem conhece | O Supabase | **Só você** (nunca sai do aparelho) |
| Esqueci | **Dá para trocar**: *Entrar na nuvem → Esqueci minha senha* → abra o link do e-mail → crie a senha nova → digite a mesma frase secreta de sempre | **Não tem recuperação**, nem pelo Supabase. É isso que garante que ninguém lê os seus dados |

Esqueceu a frase secreta? Os dados continuam a salvo **nos aparelhos que já estão ligados** e nos **backups** (Ajustes → Baixar backup). Por isso, anote a frase em lugar seguro e faça backups de vez em quando.

## Como a sincronização funciona

| Situação | O que acontece |
|---|---|
| Você lança algo | Salva no aparelho na hora; ~1,5 s depois vai para a nuvem (criptografado). O botão mostra "1 pendente" até enviar. |
| Os dados são grandes | O estado é dividido em **blocos** (por coleção e por ano) e só os blocos que mudaram são enviados. |
| Outro aparelho mudou algo | Chega em segundos pelo **Realtime** (WebSocket do Supabase). Sem Realtime, o app confere a cada 1 min com o app aberto. |
| Sem internet | Continua funcionando; o botão mostra "Offline" e envia quando a conexão voltar. |
| Mexeu em dois aparelhos ao mesmo tempo | O app **junta as mudanças item a item**. Se o MESMO campo do mesmo item foi alterado nos dois, vira um **conflito**: Ajustes → Nuvem → Conflitos mostra as duas versões e você escolhe. |
| Errou feio | **Histórico de versões** (Ajustes → Nuvem): volte o estado inteiro para uma cópia de dias atrás. |
| Perdeu o celular | **Aparelhos conectados** (Ajustes → Nuvem): veja onde a conta está aberta e desconecte. Troque a frase secreta se precisar: os dados são recriptografados. |

## (Opcional) Lembretes com o app fechado (push)

1. Gere as chaves: `npx web-push generate-vapid-keys`.
2. Coloque a chave **pública** em `js/config.js` (`vapidPublicKey`).
3. Publique a função: `supabase functions deploy daily-reminders --no-verify-jwt` e `supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:voce@exemplo.com`.
4. Ligue as extensões **pg_cron** e **pg_net** (Database → Extensions) e rode o `cron.schedule` comentado no fim do `schema.sql`.
5. No app: Ajustes → Lembretes → **Com o app fechado (push)**.

Privacidade: cada aparelho envia só **quantas** contas vencem em cada dia — nunca valores ou nomes.

## (Opcional) Open Finance pela Pluggy

Vai contra o princípio "nada sai do aparelho", por isso fica **desligado** até você ligar.

1. Crie uma conta em **pluggy.ai** e pegue `CLIENT_ID` e `CLIENT_SECRET`.
2. `supabase functions deploy open-finance` e `supabase secrets set PLUGGY_CLIENT_ID=... PLUGGY_CLIENT_SECRET=...`.
3. No app: Ajustes → Dados → **Open Finance** → Ligar → Conectar banco. As transações abrem na tela de importação (com conciliação): nada é lançado sem a sua revisão.

## Segurança, em resumo

- **Criptografia de ponta a ponta:** AES-256-GCM com chave derivada da sua frase (PBKDF2-SHA256, 600 mil iterações). O Supabase só guarda blocos ilegíveis.
- **Isolamento:** as regras do banco (RLS) só deixam cada conta ler e alterar as próprias linhas; tamanhos máximos evitam abuso.
- **Sem dependências externas:** o app fala com o Supabase pela API REST e pelo WebSocket oficiais, sem bibliotecas de terceiros.
- Detalhes em [SEGURANCA.md](SEGURANCA.md) e [PRIVACIDADE.md](PRIVACIDADE.md).
