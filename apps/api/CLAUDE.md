# apps/api

**Status:** mature · **Tag:** `type:app`

NestJS 11. Cadastro, verificação, login, rotação de sessão, reset de senha e
cobrança. `createApp()` em `bootstrap.ts` é a composição — `main.ts` e
`apps/api-lambda` chamam a **mesma** função, e é por isso que um middleware não
pode existir em um deployment e faltar no outro.

## Coisas que quebram de formas não óbvias

**Body cru do webhook.** `express.json({ verify })` está montado só em
`/billing/webhook`. A assinatura cobre os bytes exatos que o provider enviou;
reserializar o JSON não dá bytes idênticos, e a falha só aparece contra o
provider real, nunca contra uma fixture.

**`import type` em classe injetada.** O Nest resolve dependências de construtor
por `emitDecoratorMetadata`; um import só-de-tipo apaga para `Object` e o
container reporta "dependência não resolvível no índice N" sem dizer por quê.
Aconteceu duas vezes: à mão com `Reflector` em `auth.guard.ts`, e depois em
massa quando o autofix de `@typescript-eslint/consistent-type-imports` converteu
`AuthService`, `AccessTokenService`, `RateLimitService`, `VerificationTokenService`
e `BillingService`. Por isso a regra está **desligada** para `apps/api`,
`apps/api-lambda` e `libs/adapters` no `eslint.config.mjs` — o autofix é o
perigo, não o import.

**O runner de dev é `vite-node`, não `tsx`.** Mesma consequência do item acima
por outra causa: o esbuild, que move o `tsx`, não implementa
`emitDecoratorMetadata`, e toda injeção por tipo resolve `undefined` no boot. O
Vitest transforma com Vite + oxc, que emite os metadados — daí o e2e passar num
código que o `tsx` não conseguia subir. Runner de dev e transformador dos testes
andam juntos; ver DEC-018.

**`IdentityService.authenticate` roda o hash mesmo quando o usuário não
existe**, contra `ABSENT_USER_HASH`. Um retorno antecipado torna o caso
"endereço desconhecido" mensuravelmente mais rápido, e isso enumera contas tão
bem quanto uma mensagem de erro diferente. Vale para todo ramo em que o desfecho
já está decidido — inclusive o e-mail ambíguo entre duas accounts (DEC-051).

**A rotação marca o token gasto dentro de um `UPDATE ... WHERE spent_at IS
NULL`.** Um `SELECT` seguido de `UPDATE` deixa dois refreshes concorrentes
passarem. Esse statement mora em `SessionRepository` e não sobe para o serviço:
a atomicidade **é** a lógica, e é por isso que ela é provada por teste de
integração e não por unitário. Quem decide `rejected` contra `reuse_detected` é
`decideRotation`, que é puro e tem teste unitário. Ver DEC-049.

**`runAsSystem` recusa aninhar dentro de uma transação aberta.** No PostgreSQL,
`SET LOCAL ROLE` feito dentro de um savepoint **sobrevive ao release dele** — o
resto da transação externa continua como `app_system`. Um handler autenticado
que chamasse um método de sistema no meio do caminho escaparia de toda policy
dali para a frente, sem erro e sem log. Por isso o runner lança em vez de abrir
o savepoint. Hoje nada dispara isso: o caminho pré-autenticação não passa pelo
interceptor, e as rotas com guard não chamam sistema. A guarda existe para o dia
em que alguém escrever a primeira. `runInDiscoveredAccount` começa do mesmo jeito
e por isso recusa igual.

**O `refresh` segura privilégio de sistema por uma consulta só.** Ele é o único
usuário de `runInDiscoveredAccount`: descobre a account pelo `token_hash`, emite
`reset role` + `set_config` e faz o resto — gastar, emitir, ler o user — sob a
policy. Duas coisas não podem mudar aí. A primeira é que é **uma** transação: a
rotação não pode partir ao meio. A segunda é que o `SESSION_REUSE_DETECTED` é
lançado **fora** dela; lançar dentro desfaz a revogação da família e devolve um
token roubado funcionando. O e2e `revokes the whole family when a refresh token
is replayed` é o que pega isso.

**Uma `Date` dentro de um template `sql` cru não passa por encoder nenhum.** Nos
operadores do drizzle — `gte(exitNodes.lastSeenAt, staleBefore)` — o valor é
ligado à coluna e sai pelo `mapToDriverValue` dela. Interpolado direto no
template `sql`, não há coluna de onde inferir o tipo: o `Date` chega cru ao
postgres.js e o bind estoura com _"Received an instance of Date"_. É 500 em
runtime, não erro de tipo, e só no caminho que executa aquele fragmento — nenhum
teste unitário pega, porque a falha é do driver e não da consulta. Ou o valor
entra por um operador que carrega a coluna, ou vai explícito como
`${at.toISOString()}::timestamptz`, que é o que as duas projeções de billing
fazem. `listRegions` é o caso vivo, e quem o cobre é integração.

