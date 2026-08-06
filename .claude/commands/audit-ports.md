---
description: Verifica que toda dependência externa está atrás de uma porta com suíte de conformidade
---

Audite a regra central do projeto (CLAUDE.md §1.1 e §1.2).

1. Liste toda interface em `packages/ports/src/I*.ts`.
2. Para cada uma, confirme que existe:
   - uma suíte em `packages/testing/src/contracts/*.contract.ts`
   - um adapter in-memory em `packages/testing/src/fakes/`
   - um adapter real em `libs/adapters/src/`
   - uma chamada a `describe*Contract` cobrindo **ambos**
3. Procure em `libs/` e `apps/` por importações diretas de SDK de terceiro
   (`stripe`, `ioredis`, `nodemailer`, `@aws-sdk/*`, `@sentry/*`) **fora** de
   `libs/adapters/`. Cada ocorrência é uma violação.
4. Confirme que `packages/ports/package.json` continua sem `dependencies`.
5. Confirme que nada sob `packages/testing/src/fakes/` importa vitest.

Reporte só violações, com caminho e linha. Se não houver, diga isso em uma linha.
