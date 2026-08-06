# Decision log

Um `DEC-NNN` por decisão arquitetural. Decisão superada **nunca** é editada nem
apagada — recebe `Status: superseded by DEC-NNN` e a nova entra embaixo. O
histórico de por que algo foi decidido é mais valioso que a limpeza da lista.

---

### DEC-001 — Monorepo Nx + pnpm

**Data:** 2026-08-05 · **Status:** accepted

**Contexto.** As duas referências divergem: `poc` é polyrepo com sete repos
independentes, `convoy` é um monorepo Nx + pnpm.

**Decisão.** Monorepo, no formato do `convoy`.

**Rationale.** O escopo desta fase é web + API + adapters. O polyrepo do `poc`
compra isolamento ao custo de sete clones, sete lockfiles e uma publicação a
cada mudança compartilhada — e a fronteira que realmente importa (a de
publicação) é preservável dentro de um monorepo, que é o que DEC-002 faz.

---

### DEC-002 — `packages/` é submodule consumido via Verdaccio

**Data:** 2026-08-05 · **Status:** accepted

**Contexto.** As portas, os contratos e as suítes de conformidade são
compartilhados. Como membros do workspace, `workspace:*` resolveria para o
diretório de origem.

**Decisão.** `packages/` é um repositório git próprio, incluído como submodule,
**ausente** de `pnpm-workspace.yaml`. `.npmrc` aponta `@vpn:registry` para o
Verdaccio local.

**Rationale.** Um `files` errado, um subpath faltando em `exports` ou uma
dependência declarada como dev funcionam perfeitamente dentro do workspace e
quebram só para o consumidor. Instalar do registry faz o consumidor ser a
primeira coisa exercitada, não a última.

**Consequências.** Mudança em `@vpn/*` exige `pnpm packages:publish:local`.
`tools/consumer-check` instala os tarballs publicados **fora** do workspace e os
importa; roda em cada publicação.

---

### DEC-003 — Escopos `@vpn/*` e `@vpn-poc/*`

**Data:** 2026-08-05 · **Status:** accepted

`@vpn/*` é publicado (submodule, vem do registry). `@vpn-poc/*` é interno do
workspace e nunca publicado. Dois escopos porque um import diz por si só de que
lado da fronteira ele está — com escopo único, saber isso exige abrir o
`package.json`.

---

### DEC-004 — Rate limiting não é uma porta

**Data:** 2026-08-05 · **Status:** accepted

**Decisão.** `RateLimitService` é um service comum sobre `ICacheStore.increment`.

**Rationale.** A regra "toda dependência externa atrás de uma porta" tem como
critério "eu teria que substituir isto?". O que poderia ser substituído aqui é o
contador — e ele já é uma porta. Uma `IRateLimiter` só acrescentaria uma
interface nossa sobre uma política nossa.

---

### DEC-005 — Papéis de banco separados desde o primeiro dia

**Data:** 2026-08-05 · **Status:** accepted

**Decisão.** `vpn_migrator` (dono do schema), `vpn_app` (NOINHERIT, sem
BYPASSRLS), `app_system` (NOLOGIN, bypass deliberado para jobs), `vpn_readonly`
(BYPASSRLS, só SELECT).

**Rationale.** Multi-tenancy/RLS está fora desta fase, mas conectar a aplicação
como `postgres` é a decisão cara de desfazer: toda policy escrita depois lê como
correta enquanto um superusuário a ignora em silêncio.

**Consequências.** `vpn_app` **não** tem TRUNCATE — `ALTER DEFAULT PRIVILEGES`
concede SELECT/INSERT/UPDATE/DELETE apenas. Testes limpam com `DELETE`. O
migrator precisa de `GRANT CREATE ON DATABASE` porque o Drizzle cria o schema
`drizzle` do próprio ledger de migrações.

---

### DEC-006 — Refresh token opaco com rotação por família

**Data:** 2026-08-05 · **Status:** accepted

**Decisão.** Access token é JWT curto e não revogável. Refresh token é opaco,
guardado como SHA-256, pertence a uma *família*, e rotaciona a cada uso. Token
gasto apresentado de novo → `reuse_detected` → família revogada.

**Rationale.** Revogar só o token replayado deixa o ladrão com um token válido —
o cliente legítimo é quem já rotacionou. Matar a família derruba os dois e força
um login.

---

### DEC-007 — scrypt em vez de Argon2id

**Data:** 2026-08-05 · **Status:** accepted

**Contexto.** Argon2id é o algoritmo preferível. Todo binding Node é addon
nativo.

**Decisão.** `ScryptPasswordHasher` sobre `node:crypto`, N=2^17, r=8, p=1, com
os parâmetros embutidos no hash.

**Rationale.** Um addon nativo é uma toolchain de compilação em três plataformas
de desenvolvimento mais o build do Lambda. scrypt é memory-hard e vem na
biblioteca padrão. `IPasswordHasher` é a saída: trocar por Argon2id é uma classe,
e `needsRehash` já promove hashes antigos no login seguinte.

