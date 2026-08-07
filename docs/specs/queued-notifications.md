# Notificações enfileiradas

**Status:** entregue
**Decisões relacionadas:** DEC-046, DEC-047, DEC-048, DEC-012, DEC-029

## Problema

Todo e-mail saía dentro da requisição. `register` emitia o token de verificação e
falava com o SMTP antes de responder. Um SMTP lento é um cadastro lento; um SMTP
fora do ar é um usuário parado no muro do cadastro, sem link e sem sinal de que
algo falhou.

## Escopo

**Entra:** porta `IJobQueue` com dois adapters, tabela `outbox`, relay, consumer,
`apps/worker`, e a migração de todos os seis e-mails existentes (verificação,
reset, boas-vindas, senha alterada, pagamento falhou, assinatura cancelada).

**Não entra:** job atrasado (`runAt`) — não há chamador, e `DelaySeconds` do SQS
teto em 900s; cron; deduplicação na fila; retry com backoff próprio — o
`maxReceiveCount` do SQS já faz isso; expurgo do outbox publicado.

## Vocabulário

**Outbox**, **Intenção**, **Job**, **Relay**, **Consumer**, **At-least-once** —
todos em `CONTEXT.md`.

## Comportamento

```
Dado    um cadastro válido
Quando  o usuário se registra
Então   a resposta é 202 sem que nada tenha falado com o SMTP
E       há uma linha em outbox com published_at nulo
```

```
Dado    uma linha de outbox pendente
Quando  dois relays rodam ao mesmo tempo
Então   cada linha é publicada exatamente uma vez
```

```
Dado    um job de verificação na fila
Quando  o consumer o processa duas vezes
Então   chega um e-mail só
```

```
Dado    um job cujo kind não é conhecido
Quando  o consumer o recebe
Então   ele não é reconhecido
E       volta para a fila até a DLQ, em vez de sumir
```

```
Dado    um job cujo envio falha
Quando  o consumer processa o lote
Então   os outros jobs do lote continuam sendo processados
E       o que falhou não é reconhecido
```

```
Dado    uma conta que se verificou entre o enfileiramento e o envio
Quando  o worker processa o job de verificação
Então   nenhum token é emitido e nenhum e-mail sai
```

## Portas afetadas

- [x] Interface em `@vpn/ports` (`IJobQueue`)
- [x] Suíte de conformidade em `@vpn/testing/contracts`, escrita **antes** dos adapters
- [x] Adapter in-memory (`MemoryJobQueue`, que é o driver `memory`)
- [x] Adapter real (`SqsJobQueue`)
- [x] Wiring em `adapters.module.ts` com `QUEUE_DRIVER`

## Banco

`outbox` — `id`, `kind`, `payload` (jsonb), `attempts`, `created_at`,
`published_at`. Índice parcial em `created_at where published_at is null`: o
relay só varre o que falta, e o índice não cresce com o histórico.

Escreve: `AuthService` e `BillingService`, na transação. Lê e marca: o relay.
**Apaga: ninguém** — linhas publicadas ficam para sempre. É dívida, e está no
roadmap junto com o expurgo de `verification_tokens`.

## Idempotência

Chega duas vezes em dois pontos, e os dois são deliberados:

- **relay** morre entre publicar e marcar → republica na próxima volta;
- **consumer** morre entre enviar e reconhecer → recebe de novo.

O que faz a repetição ser inofensiva é anterior a este trabalho: o
`SmtpEmailSender` reivindica a chave de idempotência no cache **antes** de
enviar. Sob dois processos concorrentes, é essa reivindicação que decide, não um
`if` no consumer.

O relay é seguro entre processos por `for update skip locked`: duas transações
nunca reivindicam a mesma linha.

## Segurança

- **Vaza a existência de uma conta?** Não muda nada: `register`, `forgot-password`
  e `resend-verification` continuam respondendo idêntico, e agora enfileiram ou
  não enfileiram sem que a resposta mude.
- **Que token é gerado?** Nenhum, no request. O worker emite no envio, e por isso
  o token em claro nunca toca o `outbox` nem o SQS — a invariante de
  `libs/database/CLAUDE.md` continua literal. Um teste de e2e faz grep no payload.
- **Que sessões morrem?** Nenhuma. Isto não toca sessão.

## Como validar

```bash
make up
pnpm db:migrate
pnpm verify
pnpm --filter @vpn-poc/adapters test:integration   # contrato contra o SQS do LocalStack
pnpm --filter @vpn-poc/api test:e2e                # inclui "queued notifications"
```

No navegador, com `pnpm dev` (que agora sobe o `worker` também): cadastrar,
conferir que a resposta volta na hora, e ver o e-mail chegar no mailpit em
<http://localhost:28025> logo depois. Para ver a fila trabalhando, pare o worker
(`pm2 stop worker`), cadastre, confira a linha pendente em `outbox`, e suba o
worker de novo.
