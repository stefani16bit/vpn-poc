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
apps/api/src/
├─ shared/                      o kernel: todo módulo pode depender dele,
│  ├─ access-control/           e ele não pode depender de módulo nenhum
│  ├─ errors/ health/ http/
│  ├─ locale/ rate-limit/ validation/
└─ modules/<feature>/
   ├─ <feature>.module.ts
   ├─ controllers/
   ├─ services/
   ├─ repositories/
   └─ mappers/
```

- Um módulo nunca importa **nada** de outro módulo — nem `*Service`, nem guard,
  nem tipo. O que dois módulos precisam mora em `shared/`.
- O kernel não importa módulo. Se um pedaço de `shared/` precisa de um, ele não
  era kernel.
- Um controller não contém regra de negócio. Ele valida, chama e formata — e
  não importa repositório: persistência é assunto do service.
- Um módulo nunca constrói um adapter. `AdaptersModule` é o único lugar onde uma
  porta encontra uma implementação.
- Um repositório é código nosso sobre o token `DATABASE`: sem interface, sem
  suíte de conformidade e sem teste unitário (DEC-026).

As quatro primeiras regras são verificadas por `import-x/no-restricted-paths`
(DEC-027), e cada zona foi provada com uma sonda. Antes disso eram honra.
Ver DEC-024.

## 5. Erros

Um único `AppError` com um `code` de `@vpn/contracts`. O status HTTP é derivado
do código, numa tabela só.

Não use as subclasses de `HttpException` do Nest: lançar `UnauthorizedException`
num lugar e `ForbiddenException` noutro produz dois status para um mesmo
resultado visível ao usuário, e o front passa a adivinhar.

O corpo de erro sempre tem a forma de `ApiErrorResponse`. O `message` é para
desenvolvedor e **nunca** é renderizado — o front traduz por `errors.<CODE>` no
catálogo de `@vpn/i18n`.

O `correlationId` é obrigatório no corpo, e não é decoração: `normalizeError`
no front só reconhece uma resposta de erro que o traga como string. Sem ele,
todo erro vira `_UNKNOWN_ERROR` e a tela mostra "algo deu errado" no lugar da
mensagem certa.

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

| O que você quer registrar                        | Onde vai                                  |
| ------------------------------------------------ | ----------------------------------------- |
| Por que este módulo existe, o que não fazer nele | `CLAUDE.md` do diretório                  |
| Por que escolhemos X e não Y                     | `docs/03-DECISION-LOG.md`, como `DEC-NNN` |
| Um caso de borda que precisa continuar valendo   | um teste, com nome descritivo             |
| O que a porta promete                            | asserção na suíte de conformidade         |

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

## 9. Anatomia de um componente

```
apps/web/src/
├─ components/ui/          primitivo: copiado do registry, não conhece o domínio
├─ components/form|layout/ composto: conhece t(), NormalizedError e o que é campo
├─ features/<feature>/     api/ components/ hooks/ pages/
└─ app/                    compõe: providers, router, error boundary
```

- Um primitivo nunca importa nada nosso além de `lib/`. Ele é código de
  terceiro que por acaso mora aqui.
- Um composto nunca conhece uma feature. Uma feature nunca conhece outra.
- **Código copiado do registry é código nosso.** Um literal voltado ao usuário
  dentro dele é um literal no app: troque por `t('chave')` e publique a chave
  antes. A única exceção é o error boundary, que monta acima do
  `LocaleProvider` e por construção não tem tradutor.
- `Field` recebe **render prop**, não children. O `aria-describedby` precisa
  chegar ao controle, e quem cria o controle é quem chama — clonar children
  quebra contra o spread de `register()` do react-hook-form.
- Toda tela que substitui um formulário move o foco (`MessageScreen`). Sem
  isso o foco fica numa subárvore removida e o leitor de tela não é avisado.

As três primeiras regras são verificadas por lint (DEC-027).

## 10. Anatomia de um teste de tela

`renderWithProviders` (em `src/test-utils.tsx`) monta store, tradutor e router
de uma vez; `stubApi()` troca o `fetch` global e grava o que foi pedido.

Duas armadilhas do ambiente estão codificadas ali, e cada uma custou uma
sessão de depuração:

- O `Request` do vitest é o do undici, que **recusa URL relativa**. O default
  `/api` da aplicação faz toda requisição morrer antes de chegar no `fetch`,
  sem erro visível — por isso `vite.config.mts` define `VITE_API_URL` absoluto
  nos testes.
- `stubApi().fail()` sempre manda `correlationId`, porque `normalizeError` só
  reconhece a resposta de erro com ele. Um fixture sem `correlationId` faz o
  teste passar pelo motivo errado: qualquer falha vira `_UNKNOWN_ERROR`, e uma
  asserção do tipo "não mostra o código cru" passa sem provar nada.

A limpeza da Testing Library **não** é automática aqui: `globals` está
desligado, então `afterEach(cleanup)` é explícito em `test-setup.ts`.