**Guard roda antes de interceptor, e a transação é um interceptor.** Dentro de um
`canActivate` não existe escopo de banco: `currentExecutor()` lança. É por isso
que o `CapabilityGuard` lê o tier pelo cache e, no miss, o
`EntitlementsService` abre a **própria** transação com `runInAccount` — ele
ramifica em `hasScope()` justamente para servir os dois chamadores, o guard (sem
escopo) e um handler (dentro do escopo da requisição). Mover essa checagem para
um segundo interceptor global faria a leitura acontecer dentro do escopo, mas
poria autorização depois do pipeline em vez de na frente dele. Ver DEC-055.

**A invalidação do cache de entitlement é efeito do webhook, depois do commit.**
Antes do commit, uma requisição concorrente reescreve a entrada com a linha
pré-commit e a invalidação se perde. Os dois cenários de cache quente no e2e
ficam vermelhos se a chamada sair — foi assim que eles foram conferidos.

**O e-mail de ativação é condicionado ao tier, não ao nome do evento.**
`StripeBillingProvider` normaliza **todo** `customer.subscription.created` como
`subscription_activated`, e um `created` pode chegar `incomplete` — 3DS/SCA. Por
isso `#enqueueNotification` só enfileira quando `resolveTier(status)` devolve um
tier. Sem a checagem, quem ainda não pagou nada recebe "sua assinatura está ativa",
e e-mail não se corrige sozinho. Ver DEC-059.

**Cancelar e retomar enfileiram no outbox sem abrir transação.** São as únicas
ações de billing iniciadas pelo usuário, e o `TenantTransactionInterceptor` já
abriu a transação delas — então `outbox.enqueue(accountId, msg)` sem executor cai
no `currentExecutor()` e commita junto com a projeção. Imitar o webhook e chamar
`runAsSystem` **lança**: ele recusa aninhar dentro de um escopo aberto. A
idempotência dessas duas chaveia no instante pedido, não num id de evento do
provider, porque não existe um. Ver DEC-061.

**O aviso de acesso suspenso segue o tier, e o cancelamento ganha dele.** Perder o
tier dispara `billing.access_revoked`, mas uma assinatura que termina também perde
o tier — e receberia a mensagem errada se a ordem fosse outra. Em
`#enqueueNotification` os eventos com e-mail próprio são resolvidos primeiro e a
revogação é o que sobra. O `boolean` que `upsert` devolve existe para isso: sem
ele, um evento atrasado que a guarda monotônica recusou mandaria "você perdeu o
acesso" para quem não perdeu.

**Sem `ValidationPipe`.** É um front-end de class-validator. A validação aqui é
zod contra `@vpn/contracts`, os mesmos schemas que o formulário do front usa.
Ver DEC-008.

**`AccessTokenService.verify` confere issuer e audience**, não só a assinatura.
Sem isso, um token emitido por qualquer sistema que compartilhe o segredo — um
staging, um serviço irmão — seria aceito aqui.

**Cookie de refresh com `path: '/auth'`** e `SameSite=Lax`. `Strict` derrubaria
o cookie na navegação vinda do link do e-mail, deslogando o usuário na hora em
que ele acabou de verificar a conta.

## Camadas

`shared/` é o kernel: todo módulo pode depender dele, e ele não pode depender de
módulo nenhum. Dentro de um módulo, `controllers/ services/ repositories/
mappers/`. As quatro fronteiras são verificadas por lint (DEC-027), cada uma
provada com uma sonda.

Controle de acesso mora no kernel, não em auth: o `AccessTokenGuard` lê uma claim
de dentro do JWT e nunca consulta uma conta. Por isso `BillingModule` importa
`AccessControlModule` e não `AuthModule` — ver DEC-024 e DEC-025.

A segunda dimensão de autorização mora ao lado: `shared/entitlements/` lê o tier
da subscription com cache, e `shared/subscriptions/` tem o repositório que os dois
lados usam — o webhook escreve, o kernel lê, e o kernel não pode importar de
`modules/`. `AccessControlModule` importa `EntitlementsModule` e exporta o
`CapabilityGuard`; quem tem rota de produto para guardar importa só
`AccessControlModule`.

**Notificação também subiu para o kernel**, e pela mesma regra: dois módulos
passaram a precisar. `shared/notifications/` tem os mailers, o dispatcher e o
consumer; `shared/verification/` tem o serviço de token, que agora é emitido no
envio e não mais no request (DEC-048). Um serviço **não envia e-mail**: escreve
uma intenção em `shared/outbox/`, dentro da transação. Quem envia é o worker.

