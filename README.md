# poc-vpn

Plataforma de VPN — fase 1: cadastro, verificação de e-mail, login, reset de
senha e assinatura. Roda 100% local.

Toda dependência externa está atrás de uma interface substituível, e cada uma
tem no mínimo duas implementações que passam pela **mesma** suíte de
conformidade.

```
git clone --recurse-submodules <url> poc-vpn && cd poc-vpn
cp .env.example .env.local
make up && make check
pnpm install && pnpm packages:publish:local
pnpm --filter @vpn-poc/database db:migrate
pnpm dev
```

Web em <http://localhost:5173>, API em <http://localhost:3000>, caixa de entrada
em <http://localhost:28025>, registry em <http://localhost:24873>.

## Onde está o quê

| | |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Como trabalhar aqui. Comece por ele |
| [`CONTEXT.md`](CONTEXT.md) | Glossário do domínio |
| [`docs/`](docs/) | Arquitetura, decisões, roadmap, ambiente local |
| `packages/` | Submodule: portas, contratos, suítes de conformidade |
| `apps/` | `api` (Nest), `api-lambda`, `web` (Vite + React) |
| `libs/` | `env`, `database` (Drizzle), `adapters` |
| `infra/` | CDK — 6 stacks, esqueleto |
| `devstack/` | 7 contêineres |

## Stack

NestJS 11 · Drizzle · PostgreSQL 17 · Redis · Vite 6 + React 19 + RTK Query ·
Tailwind v4 + shadcn/ui · zod · pino + Sentry · Stripe · AWS CDK · LocalStack ·
Verdaccio · pm2

## Testes

```bash
pnpm verify                                        # 239, não precisa de Docker
pnpm --filter @vpn-poc/adapters test:integration   # 86, adapters reais
pnpm --filter @vpn-poc/api test:e2e                # 37, o fluxo inteiro
```

Os 86 de integração são as **mesmas** suítes que rodam contra os fakes, agora
contra Redis, Postgres, mailpit, LocalStack e localstripe de verdade. É o que
transforma "os adapters são intercambiáveis" de intenção em asserção.
