# Política de privacidade do Dhenors

*Última atualização: 18/10/2026 (versão 3.5)*

O Dhenors é um app de finanças pessoais. Esta política explica, em linguagem simples, o que acontece com os seus dados no site público (https://hstark0.github.io/dhenors/). Uma versão curta aparece no app em **Ajustes → Privacidade**.

## 1. Quem é o responsável (controlador)

O controlador dos dados é **o desenvolvedor do Dhenors**, que mantém o site e o projeto Supabase onde as contas ficam.

Contato: **05henderson.dev@gmail.com** ou, no app, **Ajustes → Fale conosco**.

> Se você hospedar uma cópia do Dhenors com o seu próprio projeto Supabase, quem controla os dados dessa cópia é você.

## 2. O que o Dhenors guarda e onde

Os dados ficam **na nuvem** (Supabase), não no aparelho. Para usar com os seus dados, você **cria uma conta** pelo app (e-mail e senha, com confirmação por e-mail) e uma **frase secreta**. Sem login, o app mostra só dados de exemplo.

**No servidor (Supabase):**

| O quê | Como fica |
|---|---|
| Seus dados financeiros (salário, contas, cartões, metas, investimentos, plantões, configurações) e o histórico das últimas 30 versões | **Criptografados no seu aparelho** com a frase secreta antes de sair. O servidor e o desenvolvedor só veem blocos ilegíveis. |
| Anexos (fotos de comprovantes, boletos) | **Criptografados no aparelho**, cada um com chave própria, num armazenamento privado. |
| E-mail da conta e senha (esta em *hash*, pelo Supabase Auth) | Necessários para entrar. |
| Lista de aparelhos (nome, navegador, versão do app, último acesso) | Em texto, para você ver e desconectar aparelhos. |
| Lembretes push, se você ligar | Quantas contas vencem em cada dia e a inscrição de push do navegador — **sem valores nem nomes**. |

O Supabase também registra dados técnicos de acesso (como IP e horário) nos registros do serviço, como qualquer servidor.

**No seu navegador:** só o **login lembrado** — a sessão da conta e a chave derivada da frase (guardada como chave **não exportável**: a página usa, mas não consegue ler) — e preferências de aparência. Nenhum dado financeiro ou anexo fica salvo no aparelho. Atenção: **quem tiver acesso ao seu perfil do navegador consegue usar a sua conta enquanto o login estiver lembrado**. Em aparelho compartilhado, escolha **"Só até fechar o app"** ao entrar e saia da conta ao terminar.

A frase secreta **nunca** é enviada nem guardada. Ninguém — nem o desenvolvedor — consegue recuperá-la ou ler os seus dados sem ela.

Não há **anúncios, rastreadores, cookies de terceiros nem análise de uso**.

## 3. Outros envios

| Recurso | O que é enviado | Para onde |
|---|---|---|
| Lembretes push (opcional) | A notificação ("Você tem 2 contas amanhã") | Serviço de push do navegador (Google, Apple, Mozilla, Microsoft) |
| Atualizar taxas | Nada sobre você — só a consulta das séries públicas (CDI, Selic, IPCA, IGP-M) | Banco Central do Brasil (api.bcb.gov.br) |
| Cotações | Os **códigos** dos seus ativos (ex.: PETR4), sem quantidades ou valores | brapi.dev |
| Voz | O áudio do comando de voz | Reconhecimento de fala do navegador (pode ser processado pelo fornecedor do navegador) |
| Fale conosco | Nome, e-mail, mensagem, anexo (se houver), versão do app, tipo de aparelho e tela em que estava | E-mail para o desenvolvedor, pelo serviço Resend. Nenhum dado financeiro vai junto. Para limitar abusos, o servidor guarda por até 1 dia só um *hash* do IP e do e-mail. |

Os arquivos que você importa (extratos, faturas, holerites) são lidos **no aparelho**; o que entra nos seus dados vai para a nuvem criptografado, como o resto.

## 4. Bases legais (LGPD)

- **Execução do serviço que você pediu** (art. 7º, V): criar a conta, guardar e sincronizar seus próprios dados.
- **Consentimento** (art. 7º, I): lembretes push, cotações, voz e Fale conosco só funcionam quando você usa ou liga, e podem ser desligados.
- **Legítimo interesse** (art. 7º, IX): registros técnicos e limites contra abuso (por exemplo, o limite de envios do Fale conosco).

## 5. Seus direitos (LGPD, art. 18)

Você pode pedir confirmação de tratamento, acesso, correção, portabilidade, eliminação, informação sobre compartilhamento e revogação do consentimento.

- **Acesso e portabilidade:** Ajustes → Dados → Baixar backup (JSON, opcionalmente com senha) e planilhas.
- **Correção:** edite qualquer lançamento no app.
- **Apagar os dados:** Ajustes → **Apagar todos os dados** zera os dados da conta em todos os aparelhos. As versões anteriores (cifradas) continuam no histórico até serem substituídas.
- **Excluir a conta** (e-mail, histórico, anexos, aparelhos — tudo): peça pelo **Ajustes → Fale conosco** ou por **05henderson.dev@gmail.com**, a partir do e-mail da conta. O pedido é atendido em prazo razoável, e você recebe uma confirmação.
- **Revogação:** desligue os lembretes push quando quiser; para parar de usar a nuvem, peça a exclusão da conta.

Dúvidas ou pedidos sobre privacidade: os mesmos contatos. Você também pode reclamar à ANPD (Autoridade Nacional de Proteção de Dados).

## 6. Retenção

Os dados da conta ficam enquanto a conta existir. O histórico guarda até 30 versões. Os registros do limite do Fale conosco são apagados depois de 1 dia; os e-mails do Fale conosco ficam na caixa do desenvolvedor pelo tempo necessário para responder. O registro de erros fica só na memória do app (até 100 entradas).

## 7. Segurança

Detalhes técnicos em [SEGURANCA.md](SEGURANCA.md). Resumo: AES-256-GCM, PBKDF2 com 600 mil iterações, regras de acesso por conta (RLS) no banco, CSP no site e nenhuma biblioteca de terceiros no app. Nenhum sistema é 100% seguro; a sua frase secreta forte é parte essencial da proteção.

## 8. Crianças

O app não é direcionado a menores de 13 anos.

## 9. Mudanças

Mudanças nesta política aparecem neste arquivo, com a data no topo.