O **relay** é sistema e o **consumer** não. O relay drena uma tabela que é de
todo mundo; o consumer despacha uma mensagem de cada vez, e cada mensagem tem
dono — por isso ele abre `runInAccount` com o `account_id` que veio no envelope
do job. É o que faz `users.findById(userId)` no dispatcher ser verificado pela
policy em vez de confiar no payload.

**Repositório não tem teste unitário.** Fingir a cadeia fluente do drizzle
afirma o formato de uma API fluente, não um comportamento; a corretude deles
segue provada pelo e2e, e por isso `repositories/**` fica fora da cobertura.
Ver DEC-026.

## Locale

`request-context.ts` carrega `{ correlationId, locale }` num AsyncLocalStorage.
A precedência é **conta > `Accept-Language` > fallback**: `localeOf(account)` em
`shared/locale/` é o único lugar que decide, e todo e-mail passa por ele — o
de auth e o de cobrança, que é por isso que ele está no kernel. Um
job sem requisição cai no fallback por construção.

O `correlationId` do mesmo store é injetado em toda linha de log pelo `mixin` do
pino. Para ler o rastro de uma requisição, pegue o `x-correlation-id` da
resposta e rode `pnpm logs:trace <id>` na raiz — ele lê `logs/api.ndjson`, que o
`LOG_TRANSPORT=pretty` escreve em paralelo ao stdout colorido. Lembre que
`customLogLevel` devolve `'silent'` para erro e 5xx: essas requisições não têm
linha de auto-log, aparecem pelo `GlobalExceptionFilter`. Ver DEC-031.

## Módulo na linha de log

O mesmo store carrega `module`, derivado do prefixo da rota por `moduleForUrl`.
Um serviço não depende disso: ele recebe um logger já preso ao seu módulo pelo
token `MODULE_LOGGER`, que cada `*.module.ts` registra com
`moduleLoggerProvider('auth')`. Quem emite ganha de quem roteia.

**O `mixin` do pino sobrescreve os bindings do child** — é o inverso do que
parece, e é por isso que `contextProps` lê `logger.bindings()` antes de supor
`module`. Trocar isso por um `{ ...currentContext() }` direto faz toda linha de
serviço sair rotulada com a rota. `module-logger.spec.ts` fixa os dois lados.

`pretty` e `file` escrevem `logs/api.<module>.ndjson` ao lado do combinado, e
`pnpm logs:trace --module auth` filtra na leitura. O `logs:trace` lê o
combinado de propósito: é o único arquivo onde um rastro que cruza módulos
permanece inteiro. Sob `json` não há arquivo nenhum — é o caminho da Lambda.
Ver DEC-033.

`registerRequestSchema.locale` é **opcional**, não tem default. Um default faz
`body.locale` nunca ser `undefined` e o fallback para o header nunca dispara —
esse bug existiu e o e2e pegou.

## Erros

Um `AppError` com `code` de `@vpn/contracts`; o status sai de uma tabela. O
`message` é para desenvolvedor e **nunca** é renderizado — o front traduz por
`errors.<CODE>`. Só 5xx chega ao Sentry.

## Health

`HealthModule.forRoot({ readiness: [...] })`. Indicadores são plugáveis e
tipados estruturalmente (`QueryableDatabase` = `{ execute }`), então o módulo
não importa `@vpn-poc/database`. `/health` é liveness e não toca em nada;
`/health/ready` reporta por dependência, no formato do `@nestjs/terminus`
(`{ status, info, error, details }`), e responde **503** se qualquer indicador
cair — ver DEC-030.

O 503 é atendido por `HealthCheckFilter`, com `@UseFilters()` no controller.
Tirá-lo dali entrega o 503 ao `GlobalExceptionFilter`, que trata `>= 500` como
erro da aplicação: o corpo vira `{ code: 'INTERNAL' }`, some o detalhe por
dependência, e cada probe falho vai para o Sentry.

Indicador que falha reporta `{ status: 'down' }` **sem a mensagem do erro**.
`/health/ready` não é autenticado.

## Don't

- Não importe nada de outro módulo — nem `*Service`, nem guard, nem tipo. O que
  dois módulos precisam mora em `shared/`, e o lint verifica (DEC-027).
- Não construa adapter aqui. Injete pelo token.
- Não faça um endpoint público responder diferente para e-mail existente e
  inexistente — nem no corpo, nem no status, nem no tempo.
- Não renderize `error.message`.
- Não adicione string literal voltada ao usuário; use chave de `@vpn/i18n`.