**Consequências.** `maxmem` é derivado dos parâmetros (`128·N·r·2`); constante
fixa quebra ao subir N. Sem addon nativo, o Lambda ARM_64 fica trivial.

---

### DEC-008 — Zod compartilhado, sem `ValidationPipe`

**Data:** 2026-08-05 · **Status:** accepted

Schemas moram em `@vpn/contracts` e são usados pelo formulário no front e pelo
endpoint no back. `ValidationPipe` do Nest é um front-end de class-validator:
seria uma segunda definição de "corpo válido", discordando da primeira, mais uma
dependência. Um objeto zod já descarta chaves não declaradas.

---

### DEC-009 — `BILLING_DRIVER=memory` como padrão local

**Data:** 2026-08-05 · **Status:** accepted

**Contexto.** localstripe não implementa `/v1/checkout/sessions` (nem
`/v1/prices` — ainda está em `/v1/plans`).

**Decisão.** Localmente o padrão é `MemoryBillingProvider`, que passa a suíte de
conformidade inteira. `StripeBillingProvider` é exercitado contra localstripe
naquilo que ele suporta (retrieve, cancel) mais a verificação de assinatura e a
normalização de eventos, que são puras.

**Rationale.** Rodar a suíte de conformidade com um terço dos casos pulados em
silêncio seria pior que dizer isto em voz alta: o contrato é a definição de
"intercambiável", e uma passagem parcial não é uma.

**Consequências.** Stripe Checkout precisa ser validado contra a API real em
staging antes de produção. Registrado em `docs/04-ROADMAP.md`.

---

### DEC-010 — Portas de rede no intervalo 2xxxx

**Data:** 2026-08-05 · **Status:** accepted

Três projetos irmãos dividem esta máquina e todos queriam a 5432. Uma porta
namespaced falha ruidosamente no bind, em vez de conectar a API ao banco do
vizinho em silêncio.

---

### DEC-011 — Stacks CDK vazias, criadas agora

**Data:** 2026-08-05 · **Status:** accepted

Seis stacks (`network`, `data`, `events`, `api`, `workers`, `observability`) sem
nenhum recurso, com o grafo de dependências já montado e validado a cada
`pnpm synth`.

**Rationale.** Mover um recurso de stack depois do deploy significa destruir e
recriar; para o banco, isso é indisponibilidade e restore. A divisão é a decisão
cara, não o conteúdo.

---

### DEC-012 — Fakes são também os drivers `memory`

**Data:** 2026-08-05 · **Status:** accepted

As implementações in-memory em `@vpn/testing/fakes` são o driver que roda de
verdade quando `*_DRIVER=memory`.

**Rationale.** Um fake que não roda em lugar nenhum diverge do adapter real sem
que ninguém note. Sendo o driver de desenvolvimento, ele é exercitado todo dia.

**Consequências.** Nada sob `fakes/` pode importar vitest — seria uma dependência
de teste no grafo de produção. `testing.guard.spec.ts` cobra isso, e o subpath
`@vpn/testing/contracts` (que importa vitest) é separado de
`@vpn/testing/fakes`.

---

### DEC-013 — Código sem comentário explicativo

**Data:** 2026-08-05 · **Status:** accepted

**Contexto.** A fase 1 foi escrita com um bloco de cabeçalho por arquivo
explicando por que ele existe, mais comentários inline justificando cada escolha
não óbvia. Ficou denso a ponto de o comentário competir com o código pela
atenção de quem lê.

**Decisão.** Comentário só em dois casos: pragma funcional (`v8 ignore`,
`eslint-disable`, `@ts-expect-error`) e uma linha curta onde o *valor* de uma
constante não se deduz do nome. Nada de bloco de cabeçalho.

**Rationale.** O porquê não deixa de ser registrado — muda para um lugar com
melhores propriedades. Um comentário sai de sincronia em silêncio: nada falha
quando o código muda e ele não. Um teste falha. Um `CLAUDE.md` de diretório é
lido antes de mexer ali. Um `DEC-NNN` é datado e tem status. O `atlas` opera
assim (≈7% de densidade, explicação nos 19 `CLAUDE.md` e no decision log) e é o
repositório mais disciplinado das três referências.

**Consequências.** `ports.guard.spec.ts` e `testing.guard.spec.ts` passam a
exigir a **ausência** de bloco de comentário, onde antes exigiam a presença.
`CLAUDE.md` §4, `docs/05-PADROES-DE-CODIGO.md` §6 e `docs/specs/_TEMPLATE.md`
foram reescritos. A dívida que isso cria é `CLAUDE.md` por diretório: sem eles o
conhecimento simplesmente some, e é por isso que entram junto.

**Nota de execução.** A primeira tentativa de remoção usou o scanner do
TypeScript para apagar ranges por offset e corrompeu 105 arquivos, comendo o `{`
de `} catch {` e de `Promise<void> {`. O método correto apaga **linhas
inteiras** cujo conteúdo é só comentário, nunca um trecho de linha, e o portão é
`pnpm typecheck` mais a suíte completa.

---

### DEC-014 — `@vpn/i18n` com traduções como módulo TypeScript

