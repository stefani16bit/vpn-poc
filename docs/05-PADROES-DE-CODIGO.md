# Padrões de código

## 1. Anatomia de uma porta

```
packages/ports/src/IThing.ts
```

Um arquivo por porta: a interface e o token de DI, nada mais.

```ts
export interface IThing { … }
export const THING = 'THING';
```

O token mora ao lado da interface porque interfaces somem em runtime.
`ports.guard.spec.ts` verifica que o nome do token deriva do nome do arquivo,
que a porta está exportada no barrel e que **não** existe bloco de comentário.

O que a porta promete não vira comentário — vira asserção na suíte de
conformidade. Se você não consegue expressar a promessa como teste, ela não é
uma promessa, é uma intenção.

`packages/ports` não tem nenhuma dependência de runtime — todo o resto depende
dele, e uma dependência aqui é herdada por todos os adapters, todos os apps e o
bundle do navegador.

## 2. Anatomia de uma suíte de conformidade

```
packages/testing/src/contracts/thing.contract.ts
```

Exporta uma função `describeThingContract(name, createHarness)`. O harness é o
que permite a mesma suíte rodar contra implementações com mecânicas diferentes —
o `advance(seconds)` do cache mexe num relógio falso para o adapter in-memory e
rebobina o TTL das chaves para o Redis.

O nome do `it()` é onde a intenção mora: ele diz **que erro a asserção pega**,
não o que o código faz. `it('kills the whole family when reuse is detected')`
explica sozinho por que o teste existe; um comentário acima dele não
acrescentaria nada e sairia de sincronia primeiro.

## 3. Anatomia de um adapter

```
libs/adapters/src/<área>/ThingAdapter.ts
```

As decisões que a implementação toma e a porta não dita — por que
`EXPIRE ... NX` em vez de `EXPIRE`, por que a chave de idempotência é
reivindicada antes do envio — vão para o `CLAUDE.md` de `libs/adapters`, na
seção do adapter. Ali elas são lidas por quem vai mexer; num comentário, só por
quem já abriu o arquivo.

O spec do adapter chama `describeThingContract`. **Um adapter sem essa chamada
não está pronto.**

## 4. Anatomia de um módulo Nest

```
apps/api/src/modules/<feature>/
├─ <feature>.module.ts
├─ <feature>.controller.ts
├─ <feature>.service.ts
└─ <outros services>.ts
```

- Um módulo nunca importa o `*Service` de outro. Se precisa, ou o dado deveria
  vir por outro caminho, ou existe um problema de fronteira.
- Um módulo nunca constrói um adapter. `AdaptersModule` é o único lugar onde uma
  porta encontra uma implementação.
- Um controller não contém regra de negócio. Ele valida, chama e formata.

## 5. Erros

Um único `AppError` com um `code` de `@vpn/contracts`. O status HTTP é derivado
do código, numa tabela só.

Não use as subclasses de `HttpException` do Nest: lançar `UnauthorizedException`
num lugar e `ForbiddenException` noutro produz dois status para um mesmo
resultado visível ao usuário, e o front passa a adivinhar.

O corpo de erro sempre tem a forma de `ApiErrorResponse`. O `message` é para
desenvolvedor e **nunca** é renderizado — o front tem sua própria cópia em
`error-messages.ts`, indexada pelo código.

## 6. Comentários

**O código se explica sozinho.** Um comentário é permitido em exatamente dois
casos:

1. **Pragma funcional** — `v8 ignore`, `eslint-disable`, `@ts-expect-error`.
   Não é prosa, é instrução para uma ferramenta.
2. **O valor de uma constante que o nome não deduz** — uma linha, curta.

```ts
// Ruim — bloco de cabeçalho explicando o arquivo
/**
 * Password hashing on scrypt.
 * Why scrypt rather than Argon2id: every binding for Node is a native addon…
 */

// Ruim — parafraseia o código
// Incrementa o contador e devolve o valor
return this.#redis.incr(key);

// Aceitável — o número não se deduz do nome
const CURRENT: ScryptParams = { N: 2 ** 17, r: 8, p: 1 }; // ~64 MB, ~100ms
```

O porquê não desaparece, muda de lugar — e o lugar é melhor:

| O que você quer registrar | Onde vai |
| --- | --- |
| Por que este módulo existe, o que não fazer nele | `CLAUDE.md` do diretório |
| Por que escolhemos X e não Y | `docs/03-DECISION-LOG.md`, como `DEC-NNN` |
| Um caso de borda que precisa continuar valendo | um teste, com nome descritivo |
| O que a porta promete | asserção na suíte de conformidade |

Um comentário sai de sincronia com o código em silêncio. Um teste falha; um
`CLAUDE.md` é lido antes de mexer no diretório; um DEC é datado. Ver DEC-013.

## 7. Testes

- O teste que falha vem primeiro.
- Um teste por comportamento, com nome que descreve o comportamento e não o
  método.
- Sem `.only` e sem `.skip` commitados — `scripts/check-test-focus.mjs` bloqueia.
- Testes de integração ficam em `*.integration.spec.ts` e rodam por um config
  separado: `pnpm test` com o Docker parado tem que passar.
- Um teste não pode precisar de um privilégio que a aplicação não tem. Daí
  `DELETE` em vez de `TRUNCATE` (DEC-005).

## 8. TypeScript

`strict`, mais `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` e
`verbatimModuleSyntax`.

- Nada de `any`. `unknown` mais narrowing.
- Todo cast precisa de justificativa — no `CLAUDE.md` do diretório, não em
  comentário (ver `stateSyncMiddleware` em `apps/web/src/app/store/index.ts`,
  que contorna o conflito de tipos entre redux 4 e 5).
- `import type` só para tipos. Uma classe injetada por construtor precisa de
  import de valor, senão o `emitDecoratorMetadata` resolve `Object` e o Nest
  falha com um erro que não aponta para a causa.
- Chave opcional é **omitida**, não definida como `undefined`
  (`exactOptionalPropertyTypes` trata as duas coisas como diferentes, e o CDK
  também).
