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
4. Menu → **Project Settings → API** (ou o botão **Connect** no topo) e copie:
   - **Project URL** — algo como `https://abcdefghijk.supabase.co`
   - **anon public** key (ou **publishable key**, `sb_publishable_…`)
   > Nunca use a chave `service_role`/`secret` no app.
5. **Authentication → Sign In / Providers → Email**:
   - Deixe *Email* ligado.
   - **Confirm email**: pode deixar ligado (mais seguro: você confirma pelo e-mail uma vez) ou desligar (entra direto).
6. (Depois da Parte 2) **Authentication → URL Configuration → Site URL**: cole o endereço do seu site (`https://SEU-USUARIO.github.io/dhenors/`). É para onde o link de confirmação de e-mail leva.

## Parte 2 — GitHub Pages (onde o site fica)

1. Crie uma conta em **https://github.com** (se não tiver).
2. **New repository** → nome `dhenors` → *Public* (o código não tem dados seus; a chave do Supabase é pública por natureza) → *Create repository*.
3. Envie os arquivos do projeto:
   - **Sem instalar nada:** na página do repositório, *uploading an existing file* → arraste **o conteúdo** da pasta `dhenors` (index.html, css, js, assets, .github, etc.) → *Commit changes*.
     > A pasta `.github` é escondida em alguns sistemas. No Windows, ative "Itens ocultos" no Explorador; no Mac, `Cmd + Shift + .` no Finder.
   - **Com Git:** dentro da pasta do projeto:
     ```bash
     git init && git add . && git commit -m "Dhenors 3.2"
     git branch -M main
     git remote add origin https://github.com/SEU-USUARIO/dhenors.git
     git push -u origin main
     ```
4. No repositório: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
5. Aba **Actions**: o fluxo *Publicar no GitHub Pages* roda sozinho (testes → build → publicação). Em ~1 minuto o site está em `https://SEU-USUARIO.github.io/dhenors/`.
   - A cada novo envio (commit) na `main`, o site se atualiza sozinho.

### (Opcional) Deixar a nuvem pré-configurada no código

Em `js/config.js`, preencha `url` e `anonKey` com os valores da Parte 1 e envie de novo. Assim, em qualquer aparelho o app já sabe qual é o seu Supabase e só pede e-mail, senha e frase secreta. Se deixar em branco, o app pede a URL e a chave na primeira vez em cada aparelho (Ajustes → Nuvem).

## Parte 3 — Ligar a nuvem no app

**No primeiro aparelho** (onde estão seus dados hoje):

1. Abra o site → **Ajustes → Nuvem → Conectar**.
2. Cole a URL e a chave (se não estiverem no `config.js`).
3. **Criar conta** com e-mail e senha (confirme o e-mail se o Supabase pedir e depois **Entrar**).
4. **Crie a frase secreta** (mín. 8 caracteres). **Anote em lugar seguro**: sem ela, ninguém recupera os dados da nuvem.
5. Pronto: o ícone de nuvem no topo fica verde ("Sincronizado").

> Seus dados estão hoje em outro endereço (ex.: o arquivo `dhenors.html` ou `localhost`)? Cada endereço tem o próprio armazenamento. Lá, faça **Ajustes → Baixar backup**; no site novo, **Ajustes → Restaurar** e depois ligue a nuvem.

**Nos outros aparelhos:**

1. Abra o site → na tela de boas-vindas, **Já uso em outro aparelho** (ou Ajustes → Nuvem).
2. Entre com o mesmo e-mail e senha e digite a **mesma frase secreta**.
3. Os dados aparecem. No celular, use **Adicionar à tela inicial** para virar app.

## Como a sincronização funciona

| Situação | O que acontece |
|---|---|
| Você lança algo | Salva no aparelho na hora; ~1,5 s depois vai para a nuvem (criptografado). |
| Abre o app / volta para a aba / a cada 1 min | Busca a versão mais nova da nuvem. |
| Sem internet | Continua funcionando; o ícone fica cinza e envia quando a conexão voltar. |
| Mexeu em dois aparelhos ao mesmo tempo | O app **junta as mudanças item a item** (contas novas dos dois lados ficam; o que foi apagado de um lado sai). Se o mesmo item foi alterado nos dois, fica a versão da nuvem. |
| PIN do app | Continua valendo em cada aparelho, separado da frase secreta da nuvem. |

## Segurança, em resumo

- **Criptografia de ponta a ponta:** AES-256-GCM com chave derivada da sua frase (PBKDF2-SHA256, 310 mil iterações). O Supabase só guarda um bloco ilegível.
- **Isolamento:** as regras do banco (RLS) só deixam cada conta ler e alterar a própria linha.
- **Sem dependências externas:** o app fala com o Supabase pela API REST oficial, sem bibliotecas de terceiros.
- O plano gratuito do Supabase pausa projetos sem uso por 1 semana; basta abrir o painel do Supabase e clicar em *Restore* (seus dados continuam lá). Usando o app regularmente, isso não acontece.
