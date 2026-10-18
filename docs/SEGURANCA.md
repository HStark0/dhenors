# Segurança do Dhenors

Este documento explica **como os dados são protegidos**, o que o app **não** protege e como relatar um problema. Vale para a versão 3.5 em diante.

## Modelo de ameaça (em uma frase)

O Dhenors protege seus dados financeiros contra **quem tem acesso ao servidor** (Supabase, GitHub, inclusive quem administra o projeto) — desde que você use uma frase secreta forte. Ele **não** protege contra um aparelho já comprometido (vírus, extensão maliciosa) nem contra **quem usa o seu navegador enquanto o login está lembrado**.

## Onde os dados ficam

Os dados ficam **só na nuvem**, no projeto Supabase do desenvolvedor do Dhenors (o site público usa esse projeto; cada pessoa cria a própria conta pelo app). Antes de sair do aparelho, tudo o que tem valores é **criptografado com a sua frase secreta**. Com o app aberto, os dados decifrados existem só na memória da página.

| Lugar | O que fica | Proteção |
|---|---|---|
| Supabase — tabelas de dados | Índice, blocos de dados e histórico de versões (últimas 30) | **Criptografados no aparelho** (AES-256-GCM). O servidor nunca recebe a frase nem a chave. |
| Supabase — Storage (`dhenors-files`) | Anexos (fotos de comprovantes, boletos) | Cada arquivo é cifrado no aparelho com uma **chave própria**, guardada dentro dos dados cifrados. Bucket privado. |
| Supabase — conta | E-mail e senha da conta (a senha fica com o Supabase Auth, em hash) | Gerenciado pelo Supabase. |
| Supabase — aparelhos | Nome do aparelho, navegador, versão do app, data do último acesso | Texto puro (necessário para listar e desconectar). |
| Supabase — push | Quantas contas vencem por dia e a inscrição de push do navegador | Texto puro, **sem valores nem nomes**. |
| Navegador | O **login lembrado**: a sessão do Supabase e a chave derivada da frase. Também preferências de aparência | Veja abaixo. Nenhum dado financeiro, cópia ou anexo fica no navegador. |

## O que fica no navegador (login lembrado)

Ao entrar, você escolhe por quanto tempo este aparelho lembra o login:

- **Sempre** ou **30 dias**: a sessão do Supabase fica no `localStorage` e a chave da frase fica no IndexedDB `dhenors-auth` como `CryptoKey` **não exportável** — o código da página consegue usá-la para cifrar e decifrar, mas não consegue ler os bytes da chave.
- **Só até fechar o app**: a sessão e a chave ficam no `sessionStorage` e somem ao fechar o app/aba.

A frase secreta em si **nunca** é guardada. "Sair da conta" apaga a sessão e a chave deste aparelho.

**Limite importante:** quem tiver acesso ao seu perfil do navegador (o computador destravado, a mesma conta do sistema) **consegue usar a sua conta enquanto o login estiver lembrado** — não há mais PIN, senha do app nem biometria. Por isso, em aparelho compartilhado ou de trabalho, escolha **"Só até fechar o app"** e saia da conta ao terminar.

## Criptografia e integridade

- **AES-256-GCM** com chave derivada da **frase secreta** (PBKDF2-SHA256, 600 mil iterações). Cada bloco tem IV próprio.
- **Integridade**: cada bloco é cifrado com AAD `usuário|nome|rev` e o índice com `usuário|manifest|versão`; depois de abrir, o hash de cada bloco é conferido com o índice. O app recusa um índice com versão menor do que a que já conhecia (servidor tentando "voltar no tempo"). Blocos antigos, sem AAD, ainda abrem e são recifrados no próximo envio.
- A frase **não pode ser recuperada** por ninguém, nem pelo desenvolvedor. Trocar a frase (Ajustes → Nuvem) recriptografa tudo. Contas antigas (310 mil iterações) são recifradas com 600 mil na próxima vez que a frase é digitada.
- O que a criptografia **não** esconde: que a conta existe, o e-mail, quando e de quais aparelhos ela é usada, o tamanho aproximado dos dados e a quantidade de contas por dia (se você ligar os lembretes push).

## Proteções no servidor

- **RLS** (Row Level Security) em todas as tabelas: cada conta só lê e escreve as próprias linhas. No Storage, cada conta só acessa a própria pasta.
- **Limites contra abuso**: tamanho máximo por linha; **cota por conta** de 50 MB (dados + histórico) e de 100 MB de anexos (10 MB por arquivo); tamanho máximo dos campos de aparelhos e push; no máximo 20 aparelhos e 10 inscrições de push por conta.
- **Cadastro com confirmação por e-mail**: a conta só entra depois que a pessoa clica no link.
- **Aparelhos conectados**: "Desconectar" marca o aparelho e **encerra no servidor as sessões de todos os outros aparelhos** (o Supabase não revoga uma sessão específica pela API pública). Um gatilho no banco impede que o aparelho desconectado volte `revoked` para falso; para voltar, é preciso entrar de novo com e-mail e senha.
- **Lembretes push**: a função do servidor só envia para os serviços de push conhecidos dos navegadores (Google, Mozilla, Microsoft, Apple), por https.
- **Fale conosco**: a função `send-feedback` só aceita pedidos vindos do site, limita os envios (gravando só *hashes* do IP e do e-mail, apagados depois de 1 dia), confere o tipo real do anexo e guarda a chave do serviço de e-mail só no servidor.

## Backups

- O arquivo de backup pode ser **criptografado com senha** (mesma criptografia). Sem senha, é JSON legível — guarde com cuidado.
- Ao restaurar, o arquivo é **validado e limpo** (`sanitizeState`) antes de entrar: campos estranhos são descartados.

## Proteções do site

- **Content Security Policy**: scripts só do próprio site; conexões só com o próprio site, `*.supabase.co`, `api.bcb.gov.br` e `brapi.dev`; `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.
- **Sem bibliotecas de terceiros** no app, sem CDN, sem anúncios, sem rastreadores.
- Todo HTML é montado com um *template* que **escapa** o conteúdo (`ui/dom.js`), evitando injeção de código pelos textos que você digita ou importa.
- O **service worker** só cuida das notificações push e da instalação do app; não guarda arquivos nem dados.
- O arquivo único `dist/dhenors.html` (gerado por `npm run build`) **não** é publicado no site: ele usa uma CSP mais fraca e fica só como artefato do GitHub Actions.

## Registro de erros

Erros inesperados ficam num registro **na memória** enquanto o app está aberto (até 100, sem valores dos seus dados). Você pode exportar em Ajustes → Dados → Registro de erros e anexar numa issue. Nada é enviado sozinho.

## Relatar um problema de segurança

Use *Security → Report a vulnerability* no GitHub (https://github.com/HStark0/dhenors/security) ou escreva para **05henderson.dev@gmail.com**. Se abrir uma *issue* em https://github.com/HStark0/dhenors/issues, **não inclua detalhes de exploração** — peça um contato privado. Responderemos assim que possível.
