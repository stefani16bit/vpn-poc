# libs/database

**Status:** mature · **Tag:** `type:lib`

Drizzle + PostgreSQL 17. Schema, cliente e migrações.

## Invariantes do schema

**Nenhum token é guardado em claro.** `refresh_tokens` e `verification_tokens`
guardam SHA-256 do valor entregue. Um dump do banco não é um conjunto de
credenciais funcionando. A busca continua sendo uma igualdade indexada — tokens
são aleatórios de alta entropia, então um hash lento não compraria nada aqui e
custaria em toda requisição.

**Refresh token pertence a uma família**, não a uma sessão. Rotação emite um
novo na mesma família e marca o antigo gasto; apresentar um gasto revoga a
família.

**`billing_events` tem índice único em `(source, external_event_id)`.** Esse
índice **é** o mecanismo de idempotência de webhook, não um registro dele: dois
Lambdas processando a mesma reentrega passam juntos por qualquer `SELECT`
prévio, e só a restrição faz o segundo perder.

**`revoked_at` é timestamp, não booleano.** "Quando foi revogado" responde uma
pergunta de incidente que "foi revogado" não responde.

## Papéis

`vpn_migrator` é dono do schema; a aplicação conecta como `vpn_app`, que
**não** tem TRUNCATE — `ALTER DEFAULT PRIVILEGES` concede só
SELECT/INSERT/UPDATE/DELETE. Testes limpam com `DELETE`. Um teste que precisa de
um privilégio que a aplicação não tem está testando outro papel. Ver DEC-005.

`prepare: false` no cliente: atrás de um pooler, um prepared statement criado
num backend é invisível no próximo, e o sintoma é um
"prepared statement s1 already exists" intermitente que não reproduz em lugar
nenhum.

## Don't

- Não conecte como `postgres` fora do container de init.
- Não rode migração como `vpn_app`.
- Não guarde token em claro.
- Não substitua o índice único de `billing_events` por checagem em service.
