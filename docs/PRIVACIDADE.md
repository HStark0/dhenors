# Política de privacidade do Dhenors

*Última atualização: 15/10/2026*

O Dhenors é um app de finanças pessoais que **funciona no seu aparelho**. Esta política explica, em linguagem simples, o que acontece com os seus dados. A mesma versão curta aparece no app em **Ajustes → Privacidade**.

## 1. O que o Dhenors guarda

Somente o que **você** digita ou importa: salário, contas, cartões, metas, investimentos, plantões, anexos (fotos de comprovantes) e configurações. Tudo fica no **armazenamento do navegador** (IndexedDB) do seu aparelho.

Não há cadastro obrigatório, **anúncios, rastreadores, cookies de terceiros nem análise de uso**.

## 2. Quando algo sai do aparelho

Somente quando **você liga** um destes recursos:

| Recurso | O que é enviado | Para onde |
|---|---|---|
| Nuvem | Seus dados **criptografados no aparelho** (ilegíveis para o servidor), e-mail da conta, nome e navegador dos aparelhos conectados | O projeto Supabase **que você criou** |
| Lembretes push | Quantas contas vencem em cada dia (sem valores ou nomes) e a inscrição de push do navegador | Seu Supabase e o serviço de push do navegador (Google, Apple, Mozilla) |
| Atualizar taxas | Nada sobre você — só a consulta das séries públicas (CDI, Selic, IPCA, IGP-M) | Banco Central do Brasil (api.bcb.gov.br) |
| Cotações | Os **códigos** dos seus ativos (ex.: PETR4), sem quantidades ou valores | brapi.dev |
| Voz | O áudio do comando de voz | Reconhecimento de fala do navegador (pode ser processado pelo fornecedor do navegador) |
Os arquivos que você importa (extratos, faturas, holerites) e os que chegam pelo "Compartilhar" do celular são lidos **no aparelho**.

## 3. Bases legais (LGPD)

- **Execução do serviço que você pediu** (art. 7º, V): guardar e sincronizar seus próprios dados.
- **Consentimento** (art. 7º, I): cada recurso opcional acima fica desligado até você ligar, e pode ser desligado a qualquer momento.

## 4. Seus direitos

- **Acesso e portabilidade:** Ajustes → Dados → Baixar backup (JSON, opcionalmente com senha) e planilhas.
- **Correção:** edite qualquer lançamento no app.
- **Eliminação:** Ajustes → Dados → Apagar todos os dados (aparelho). Na nuvem: apague a conta no painel do Supabase (*Authentication → Users*) ou as linhas das tabelas `dhenors_*`.
- **Revogação:** desligue a nuvem ou os lembretes quando quiser.

## 5. Retenção

Os dados ficam enquanto você mantiver. O histórico de versões da nuvem guarda até 30 cópias. O registro de erros local guarda até 100 entradas.

## 6. Segurança

Detalhes técnicos em [SEGURANCA.md](SEGURANCA.md). Resumo: AES-256-GCM, PBKDF2 com 600 mil iterações, RLS no banco, CSP no site e nenhuma biblioteca de terceiros.

## 7. Crianças

O app não é direcionado a menores de 13 anos.

## 8. Contato

Dúvidas sobre privacidade: abra uma *issue* em https://github.com/HStark0/dhenors/issues.
