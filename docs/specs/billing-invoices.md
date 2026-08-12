# Histórico de faturas

**Status:** entregue
**Decisões relacionadas:** DEC-083 · compõe com DEC-054, DEC-057, DEC-059, DEC-061, DEC-082

## Problema

Quem paga pela empresa não tem como saber o que já pagou. A tela de conta mostra o
estado **de agora** — ativa, cancelada, pagamento pendente — e nada do que veio
antes. Uma cobrança contestada, um reembolso, um fechamento contábil e um
`payment_failed` que ninguém viu passar são todos a mesma pergunta sem resposta:
"o que foi cobrado, quando, e deu certo?".

Hoje a única testemunha disso é o painel do provider, que nem todo mundo que
precisa da informação pode acessar — e que some no dia em que trocarmos de
provider.

## Escopo

**Entra:**

- Projeção local de faturas, alimentada pelo webhook: pagas e falhas.
- Arquivo do PDF da fatura em object storage, na chegada do evento.
- `GET /billing/invoices` e `GET /billing/invoices/:id/pdf`, atrás de
  `billing.manage`.
- Tela e link no nav, atrás da mesma permissão.

**Não entra, explicitamente:**

- **Backfill do que já aconteceu.** A história começa quando começarmos a ouvir.
  Puxar o passado do provider é trabalho próprio, e a tabela já o comporta.
- **Emitir fatura.** Quem emite é o provider. Aqui só projetamos.
- **Nota fiscal.** Fatura do provider não é documento fiscal brasileiro, e tratar
  uma como a outra seria mentir na tela.
- **Faturas em aberto ou futuras.** `invoice.upcoming` não descreve algo que
  aconteceu; a tela é um histórico, não uma previsão.
- **Apagar fatura.** Nada apaga. Recibo não some quando a assinatura acaba.

## Vocabulário

Termo novo em `CONTEXT.md` §Cobrança: **Invoice**.

Uma **fatura** é a cobrança como o provider a emitiu. Igual a `Subscription`, é
**projeção**: o provider é a autoridade, o webhook sobrescreve, e a tela lê a
nossa tabela. Ela tem duas situações que interessam — **paga** e **falha** — e
elas vêm do evento, não de um cálculo nosso.

O **arquivo** é o PDF que o provider gerou, copiado para o nosso storage. A URL do
provider expira; a nossa cópia é o que sobrevive a uma troca de provider.

## Comportamento

```
Dado    uma account com assinatura ativa
Quando  o provider entrega invoice.paid
Então   nasce uma linha em invoices com status paid, valor, moeda e data
E       um billing.invoice_archive entra no outbox, na mesma transação
```

```
Dado    o mesmo evento entregue duas vezes
Quando  o segundo chega
Então   a resposta é applied: false
E       continua havendo uma linha, porque quem recusa é o único de
        (source, external_event_id)
```

```
Dado    um invoice.payment_failed
Quando  ele é aplicado
Então   a fatura é projetada com status failed
E       o e-mail de dunning continua sendo enviado, como antes
E       um único evento normalizado nasceu, não dois
```

```
Dado    uma fatura projetada e o job de arquivo na fila
Quando  o worker o executa
Então   o PDF está no storage sob invoices/{accountId}/{externalId}.pdf
E       a linha aponta para essa chave
```

```
Dado    o mesmo job entregue duas vezes
Quando  o worker o executa de novo
Então   o objeto é sobrescrito com os mesmos bytes e a chave não muda
E       não existe um segundo objeto
```

```
Dado    uma reentrega atrasada de um evento antigo
Quando  ela é aplicada sobre uma fatura já atualizada
Então   a projeção não regride
E       a guarda é a mesma comparação de instante que subscriptions usa
```

```
Dado    alguém com billing.manage
Quando  ele abre GET /billing/invoices
Então   a resposta traz as faturas da account, a mais recente primeiro
```

