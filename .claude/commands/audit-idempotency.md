---
description: Verifica que todo handler reentregável é seguro para rodar duas vezes
---

Audite CLAUDE.md §1.3.

1. Encontre todo ponto de entrada que pode ser reentregue: webhooks, consumidores
   de fila, qualquer coisa com retry.
2. Para cada um, identifique o mecanismo de idempotência e confirme que ele é uma
   **restrição no banco** (índice único, `ON CONFLICT`), não um `SELECT` seguido
   de `INSERT` — dois processos concorrentes passam juntos pelo `SELECT`.
3. Confirme que a reivindicação acontece **antes** do efeito colateral, e que a
   ordem escolhida está justificada num comentário (perder um evento vs. aplicar
   duas vezes: qual é o mal menor aqui?).
4. Confirme que todo envio via `IEmailSender`/`ISmsSender` passa uma
   `idempotencyKey` derivada de algo estável, não de `Date.now()` nem de random.

Reporte violações com caminho e linha.
