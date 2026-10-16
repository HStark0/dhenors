# Segurança do Dhenors

Este documento explica **como os dados são protegidos**, o que o app **não** protege e como relatar um problema.

## Modelo de ameaça (em uma frase)

O Dhenors protege seus dados contra **quem tem acesso ao servidor** (Supabase, GitHub) e contra **quem copia o armazenamento do navegador** — desde que você use uma senha forte. Ele **não** protege contra um aparelho já comprometido (vírus, extensão maliciosa, alguém com o app destravado na mão).

## Onde os dados ficam

| Lugar | O que fica | Proteção |
|---|---|---|
| IndexedDB do navegador | Todos os dados e os anexos (fotos de comprovantes) | Sem bloqueio: texto puro, protegido só pelo sistema/navegador. Com PIN ou senha: **AES-256-GCM**. |
| Supabase (opcional) | Blocos de dados, índice, histórico de versões | **Criptografados no aparelho** antes de sair, com a frase secreta. O servidor nunca vê a chave. |
| Supabase — aparelhos | Nome do aparelho, navegador, data do último acesso | Texto puro (necessário para listar e desconectar). |
| Supabase — push | Quantas contas vencem por dia, a inscrição de push do navegador | Texto puro, **sem valores nem nomes**. |

## Bloqueio do app (PIN ou senha)

- Chave derivada com **PBKDF2-SHA256, 600 mil iterações** e sal aleatório de 16 bytes. Dados antigos com 250 mil iterações são atualizados sozinhos no próximo desbloqueio.
- **PIN** (4–8 números) é prático, mas tem poucas combinações: quem copiar o IndexedDB consegue testar todas fora do app. O app mostra esse aviso e recomenda a **senha** (8+ caracteres, letras e números).
- Dentro do app, erros seguidos geram **espera crescente** (30 s, 1 min, 2 min…) e, se você quiser, **apagam os dados deste aparelho** após 10 ou 20 tentativas (a nuvem e os backups não são afetados). Apagar leva TUDO: estado, anexos, cópias da nuvem (base, conflitos, sessão, chave lembrada) e a chave da biometria; a chave sai da memória e nada mais é gravado até a página recarregar.
- **Trocar ou tirar o PIN** grava estado, itens protegidos e anexos já cifrados com a chave nova numa única transação: ou tudo muda, ou nada muda.
- Dados salvos por uma versão **mais nova** do app (no aparelho, na nuvem ou num backup) nunca são trocados por um estado vazio: o app avisa e fica só leitura até ser atualizado.
- **Biometria** (digital/Face ID) usa **WebAuthn com a extensão PRF**: a chave do app é cifrada com um segredo que só o autenticador do aparelho gera. Sem suporte a PRF, a opção não aparece. Nada biométrico sai do aparelho.
- **Bloqueio automático** após 0, 1, 5 ou 30 minutos fora do app.

> Argon2 seria mais resistente que PBKDF2 contra placas de vídeo, mas não existe no WebCrypto e exigiria uma biblioteca externa (contra a regra "sem dependências"). A compensação foi subir as iterações e oferecer senha alfanumérica.

## Nuvem

- **AES-256-GCM** com chave derivada da **frase secreta** (PBKDF2-SHA256, 600 mil iterações). Cada bloco tem IV próprio.
- **Integridade**: cada bloco é cifrado com AAD `usuário|nome|rev` e o índice com `usuário|manifest|versão`; depois de abrir, o hash de cada bloco é conferido com o índice. O app recusa um índice com versão menor do que a que já conhecia (servidor tentando "voltar no tempo"). Blocos antigos, sem AAD, ainda abrem e são recifrados no próximo envio.
- A frase **não pode ser recuperada** por ninguém. Trocar a frase (Ajustes → Nuvem) recriptografa tudo. Contas antigas (310 mil iterações) são recifradas com 600 mil na próxima vez que a frase é digitada.
- **Lembrar neste aparelho**: só na sessão, 30 dias ou sempre. Com **senha** no app, a chave lembrada fica cifrada por ela. Com **PIN numérico**, a chave fica **só na memória** (a frase é pedida de novo ao reabrir o app): um PIN de 4–8 números pode ser testado inteiro fora do app, e isso não pode entregar a chave da nuvem. Sem PIN nem senha, a chave fica no navegador.
- **RLS** (Row Level Security) em todas as tabelas: cada conta só lê e escreve as próprias linhas. Limites de tamanho por linha e uma **cota por conta** (50 MB) evitam abuso do espaço. Recomendado: **desligar o cadastro aberto** no Supabase depois de criar a sua conta (docs/NUVEM.md).
- **Aparelhos conectados**: "Desconectar" marca o aparelho e **encerra no servidor as sessões de todos os outros aparelhos** (o Supabase não revoga uma sessão específica pela API pública). Um gatilho no banco impede que o aparelho desconectado volte `revoked` para falso; para voltar, é preciso entrar de novo com e-mail e senha.
- **"Apagar todos os dados"** desliga a nuvem deste aparelho antes de apagar: o estado vazio nunca é enviado aos outros aparelhos.
- **Open Finance** (opcional): a função confere que cada conexão/conta da Pluggy pertence ao usuário logado antes de devolver qualquer dado.

## Backups

- O arquivo de backup pode ser **criptografado com senha** (mesma criptografia). Sem senha, é JSON legível — guarde com cuidado.
- Ao restaurar, o arquivo é **validado e limpo** (`sanitizeState`) antes de entrar: campos estranhos são descartados.

## Proteções do site

- **Content Security Policy**: scripts só do próprio site; conexões só com o próprio site, `*.supabase.co`, `api.bcb.gov.br` e `brapi.dev`; `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.
- **Sem bibliotecas de terceiros** no app, sem CDN, sem anúncios, sem rastreadores.
- Todo HTML é montado com um *template* que **escapa** o conteúdo (`ui/dom.js`), evitando injeção de código pelos textos que você digita ou importa.
- **Service worker** só guarda arquivos do próprio app e nunca dados.

## Registro de erros

Erros inesperados ficam num registro **local** (até 100, sem valores dos seus dados; com PIN, cifrado). Você pode exportar em Ajustes → Dados → Registro de erros e anexar numa issue. Nada é enviado sozinho.

## Relatar um problema de segurança

Abra uma *issue* em https://github.com/HStark0/dhenors/issues **sem detalhes de exploração** e peça um contato privado, ou use *Security → Report a vulnerability* no GitHub. Responderemos o quanto antes.