```
Dado    alguém sem billing.manage
Quando  ele chama GET /billing/invoices ou o PDF de uma delas
Então   a resposta é 403
E       o link não existe no nav dele
```

```
Dado    uma account que cancelou a assinatura
Quando  o antigo assinante abre a tela de faturas
Então   ela responde 200
E       não 402 — os recibos são justamente do que já foi pago
```

```
Dado    uma fatura de outra account
Quando  alguém pede o PDF dela pelo id
Então   a resposta é 404
E       a policy de RLS é o que a esconde, não um if no serviço
```

```
Dado    uma fatura cujo arquivo ainda não subiu
Quando  alguém pede o PDF
Então   a resposta é 404 com a mesma forma
E       a tela não oferece o download enquanto não houver chave
```

## Portas afetadas

`IObjectStorage` **já existe**, com suíte e os dois adapters — este é o primeiro
consumidor de produto dele. Nada a fazer ali.

`IBillingProvider` muda:

- [ ] Suíte de conformidade estendida **antes** dos adapters
- [ ] `MemoryBillingProvider` (que é o driver de desenvolvimento, DEC-009)
- [ ] `StripeBillingProvider`, com fixtures nas duas versões de API (DEC-057)
- [ ] Sem wiring novo: os dois já estão registrados

## Banco

**`invoices`** — `id`, `account_id`, `external_id`, `status`
(`paid | failed`), `amount_cents`, `currency`, `issued_at`, `pdf_key`,
`last_event_at`, `created_at`, `updated_at`. Único em
`(account_id, external_id)`, sob `scopedPolicies`.

Escreve o handler do webhook; escreve o worker, só `pdf_key`; lê o módulo de
billing. **Nada apaga** — nem o cancelamento, nem a perda do tier. A exclusão de
conta leva junto por cascade, e a retenção de longo prazo é dívida registrada no
roadmap.

## Idempotência

Sim, chega duas vezes — todo provider reentrega.

O evento é recusado pelo único `(source, external_event_id)` de `billing_events`,
que já **é** o mecanismo. A fatura é upsert por `(account_id, external_id)` com a
guarda monotônica de `last_event_at`, então uma reentrega fora de ordem não
regride a projeção.

O arquivo é idempotente por construção: a chave do objeto deriva do id externo, o
segundo `put` sobrescreve os mesmos bytes, e o `UPDATE` grava o mesmo valor.
Nenhum `if (jáArquivei)` — dois workers passariam pelo `SELECT` juntos.

## Segurança

- **Vaza a existência de uma conta?** Não. As duas rotas exigem sessão, e uma
  fatura de outra account é invisível por RLS, então a resposta é 404 pelo mesmo
  caminho que um id inexistente.
- **Que token é gerado?** Nenhum. O PDF é **streamado pela API**, com a permissão
  conferida em toda requisição. `IObjectStorage.signedUrl` existe, mas um link
  assinado é credencial ao portador: vale para qualquer um que o tenha, até
  expirar, fora do nosso controle.
- **Que sessões morrem?** Nenhuma. Nada aqui muda credencial.
- O corpo do webhook continua sendo lido **cru**: a assinatura cobre os bytes
  exatos.

## Como validar

```bash
cd packages && pnpm verify && pnpm publish:local && pnpm consumer-check
pnpm verify
pnpm --filter @vpn-poc/adapters test:integration
pnpm --filter @vpn-poc/api test:e2e
```

À mão, com `make up` e `pnpm dev`, `BILLING_DRIVER=memory`:

1. Assine pelo checkout. A fatura aparece na tela de faturas, paga.
2. Baixe o PDF; ele vem da nossa API, não de um domínio do provider.
3. Reentregue o mesmo evento de webhook: a resposta é `applied: false`, continua
   havendo uma linha e um objeto.
4. Cancele a assinatura. A tela de faturas **continua** abrindo.
5. Com uma pessoa sem `billing.manage`, o link some do nav e a rota redireciona.
