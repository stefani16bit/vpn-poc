---
description: Tudo que precisa estar verde antes de abrir um PR
---

Rode, na ordem, e pare no primeiro que falhar:

1. `node scripts/check-test-focus.mjs`
2. `pnpm typecheck`
3. `pnpm test`
4. `make check` (precisa do devstack)
5. `pnpm --filter @vpn-poc/adapters test:integration`
6. `pnpm --filter @vpn-poc/api test:e2e`
7. `cd infra && pnpm exec cdk synth --quiet`

Se mexeu em `packages/`: `pnpm packages:publish:local` e `pnpm consumer-check`
antes do passo 2.

Depois confira:

- Termo novo do domínio está em `CONTEXT.md`?
- Decisão arquitetural virou um `DEC-NNN` em `docs/03-DECISION-LOG.md`?
- `docs/04-ROADMAP.md` reflete o estado atual?
- A mensagem de commit segue CLAUDE.md §5 — verbo no presente, sem prefixo,
  corpo com 2 a 4 bullets de **por quê**?
