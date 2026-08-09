# Arquitetura

## 1. A regra central

Todo serviço externo entra por uma interface `I*` em `@vpn/ports`. Cada porta
tem uma suíte de conformidade em `@vpn/testing/contracts`, escrita **antes** do
adapter, e no mínimo duas implementações que a satisfazem.

```
             @vpn/ports                    @vpn/testing/contracts
          (só interfaces)                (o que a porta promete)
                 │                                  │
                 │  implementado por                │ roda contra
                 ▼                                  ▼
   ┌─────────────────────────┐        ┌──────────────────────────┐
   │ @vpn/testing/fakes      │        │ libs/adapters            │
   │ MemoryCacheStore        │◄──────►│ RedisCacheStore          │
   │ MemoryIdentityProvider  │  mesma │ DrizzleIdentityProvider  │
   │ MemoryEmailSender       │  suíte │ SmtpEmailSender          │
   │ MemoryBillingProvider   │        │ StripeBillingProvider    │
   └─────────────────────────┘        └──────────────────────────┘
```

O que isso compra: "você não consegue dizer qual adapter recebeu" deixa de ser
uma intenção de design e vira uma asserção. A troca acontece em um lugar só —
`libs/adapters/src/adapters.module.ts` — a partir de uma variável de ambiente.

## 2. Topologia

```
poc-vpn/
├─ packages/          submodule → publica @vpn/* no Verdaccio
│  ├─ ports/          10 interfaces, zero dependências de runtime
│  ├─ contracts/      schemas zod + códigos de erro (front + back)
│  ├─ testing/        /contracts (suítes) e /fakes (adapters memory)
│  └─ config/         preset de vitest, tsconfig base
├─ apps/
│  ├─ api/            NestJS 11
│  ├─ api-lambda/     o mesmo AppModule atrás do API Gateway
│  └─ web/            Vite 6 + React 19 + RTK Query + Tailwind v4 + shadcn/ui
├─ libs/
│  ├─ env/            zod por concern, validado no boot
│  ├─ database/       Drizzle: schema, cliente, migrações
│  └─ adapters/       os adapters reais + o módulo de wiring
├─ infra/             CDK: 6 stacks vazias, grafo validado
└─ devstack/          8 contêineres
```

## 3. As portas

| Porta              | In-memory               | Real                    |
| ------------------ | ----------------------- | ----------------------- |
| `IClock`           | `FixedClock`            | `SystemClock`           |
| `ICacheStore`      | `MemoryCacheStore`      | `RedisCacheStore`       |
| `IPasswordHasher`  | `FakePasswordHasher`    | `ScryptPasswordHasher`  |
| `IEmailSender`     | `MemoryEmailSender`     | `SmtpEmailSender`       |
| `ISmsSender`       | `MemorySmsSender`       | `ConsoleSmsSender`      |
| `IBillingProvider` | `MemoryBillingProvider` | `StripeBillingProvider` |
| `IObjectStorage`   | `MemoryObjectStorage`   | `S3ObjectStorage`       |
| `IErrorReporter`   | `NoopErrorReporter`     | `SentryErrorReporter`   |
| `IJobQueue`        | `MemoryJobQueue`        | `SqsJobQueue`           |
| `IExitNode`        | `MemoryExitNode`        | `HttpExitNode`          |

`ISmsSender` existe sem provider real de propósito: o formato da chamada é a
parte cara de mudar depois, e adicionar SNS ou Twilio vira uma classe e uma
variável.

## 4. Fluxo de autenticação

```
cadastro ──► conta criada (não verificada) ──► e-mail com token de uso único
                                                        │
                                                        ▼
                                              verificação ──► conta ativa
                                                        │
   login ◄──────────────────────────────────────────────┘
     │
     ├─► access token  JWT 15 min, HS256, NÃO revogável, no corpo da resposta
     └─► refresh token opaco, SHA-256 no banco, cookie httpOnly, rotaciona
                                    │
                        ┌───────────┴───────────┐
                        ▼                       ▼
                  rotação normal          token já gasto
                  novo token,             → reuse_detected
                  mesma família           → família revogada inteira
```

Revogar só o token replayado deixaria o ladrão com um válido: quem já rotacionou
é o cliente legítimo.

## 5. Fluxo de cobrança

```
POST /billing/checkout ──► IBillingProvider.createCheckout (idempotencyKey)
                                    │
                            redirect para o provider
                                    │
                          pagamento acontece lá fora
                                    │
                                    ▼
POST /billing/webhook ──► verifyWebhookSignature(RAW body)
                          parseWebhookEvent → NormalizedBillingEvent
                                    │
                          INSERT billing_events  ← a idempotência é AQUI
                          ON CONFLICT DO NOTHING    (unique source+event_id)
                                    │
                       0 linhas? reentrega → 200 {applied:false}
                       1 linha?  aplica a projeção em subscriptions
```

O `INSERT` vem **antes** de aplicar. Dois Lambdas com a mesma reentrega passam
juntos por qualquer `SELECT` prévio; só a restrição única faz o segundo perder.

## 6. Requisição em produção

```
navegador ──► API Gateway ──► Lambda (ARM_64, mesmo AppModule) ──► RDS Proxy ──► Postgres
                                        │
                                        ├──► ElastiCache (ICacheStore)
                                        ├──► SES (IEmailSender)
                                        └──► Stripe (IBillingProvider)
```

Endpoints são Lambda. Jobs pesados vão para ECS/EC2 — a `WorkersStack` existe
para que o primeiro deles tenha destino que não seja "aumentar o timeout do
Lambda da API".

## 7. Observabilidade

pino com lista de redação generosa; `correlationId` via `AsyncLocalStorage`,
devolvido no header e presente em todo corpo de erro. Só 5xx chega ao Sentry —
um 401 não é incidente, e um reporter cheio deles é um reporter que ninguém lê.

O destino das linhas é `LOG_TRANSPORT`: `pretty` (padrão em desenvolvimento)
escreve stdout colorido **e** `logs/api.ndjson`; `json` (padrão fora dele) emite
NDJSON puro em stdout, que é a forma que o Lambda entrega ao CloudWatch e que o
Logs Insights indexa por campo sem agente nenhum. `gelf` e `loki` estão no
schema e caem em `json` com aviso — são a porta de saída para um sink externo,
não algo que já exista. Não há agregador local: `pnpm logs:trace <correlationId>`
lê o NDJSON e devolve o rastro completo de uma requisição. Ver DEC-031.