**Data:** 2026-08-05 · **Status:** accepted

**Contexto.** O `convoy` usa i18next com `i18next-fs-backend` no servidor e, no
mobile, importa os **mesmos** JSON por path relativo
(`../../../../libs/i18n/locales/...`) porque o fs-backend não roda em React
Native. Duas formas de carregar as mesmas chaves.

**Decisão.** As traduções são arquivos `.ts` exportando objeto `as const`.
`@vpn/i18n` não tem dependência de runtime além de `@vpn/contracts`, e roda
idêntico em Node e no browser. O tradutor é próprio: interpolação `{{var}}`,
chave inexistente devolve a própria chave.

**Rationale.** Duas locales e ~90 chaves não pagam i18next mais react-i18next no
bundle, e um catálogo em TypeScript dá o que JSON não dá: `pt-BR.ts` é a fonte
da verdade **estrutural** — `LocaleMessages` é um mapped type derivado dele, e
`en.ts` não compila com uma chave faltando. Paridade em tempo de compilação, não
só em teste.

**Consequências.** Sem regra de plural pronta. Se aparecer plural de verdade, a
troca por i18next é contida porque tudo passa por `getTranslator`. Testes que o
`convoy` não tem: paridade de chaves, ausência de chave vazia, e cobertura de
todo `ApiErrorCode`.

---

### DEC-015 — Locale: precedência conta > `Accept-Language` > fallback

**Data:** 2026-08-05 · **Status:** accepted

**Contexto.** `accounts.locale` existia no schema desde o início e **nunca era
escrito** — `register` aceitava `locale`, o controller repassava ao e-mail, e o
adapter descartava.

**Decisão.** `IIdentityProvider.register` recebe `locale` e persiste; a suíte de
conformidade cobra dos dois adapters. `request-context.ts` carrega
`{ correlationId, locale }` num AsyncLocalStorage; `localeOf(account)` é o único
ponto que decide, e a conta vence o header.

**Rationale.** ALS em vez de threading explícito porque o correlationId já
estava lá e a alternativa é mais um parâmetro em toda assinatura. A conta vence
o header porque um e-mail disparado por webhook não tem header nenhum, e o
idioma que o usuário escolheu não deveria depender de qual requisição causou o
envio.

**Consequências.** `registerRequestSchema.locale` é **opcional**, não tem
default: com default, `body.locale` nunca é `undefined` e o fallback para o
header nunca dispara. Esse bug existiu e o e2e pegou. `PATCH /auth/me/locale`
para trocar.

---

### DEC-016 — Registry de adapters e tokens `Symbol`

**Data:** 2026-08-05 · **Status:** accepted

**Contexto.** `adapters.module.ts` era onze blocos `useFactory` quase iguais, e
os tokens de DI eram string — colidíveis com qualquer outro provider.

**Decisão.** Cada porta declara `defineAdapter({ token, driver, inject,
drivers })`; `toProviders()` gera os providers. Tokens viram
`Symbol.for('vpn.<porta>')` em `@vpn/ports`.

**Rationale.** A lista de drivers de cada porta passa a ser dado, não código
repetido, e um driver desconhecido falha no boot com a lista dos conhecidos em
vez de silenciosamente cair no `else`. É o problema que o `atlas` tem em aberto:
lá as variáveis `*_PROVIDER` são validadas e nunca lidas, e a seleção é ad hoc
em cada módulo.

**Consequências.** O generic de `defineAdapter<IPorta>` é obrigatório — sem ele
o TypeScript infere do primeiro driver do mapa e passa a exigir os campos
privados dele nos outros.

---

### DEC-017 — Fronteiras de módulo verificadas por lint

**Data:** 2026-08-05 · **Status:** accepted

**Contexto.** `pnpm lint` não rodava nada. Toda regra de fronteira do
`CLAUDE.md` era honra.

**Decisão.** `@nx/enforce-module-boundaries` com tags por projeto:
`type:app` só depende de `type:lib` e `type:adapter`; `type:adapter` só de
`type:lib`; `type:infra` de nada. `apps/api-lambda` é `type:deployment` — um
invólucro de deployment que legitimamente embrulha `apps/api`, e nomear isso é
melhor que abrir exceção.

**Rationale.** Copiado do `atlas`, onde é praticamente todo o conteúdo do
`eslint.config.mjs`. A regra foi verificada com uma sonda: um `type:infra`
importando `@vpn-poc/env` falha.

**Consequências.** `enforceBuildableLibDependency: false` — `libs/env` e
`libs/database` são consumidas como fonte, não como pacote construído, e a
checagem não descreve este workspace. `pnpm lint` entra no `verify`.

`@typescript-eslint/consistent-type-imports` fica **desligada** no código Nest
(`apps/api`, `apps/api-lambda`, `libs/adapters`). O autofix dela converteu cinco
classes injetadas para `import type`, o que apaga o `emitDecoratorMetadata` e
derruba o container no boot — a suíte e2e pegou. A regra continua ligada no
resto do workspace, onde não há DI por metadata.
