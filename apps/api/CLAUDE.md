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

Controle de acesso mora no kernel, não em auth: o guard lê uma claim de dentro
do JWT e nunca consulta uma conta. Por isso `BillingModule` importa
`AccessControlModule` e não `AuthModule` — ver DEC-024 e DEC-025.

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
