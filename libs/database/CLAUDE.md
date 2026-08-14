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

## RLS

Toda tabela de domínio tem `account_id`, `ENABLE ROW LEVEL SECURITY` e **duas**
policies: `<tabela>_tenant` para `vpn_app` contra
`current_setting('app.account_id')`, e `<tabela>_system` para `app_system` com
`USING (true)`.

**Duas exceções, e são nominais:** `regions` e `exit_nodes`. A frota é da
plataforma e não pende de account nenhuma, então não há o que uma policy isole.
Isso **não** as deixa escrevíveis: o `ALTER DEFAULT PRIVILEGES` daria
INSERT/UPDATE/DELETE a `vpn_app` de graça, e o que segura é um `REVOKE` explícito
no fim da `0007`. Quem cobra são dois portões que afirmam o conjunto exato
(`exit_nodes,regions`) e não uma lista de exclusão — então uma terceira tabela sem
RLS reprova, e ligar RLS numa destas duas também. Ver DEC-090. A segunda não é frouxidão: `app_system` é `NOBYPASSRLS`, então
sem policy explícita ele lê zero linhas igual a `vpn_app` — o "bypass
deliberado" da DEC-005 precisa ser escrito. Ver DEC-050.

O `current_setting` é **estrito**, sem `missing_ok`. Fora de escopo a query
levanta `42704` em vez de devolver zero linhas em silêncio, que é a diferença
entre descobrir o erro na hora e descobri-lo num relatório errado. Ver DEC-050.

As policies são declaradas em `schema.ts` com `pgPolicy`, não em SQL à mão:
`0000_init` é regenerada, e SQL escrito à mão dentro dela é apagado sem aviso na
próxima geração. Isso exige `entities.roles.exclude` em `drizzle.config.ts` —
sem ele o drizzle-kit tenta gerenciar os papéis e emite `CREATE ROLE` brigando
com `01-roles.sql`. Ver DEC-053.

**FK composta precisa de `unique()`, não `uniqueIndex()`.** O drizzle-kit emite
`ALTER TABLE ADD CONSTRAINT ... FOREIGN KEY` **antes** dos `CREATE UNIQUE INDEX`,
então uma FK que referencia um índice único falha com
`42830 there is no unique constraint matching given keys`. `unique()` vira
constraint inline no `CREATE TABLE` e existe antes de qualquer FK. É o que
sustenta `users (id, account_id)` e `session_families (id, account_id)`, que por
sua vez impedem uma linha de credencial de discordar da account do seu user.

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
