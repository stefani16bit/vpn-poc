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
guardado como SHA-256, pertence a uma _família_, e rotaciona a cada uso. Token
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
`eslint-disable`, `@ts-expect-error`) e uma linha curta onde o _valor_ de uma
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

---

### DEC-018 — `vite-node` como runner de dev da API, e pm2 via `sh -c`

**Data:** 2026-08-05 · **Status:** accepted

**Contexto.** `pnpm dev:apps` não subia. Três falhas empilhadas: (1) o pm2 não
consegue lançar `pnpm` no Windows, onde ele resolve para um `.cmd` — o fork mode
ou dá `require()` no arquivo, e `@ECHO off` vira `SyntaxError`, ou, com
`interpreter: 'none'`, faz `spawn` sem shell, que o Node 22 recusa com `EINVAL`;
(2) o `tsx` casa cada arquivo contra o `include` do tsconfig que resolve, e as
libs ficam fora do `include` de `apps/api`, sendo transformadas sem
`experimentalDecorators`; (3) mesmo com isso corrigido, o esbuild do `tsx` não
implementa `emitDecoratorMetadata`, então toda injeção por tipo resolve
`undefined` — o mesmo modo de falha do DEC-017, por outra causa.

**Decisão.** O `dev` da API roda em `vite-node`, e o `ecosystem.config.cjs`
lança cada app com `script: 'sh'`, `args: ['-c', 'pnpm --filter … dev']` e
`interpreter: 'none'`.

**Rationale.** O Vitest já provava que este código-fonte tem DI funcional: o
e2e sobe a aplicação inteira e passa. Ele transforma com Vite 8 + oxc, que emite
os metadados; o `tsx` transforma com esbuild, que não. Adotar `vite-node` faz o
dev usar exatamente o pipeline que os testes validam, em vez de um segundo
transformador com semântica própria de decorators. `sh` já é pré-requisito do
devstack, então o `sh -c` não acrescenta dependência de máquina.

**Consequências.** `vite-node` entra como devDependency de `apps/api`; o `tsx`
continua no repo, mas só para `db:migrate`, que não tem decorators. Um runner de
dev que divirja do transformador dos testes volta a ser capaz de esconder um
erro de DI até o boot — a regra é que os dois andem juntos.

---

### DEC-019 — shadcn/ui copiado no repositório, sem pacote de UI

**Data:** 2026-08-05 · **Status:** accepted

**Contexto.** `apps/web` não tinha nenhuma dependência de UI: uma folha de estilo
global de 163 linhas, sete variáveis CSS e ~12 nomes de classe aplicados como
string literal no JSX. A duplicação era mensurável — `<section className="card">`
nove vezes em cinco arquivos, a tela terminal de mensagem copiada cinco vezes, e
`verify-email.page.tsx` reimplementando `Field` e `Submit` à mão porque seu
formulário não é dirigido por react-hook-form.

**Decisão.** Tailwind v4 + shadcn/ui + CVA + Radix, com os componentes
**copiados para dentro** de `apps/web/src/components/ui/`. Não existe pacote
`@vpn/ui`.

**Rationale.** Um pacote publicado tem exatamente um consumidor hoje, e cada
ajuste de componente custaria bump de versão, publicação no Verdaccio e
`consumer-check` — que é um script de JS puro e não sabe verificar JSX nem CSS.
A fronteira que DEC-002 protege é a de publicação, e não há nada para publicar.
shadcn/ui em vez de uma biblioteca instalada porque o componente copiado é
editável: a regra de i18n deste repositório proíbe literal voltado ao usuário, e
isso é impossível de cumprir dentro de um `node_modules`.

**Consequências.** Isto contradiz `apps/web/CLAUDE.md` ("Sem biblioteca de
componentes: seis telas não pagam uma") e o comentário de cabeçalho de
`styles.css` — ambos reescritos. **Código copiado de um registry é código
nosso**: um literal nele é um literal no nosso app, e passa a valer a mesma
regra de `t()`. `components/ui/**` fica fora da cobertura (DEC-028), e o motivo
está em `apps/web/CLAUDE.md`, não implícito.

---

### DEC-020 — Alias `@/*` em `apps/web`

**Data:** 2026-08-05 · **Status:** accepted

**Contexto.** O repositório inteiro usa import relativo com extensão explícita.
O CLI do shadcn emite `@/components/ui/...` e `@/lib/cn`, e reescrever cada
componente gerado à mão anula o motivo de usar o gerador.

**Decisão.** `paths: { "@/*": ["./src/*"] }` em `apps/web/tsconfig.json` e o
alias correspondente em `resolve.alias` do `vite.config.mts`. Import relativo
sobrevive só dentro de um mesmo diretório. `apps/api` **não** ganha alias.

**Rationale.** `apps/web` resolve por `Bundler` e tem um bundler; `apps/api`
resolve por `NodeNext` e roda em Node, onde `paths` do TypeScript não existe em
runtime e precisaria de um resolver adicional para funcionar. O alias vale onde
o bundler já o implementa, não como estética.

**Consequências.** `"baseUrl": "."` precisa ser **redeclarado** em
`apps/web/tsconfig.json`. `tsconfig.base.json` define `baseUrl: "."` relativo à
raiz do repositório, e sem a redeclaração `@/lib/cn` resolve para
`<repo>/src/lib/cn` — o erro aponta para o import, nunca para o config. `paths`
substitui, não mescla: o mapa `@vpn-poc/*` herdado desaparece em `apps/web`, o
que é inócuo porque `apps/web` não importa nenhum deles. O `vite.config.mts` é
ESM e não tem `__dirname`; o alias usa `fileURLToPath(new URL(...))`.

---

### DEC-021 — Tema claro e escuro com tokens `@theme`, escuro por padrão

**Data:** 2026-08-05 · **Status:** accepted

**Contexto.** O app era escuro incondicional: `color-scheme: dark` num `:root`,
sem `prefers-color-scheme`, sem alternância, e sem paleta clara para onde ir.

**Decisão.** As sete variáveis viram um par de paletas em oklch declaradas em
`:root` e `.dark`, expostas como utilitários por `@theme inline`. `<html>` nasce
com `class="dark"` no markup; a preferência vive em `localStorage`.

**Rationale.** shadcn/ui já entrega as duas paletas — adotar só metade custa o
mesmo e entrega menos. A paleta clara mantém o matiz da escura e inverte a
luminosidade, então são duas pontas de uma paleta, não duas paletas. `class` no
markup em vez de aplicar no `useEffect` porque o efeito roda depois da primeira
pintura, e um frame branco num app escuro é visível.

**Consequências.** `color-scheme` passa a ser declarado por tema, não uma vez em
`:root`, para que scrollbar e controles nativos sigam. Existe um script inline
no `index.html` — o único do app — que remove `.dark` para quem escolheu claro;
é pragma funcional, não prosa, e DEC-013 continua valendo. `--ring` passa a
existir nos dois temas, o que fecha por construção a ausência de anel de foco em
botão e link.

---

### DEC-022 — Sem Prettier; ordem de classe por lint

**Data:** 2026-08-05 · **Status:** superseded by DEC-044

**Contexto.** O repositório não tem formatador: nenhum `.prettierrc`, nenhum
`.editorconfig`, nenhum script `format`, indentação por tab por convenção. Com
Tailwind, a ordem das classes vira uma questão de diff.

**Decisão.** `eslint-plugin-better-tailwindcss`, não Prettier e não
`prettier-plugin-tailwindcss`.

**Rationale.** `pnpm verify` já roda `pnpm lint`, então uma regra de lint torna
a ordem de classes um portão com zero etapa nova de pipeline. Prettier não é um
ordenador de classes que também formata — é uma reformatação do repositório
inteiro, que reescreveria a quebra de linha manual do `eslint.config.mjs`, todo
`.ts` de `apps/api`, `libs/` e `infra/`, e os blocos de código de sete
documentos. Além disso o plugin do Prettier **só ordena**: não sabe dizer que
`bg-surface` não é um token que definimos, que é exatamente o modo de falha de
uma paleta customizada. `better-tailwindcss` dá ordenação **mais**
`no-unknown-classes`, `no-conflicting-classes` e `no-duplicate-classes`.

**Consequências.** `enforce-consistent-line-wrapping` fica **desligada**: ela
briga com a indentação por tab e gera ruído a cada edição de `className`.
Ordenar é o valor; quebrar linha é gosto.

---

### DEC-023 — `apps/web` por feature; RTK Query em base mais `injectEndpoints`

**Data:** 2026-08-05 · **Status:** accepted

**Contexto.** `app/store/api.ts` era um único `createApi` com todos os endpoints
de auth e de cobrança. As páginas ficavam em pastas planas, e
`password-reset.pages.tsx` continha dois componentes de página.

**Decisão.** `features/<feature>/{api,components,hooks,pages}`. O `createApi`
fica reduzido a transporte e `tagTypes`; cada feature injeta os seus endpoints
com `api.injectEndpoints`.

**Rationale.** `injectEndpoints` muta o mesmo objeto `api`, então **não há
mudança de wiring**: o reducer já está montado em `api.reducerPath` e não existe
lista de registro para manter em sincronia. O endpoint passa a existir no
momento em que seu módulo é importado — e ele é importado porque a página
importa o hook. `tagTypes` fica na base porque `injectEndpoints` não sabe
acrescentar tag, e `enhanceEndpoints({ addTagTypes })` colocaria o vocabulário
de tags em dois lugares.

**Consequências.** O outro lado da mesma moeda: um endpoint cujo arquivo ninguém
importa silenciosamente não existe. `overrideExisting: false` é explícito porque
o default avisa em desenvolvimento quando o HMR reavalia o módulo.

---

### DEC-024 — `apps/api` em camadas com kernel `shared/`

**Data:** 2026-08-05 · **Status:** accepted

**Contexto.** `modules/auth/` eram sete arquivos sem subpasta. `auth.guard.ts`
carregava quatro exports em 59 linhas; `auth.service.ts` misturava rate limit,
identidade, sessão, composição de e-mail e mapeamento em 235.

**Decisão.** Cada módulo ganha `controllers/`, `services/`, `repositories/` e
`mappers/`. `common/` vira `shared/`.

**Rationale.** "common" é onde as coisas vão quando ninguém decidiu. "Kernel
compartilhado" nomeia uma regra de verdade — _a camada da qual todo módulo pode
depender e que não pode depender de módulo nenhum_ — e essa regra passa a ser
verificada por lint (DEC-027). Sem a regra, o rename seria só gosto.

**Consequências.** Isto contradiz `docs/05-PADROES-DE-CODIGO.md` §4, que
documentava a forma plana como a convenção; a seção é reescrita e esta entrada
diz que foi. `common.spec.ts`, que cobria quatro arquivos de uma vez, se divide
em três specs colocalizados, e o `HealthController` declarado inline em
`health.module.ts` vira arquivo — pelo mesmo motivo.

---

### DEC-025 — Controle de acesso é kernel, não domínio de auth

**Data:** 2026-08-05 · **Status:** accepted

**Contexto.** `AccessTokenGuard` morava em `modules/auth/`, e
`billing.controller.ts` o importava por `../auth/auth.guard.js`. `BillingModule`
importava `AuthModule` só por causa disso, e `apps/api/CLAUDE.md` registrava a
exceção em vez de resolvê-la.

**Decisão.** `AccessTokenService`, `AccessTokenGuard`, `@AllowUnverified()`,
`@Auth()` e `AuthenticatedRequest` vão para `shared/access-control/`, atrás de
um `AccessControlModule`. `BillingModule` deixa de importar `AuthModule`.

**Rationale.** A premissa de que o guard precisa de conhecimento de domínio não
sobrevive à leitura do código: `canActivate` lê `claims.emailVerified` — uma
claim **dentro do JWT**, posta lá por `AccessTokenService.issue`. Ele nunca
consulta uma conta, nunca toca `IIdentityProvider`, nunca importa `AuthService`.
Sua única dependência é `AccessTokenService`, que é `jose` mais issuer, audience
e TTL. É maquinaria de requisição da mesma espécie que `ZodBody` e
`GlobalExceptionFilter`.

**Consequências.** A linha do `apps/api/CLAUDE.md` sobre a exceção é
**apagada**. A exceção existia porque o guard estava no lugar errado; corrigir o
lugar é o que faz a regra "nenhum módulo importa outro" passar a ter zero
exceções — e só uma regra sem exceção pode ser verificada por lint.
`AccessControlModule` **não** é `@Global()`: `AdaptersModule` é global porque
uma porta é um fato global; controle de acesso é dependência que se declara.

---

### DEC-026 — Repositório é código nosso e não ganha interface

**Data:** 2026-08-05 · **Status:** accepted

**Contexto.** Três estilos de persistência coexistiam: porta mais adapter
(`IIdentityProvider`), drizzle direto em `billing.service.ts` e drizzle direto
em `verification-token.service.ts`. Extrair os dois últimos levanta a pergunta
de se eles viram portas.

**Decisão.** `VerificationTokenRepository`, `SubscriptionRepository` e
`BillingEventRepository` são classes injetáveis comuns em `repositories/`. Sem
interface `I*`, sem porta, sem suíte de conformidade.

**Rationale.** Pelo critério do inegociável nº 1 — _"eu teria que substituir
isto?"_. A dependência externa é o Postgres, e ela **já** está atrás de uma
fronteira: o token `DATABASE`, e para identidade a porta `IIdentityProvider` com
duas implementações conformes. Um repositório é o nosso código de query em cima
dessa fronteira — a mesma relação que `RateLimitService` tem com `ICacheStore`,
que DEC-004 já resolveu como "não é porta". Fazer deles portas exigiria uma
suíte de conformidade e uma implementação em memória para cada, para habilitar a
troca "rodar `verification_tokens` em algo que não seja Postgres" enquanto
`IIdentityProvider` continua Drizzle contra o mesmo banco. Metade da persistência
atrás de porta e metade não é pior que qualquer um dos dois extremos, porque
"você não sabe qual adapter recebeu" deixa de ser verdade e a garantia que a
arquitetura de portas vende vira uma afirmação a conferir tabela a tabela.

**Consequências.** A honesta: **repositório não tem teste unitário**. Fingir a
cadeia fluente do drizzle produz um teste que afirma o formato de uma API
fluente, não um comportamento. A corretude deles continua provada pelo e2e, que
já cobre reentrega de webhook e uso único de token. O ganho é que a _política_
sobe para classes que **são** testáveis — `VerificationTokenService` decide
`TOKEN_INVALID` contra `TOKEN_EXPIRED`, e isso não tinha teste nenhum. Teste de
integração de repositório entra no roadmap como dívida nomeada. O inegociável da
idempotência é preservado textualmente: `BillingEventRepository.claim()` **é** o
`onConflictDoNothing(...).returning()` que já existia, e o `false` é o índice
único perdendo a corrida, não uma consulta.

---

### DEC-027 — Zonas de importação intra-app verificadas por lint

**Data:** 2026-08-05 · **Status:** accepted

**Contexto.** `@nx/enforce-module-boundaries` (DEC-017) opera por projeto, então
todo `apps/api/src` é um nó só. Nada impedia mecanicamente `modules/billing` de
importar `modules/auth/auth.service.js`, nem `common/` de importar `modules/`.

**Decisão.** `eslint-plugin-import-x` com `no-restricted-paths`. Quatro zonas em
`apps/api` (o kernel não importa módulo; os dois módulos não se importam;
controller não importa repositório) e quatro em `apps/web` (`components/` não
conhece `features/`; `components/ui` só importa `lib/`; as duas features não se
importam).

**Rationale.** `eslint-plugin-import` declara peer `eslint ^9` e este repositório
é ESLint 10, então `import-x` é a única opção. O `no-restricted-imports` do core
foi recusado porque casa contra a **string do especificador**: `../billing/x.js`
e `../../billing/x.js` exigem regexes diferentes, e qualquer mudança de
profundidade de pasta desarma a regra em silêncio.

**Consequências.** `eslint-import-resolver-typescript` **não é opcional**: a
regra resolve cada especificador para um caminho de arquivo e **não faz nada**
quando a resolução falha — e todo import de `apps/api` é `'./foo.js'` apontando
para `foo.ts`, que só o resolver do TypeScript mapeia. Pelo precedente de
DEC-017, cada zona foi verificada com uma sonda: o import proibido acrescentado,
`pnpm lint` falhando com a mensagem pretendida, e revertido. As zonas de par
crescem em N·(N−1); a 2 módulos custa 2 zonas, e chegar a 5 é o sinal de
promover módulo a projeto Nx. `app.module.ts` e `bootstrap.ts` ficam em `src/`,
fora de todo `target`, porque são a composição.

---

### DEC-028 — O piso de cobertura de `@vpn/config` passa a ser aplicado

**Data:** 2026-08-05 · **Status:** accepted

**Contexto.** O `CLAUDE.md` promete 80% de cobertura com piso que só sobe.
`createVitestConfig` e `resolveThresholds` existem em `@vpn/config` e
implementam isso com `Math.max`. Nenhum `vitest.config.*` deste repositório
**nem de `packages/`** passava `coverage.thresholds`. O piso era código morto.

**Decisão.** `apps/api` e `apps/web` passam a usar o preset, e passam a usá-lo
**antes** da massa de `.tsx` nova aterrissar.

**Rationale.** `resolveThresholds` usa `Math.max(80, …)`, então não dá para
ligar abaixo de 80 — se o número de hoje está abaixo, ligar fica bloqueado até
os testes de extração existirem. Essa ordem é aritmética, não preferência.

**Medição.** O preset **não** liga `coverage.all`, e sem ele o relatório conta
só os arquivos que algum teste já importa. Medido assim, `apps/api` reportava
90%; medido sobre `src/**/*.ts`, reportava **40,4% de statements e 36,8% de
branches**. Os dois números descrevem o mesmo código — o primeiro é a razão de
o piso ter sobrevivido tanto tempo sem ninguém notar que era código morto. Por
isso `coverage.all` é ligado explicitamente no app, com um comentário no
arquivo, e não fica escondido no preset.

Fechar a diferença exigiu teste para `auth.service.ts`, os dois controllers, o
decorator `@Auth()`, `logger.config.ts`, o middleware de contexto e os
indicadores de health — nenhum deles tinha um. `apps/api` foi de 19 para 179
testes; o número agora é 100% de statements e 91,8% de branches. O gate também
foi sondado: com `--coverage.thresholds.branches=99` ele falha citando o valor
real, então é portão e não enfeite.

**Consequências.** Exclusões, cada uma com motivo: `*.module.ts` são
declarações; `bootstrap.ts` só é exercitado pela corrida e2e, que não gera
cobertura na corrida unitária; `repositories/**` porque DEC-026 decide que
repositório não tem teste unitário — sem essa exclusão as duas decisões se
contradizem e o piso fica inalcançável por construção, o que é a pior
combinação possível: uma regra que obriga a escrever o teste que outra regra
proíbe; `components/ui/**` é código de registry cujo
comportamento é do Radix e é coberto lá em cima — `select.tsx` sozinho são ~150
linhas de subcomponentes que nunca renderizamos. `components/form/**` e
`components/layout/**` **não** são excluídos: é onde mora comportamento nosso. A
regra que de fato segura a linha não é config nenhuma, e vai no checklist de
commit: **uma página não é convertida num commit que não acrescente o teste
dela**. `packages/` continua sem thresholds — dívida nomeada no roadmap.

---

### DEC-029 — Postura sobre o ecossistema `@nestjs/*`

**Data:** 2026-08-06 · **Status:** accepted

**Contexto.** `apps/api` usa três pacotes NestJS em runtime — `common`, `core`,
`platform-express` — mais `nestjs-pino`, da comunidade. Config, health, rate
limit, validação, JWT, cache e e-mail são código nosso ou portas. Duas dessas
escolhas estavam argumentadas (DEC-008 e DEC-004); as outras eram **omissão
silenciosa**, e omissão não é decisão: ninguém consegue discordar do que não
está escrito, e a pergunta "por que não usamos o pacote oficial?" voltava.

**Decisão.** A regra é a mesma que vale para qualquer dependência: o pacote
entra quando resolve um problema que temos, na forma em que o temos. Não entra
por ser oficial, e não deixa de entrar por ser de terceiro — `nestjs-pino` e
`@nestjs/terminus` (DEC-030) estão aqui. O veredito por pacote:

| Pacote                               | Veredito                        | Motivo                                                                                                                                                                                                               |
| ------------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `terminus`                           | **adotado**                     | DEC-030                                                                                                                                                                                                              |
| `throttler`                          | rejeitado                       | ver abaixo                                                                                                                                                                                                           |
| `config`                             | rejeitado                       | `libs/env` é zod mais descoberta de `.env`, e é consumido fora do Nest — migrations e `infra`. `ConfigModule` só existe dentro do container                                                                          |
| `jwt`                                | rejeitado                       | é wrapper de `jsonwebtoken`; usamos `jose`, e `AccessTokenService` injeta a porta `CLOCK`, que um wrapper não aceita                                                                                                 |
| `passport`                           | rejeitado                       | abstrai _várias_ estratégias; temos uma. O refresh é opaco com rotação por família (DEC-006) e não passa por strategy nenhuma                                                                                        |
| `class-validator` / `ValidationPipe` | rejeitado                       | DEC-008                                                                                                                                                                                                              |
| `cache-manager`                      | rejeitado                       | abstração concorrente com `ICacheStore`, que tem suíte de conformidade e chave estruturada em vez de string                                                                                                          |
| `axios`                              | rejeitado                       | não há HTTP de saída fora de SDK de vendor                                                                                                                                                                           |
| `schedule`, `event-emitter`          | não se aplica                   | não há cron; a stack `workers` está vazia (DEC-011) e a idempotência é índice único (DEC-026), não event bus                                                                                                         |
| `bullmq`                             | rejeitado — **ver DEC-046**     | dizia "não se aplica: não há fila". Passou a haver. É Redis, não SQS; concorre com a porta `IJobQueue`, o mesmo motivo que rejeitou `cache-manager`; e não removeria o outbox, porque `queue.add()` segue dual-write |
| `swagger`                            | adiado, com a forma já definida | não há OpenAPI hoje. `@ApiProperty` seria a segunda definição de "corpo válido" que DEC-008 rejeita; a forma aceitável é gerar o spec **a partir** de `@vpn/contracts` e usar `@nestjs/swagger` só para servir a UI  |

**Por que `@nestjs/throttler` não substitui `RateLimitService`.** DEC-004 decide
que rate limit não é porta; isto decide que também não é guard. São três
incompatibilidades, não preferência:

1. O sujeito é o **e-mail**, nunca o IP, e `consume()` roda antes de qualquer
   consulta de conta — é isso que sustenta o inegociável de não revelar se um
   endereço tem cadastro. `ThrottlerGuard` rastreia por IP, e credential
   stuffing troca de IP contra um endereço só. Sobrescrever `getTracker()` para
   ler `req.body.email` chavearia o contador num campo ainda não validado nem
   normalizado, porque guard roda antes do `ZodBody`.
2. `ThrottlerStorage.increment(key, ttl, limit, blockDuration, name)` devolve
   `{ totalHits, timeToExpire, isBlocked, timeToBlockExpire }`.
   `ICacheStore.increment(key, ttlSeconds)` devolve um número. O adapter exigiria
   alargar uma interface **publicada**, mais a suíte de conformidade, mais
   republicar no Verdaccio — para caber na forma de interface de um terceiro.
3. `ThrottlerException` é `HttpException(429)`, e o `GlobalExceptionFilter` não
   tem ramo para 429: cairia em `VALIDATION_FAILED`, e o front renderiza
   `errors.<CODE>`.

**Consequências.** Um pacote `@nestjs/*` recusado passa a ter linha nesta
tabela; a tabela é o lugar de discordar. O que `throttler` daria de graça e não
temos — `Retry-After` — vira dívida nomeada no roadmap, e não é obtível sem
mudar a porta: `increment` não devolve o TTL restante.

---

### DEC-030 — Health checks via `@nestjs/terminus`

**Data:** 2026-08-06 · **Status:** accepted

**Contexto.** `GET /health/ready` respondia **200 mesmo com
`status: 'degraded'`**. Um readiness probe que nunca falha não tira instância
de rotação — o endpoint existia, era testado, e não fazia a única coisa para a
qual serve.

**Decisão.** `HealthService` é apagado e a agregação passa a ser
`HealthCheckService.check()`, do `@nestjs/terminus`. Ele lança
`ServiceUnavailableException` quando qualquer indicador está `down`, e o corpo
de `/health/ready` passa a ser `{ status, info, error, details }`.

**Rationale.** O ganho não é contagem de linhas — o `Promise.all` mais
agregação que sai tinha 28 linhas e estava correto naquilo que fazia. É a
semântica de 503, que era o defeito, mais um formato que ferramenta de fora já
sabe ler. Pelo critério de DEC-029, é exatamente o caso em que o pacote oficial
resolve o problema na forma em que o temos.

**Consequências.** `HealthModule.forRoot({ readiness })` e o token-array
`HEALTH_INDICATORS` **permanecem**: a plugabilidade é decisão nossa, não algo
que terminus substitui. `indicators.ts` não muda — `databaseIndicator` e
`cacheIndicator` continuam funções puras sem import de terminus, e
`QueryableDatabase` continua tipado estruturalmente para que o módulo não
importe `@vpn-poc/database`. O adaptador de `HealthIndicator` para
`HealthIndicatorFunction` mapeia falha para `{ status: 'down' }` **sem a
mensagem do erro**: `/health/ready` não é autenticado, e "no route to
10.0.1.5:5432" é topologia interna.

`HealthCheckFilter` é `@Catch(ServiceUnavailableException)` aplicado com
`@UseFilters()` **no controller**, não global. Sem ele o `GlobalExceptionFilter`
trata o 503 como `status >= 500`: reescreveria o corpo para
`{ code: 'INTERNAL' }` — perdendo o detalhe por dependência, que é o motivo do
endpoint existir — e chamaria `reporter.capture()`, transformando cada probe
falho em evento no Sentry. O escopo local mantém health fora do kernel de erros.
Pelo mesmo motivo o logger do terminus é desligado (`logger: false`): o filtro
loga uma vez, em `warn`, pelo logger do app. `logger.config.ts` já ignora
`/health` e `/health/ready` no log de HTTP, e sem essas duas medidas um probe
por segundo vira duas linhas por segundo.

Terminus traz `boxen` e `check-disk-space` como dependências de runtime. É o
custo, e está registrado aqui para que não pareça de graça.

---

### DEC-031 — Sem agregador de log local; `LOG_TRANSPORT` como porta de saída

**Data:** 2026-08-06 · **Status:** accepted

**Contexto.** Rastrear uma requisição localmente era doloroso. O dado já
existia — `requestContextMiddleware` põe `{ correlationId, locale }` num
`AsyncLocalStorage` e o `mixin` do pino injeta os dois em **toda** linha — mas a
saída não servia: em desenvolvimento o `pino-pretty` imprimia texto colorido com
`messageFormat` padrão, o `correlationId` ficava enterrado no meio da linha, e o
pm2 capturava esse texto em `logs/api.out.log`. Texto colorido não se filtra por
campo. A pergunta inicial foi wire de Graylog.

**Decisão.** Nenhum agregador roda no devstack. O que entra é `LOG_TRANSPORT`
(`pretty | json | file | gelf | loki`) mais `LOG_TRANSPORT_URL`, um
`messageFormat` que abre a linha pelo `correlationId`, um alvo `pino/file`
paralelo escrevendo `logs/api.ndjson`, e `pnpm logs:trace <correlationId>`.

**Rationale.** Graylog resolve "os logs de N hosts estão em N lugares". Um
devstack de um desenvolvedor não tem esse problema — tem um problema de formato
e de busca, que custa ~20 linhas de configuração. O preço do Graylog seria
MongoDB mais Datanode/OpenSearch: três containers, ~1GB de heap, ~90s de boot
frio contra os poucos segundos que `make check` leva hoje, e provisionamento
não-declarativo do input GELF — código de devstack que só existe para servir a
ferramenta de log. E a dependência de OpenSearch, que indexa o corpo inteiro, é
**a mesma** razão pela qual ele pesa no laptop e custa em produção: são uma
objeção, não duas.

Em produção a API é Lambda. `LOG_TRANSPORT=json` emite NDJSON em stdout, o
Lambda entrega ao CloudWatch de graça e o Logs Insights indexa campo de JSON
nativamente — `filter correlationId = "..."` funciona sem agente e sem
container. Loki ou Graylog passam a se pagar quando houver vários serviços para
correlacionar entre si; uma Lambda e um front-end não são isso ainda.

**Consequências.** `gelf` e `loki` são aceitos pelo schema e caem em `json` com
aviso: a saída é tipada e real, mas nenhuma dependência de transporte é
instalada antes de alguém precisar. É isso que torna o adiamento seguro em vez
de otimista.

`json` não configura `transport` **nenhum**, de propósito: um transport do pino
é uma worker thread, e o freeze/thaw do Lambda a congela no meio do flush.

O alvo `pino/file` usa `append: false` — trunca a cada boot. Uma sessão de
desenvolvimento, um arquivo, sem rotação e sem crescimento indefinido; o preço é
que o rastro da sessão anterior se perde no restart.

**Isto é um desvio consciente do inegociável nº 1.** Não existe `ILogSink` em
`@vpn/ports` nem suíte de conformidade. A camada de transport do pino já **é** a
abstração substituível, e `LOG_TRANSPORT` a seleciona pelo mesmo mecanismo com
que um `SENTRY_DSN` vazio seleciona o `NoopErrorReporter` — uma porta aqui
duplicaria maquinário em vez de criar uma fronteira. Log é transversal: ele não
é chamado por um service, ele envolve todos.

---

### DEC-032 — Reautenticar é condicionado ao estado da sessão, e o devstack fala um host só

**Data:** 2026-08-06 · **Status:** accepted

**Contexto.** `WEB_ORIGIN` apontava para `localhost:5173` e `VITE_API_URL` para
`127.0.0.1:3000`. O cookie de refresh é `SameSite=Lax`: para o navegador esses
são dois **sites** diferentes, então o cookie era gravado no login e nunca mais
enviado. Todo `POST /auth/refresh` respondia 401 — a sessão funcionava enquanto
a aba estivesse aberta, porque o access token vive em memória, e morria no
primeiro reload.

Isso deveria ter sido um erro visível uma vez. Virou um laço infinito de
`/auth/refresh` na tela de login: o `baseQuery` tratava todo 401 como um convite
novo a reautenticar, e o `sessionCleared` resultante derrubava o cache do RTK
Query, provocando o refetch da query ainda inscrita que produzia o próximo 401.

**Decisão.** (a) O devstack inteiro fala `127.0.0.1` — `WEB_ORIGIN`,
`VITE_API_URL` e o `server.host` do Vite. (b) O `baseQuery` só tenta
reautenticar quando `auth.status === 'authenticated'`.

**Rationale.** A configuração era o gatilho; o laço era a ausência de uma
condição de parada, e essa ausência sobrevive à correção da configuração —
família de refresh revogada, API fora do ar e relógio dessincronizado produzem
o mesmo 401 com o host certo.

A condição de parada certa não é contador nem flag de módulo: é o estado que o
app já mantém. `unauthenticated` significa "já perguntamos, não há sessão", e
reperguntar não pode dar outra resposta — o latch se limpa sozinho no
`sessionResolved`, sem estado global para resetar entre testes. `unknown`
pertence a `use-bootstrap-auth`, e duas tentativas concorrentes se invalidariam
pela rotação de família (DEC-006).

`127.0.0.1` e não `localhost` porque `main.ts` escuta em `0.0.0.0`, que é IPv4
apenas, e o Node 22 resolve `localhost` para `::1` primeiro. Canonizar em
`localhost` exigiria mexer no bind de produção para consertar o devstack. O CORS
continua aceitando **um** origin: aceitar os dois esconderia o desencontro, e
`WEB_ORIGIN` também compõe as URLs dos e-mails, que precisam de um valor só.

**Consequências.** Abrir `http://localhost:5173` passa a falhar em conectar em
vez de logar-e-nunca-refrescar. É a falha ruidosa que faltava, o mesmo critério
das portas do devstack no range 2xxxx.

`refreshInFlight` continua ao lado do latch, e não é redundância: ele resolve
concorrência dentro do mesmo tick, quando dez componentes chegam ao 401 antes de
qualquer dispatch. O latch resolve a sequência, que ele nunca resolveu.

O mesmo commit corrigiu uma segunda porta aberta para o laço: `isAuthRoute`
testava `typeof args !== 'string'`, então um endpoint declarado na forma curta
— `me: () => 'auth/me'` — não era reconhecido como rota de auth e um 401 nele
disparava refresh.

---

### DEC-033 — `module` como dimensão de log, e um NDJSON por módulo no devstack

**Data:** 2026-08-06 · **Status:** accepted

**Contexto.** A DEC-031 deu formato e busca ao log, mas não deu **origem**. Toda
linha sai com `service: 'poc-vpn-api'`, um serviço só, enquanto `auth` e
`billing` são unidades de deploy futuras — Lambdas separadas. O corte que a
produção vai fazer fisicamente não existia no dado.

**Decisão.** Um campo `module` (`auth | billing | health | http | system`) em
toda linha, por dois caminhos com precedência definida:

- **binding de child do pino** nos serviços, via o provider `MODULE_LOGGER` que
  cada módulo registra — quem **emite** a linha;
- **`AsyncLocalStorage`**, derivado do prefixo da rota por `moduleForUrl`, para
  tudo que não passa por um serviço nosso: o auto-log do `pino-http`, os
  filtros de exceção, qualquer código de terceiro. Fora de uma requisição o
  valor é `system`.

E, nos transports de dev (`pretty` e `file`), um `logs/api.<module>.ndjson` ao
lado do `logs/api.ndjson` combinado.

**Rationale.** Quem emite ganha de quem roteia: um serviço de `auth` alcançado a
partir de uma rota de `billing` continua sendo linha de `auth`, que é a
semântica de "esta linha pertence à Lambda de auth".

O `mixin` do pino **sobrescreve** os bindings do child — o contrário do que a
intuição diz, e o teste que fixa isso está em `module-logger.spec.ts`. Por isso
o `mixin` lê `logger.bindings()` e só supre `module` quando o child não o
trouxe; sem essa deferência todo log de serviço sairia rotulado com a rota.

O fan-out por arquivo não sai de graça: `transport.targets` não filtra por
campo e o pino recusa `stream` junto de `transport`, então `pretty` e `file`
deixam de usar worker e passam por um `stream` nosso — o `pino-pretty` volta
para dentro do event loop. Aceitável porque esses dois transports **são**
devstack. A alternativa, um transport worker próprio, exigiria um entry `.js`
construído e resolvível de dentro da worker thread, que o `vite-node` do dev não
dá (DEC-018).

Em produção nada disso existe: `LOG_TRANSPORT=json` não configura transport
**nem** stream, a Lambda entrega stdout ao CloudWatch, e no dia em que os
módulos virarem Lambdas cada uma ganha seu log group de graça. O arquivo por
módulo é conveniência de devstack; o **campo** é o que transfere.

**Consequências.** As destinations abrem na primeira linha, não na construção —
sem isso, rodar os testes unitários truncaria o `logs/api.ndjson` da sessão de
desenvolvimento em curso, e um módulo que nunca loga não deixa arquivo.

O `logs:trace` continua lendo o arquivo **combinado**: é o único onde um rastro
que cruza módulos permanece inteiro. Os arquivos por módulo servem para `tail`.
Ele ganhou `--module <nome>` e uma coluna de módulos na listagem.

Serviços passam a receber um `pino.Logger` pelo token `MODULE_LOGGER` em vez de
instanciar o `Logger` do Nest. As chamadas não mudaram — já estavam na forma
`(obj, msg)` do pino. Os filtros do kernel continuam com o `Logger` do Nest de
propósito: eles são globais, não pertencem a módulo nenhum, e o ALS já os
atribui corretamente.

**Herda a isenção da DEC-031** quanto ao inegociável nº 1: não existe
`ILogSink`, e `module` é um binding sobre um logger que já é nosso, um nível
abaixo do transport que a DEC-031 já isentou.

---

### DEC-034 — Account é a empresa; a pessoa vira User

**Data:** 2026-08-06 · **Status:** accepted

**Contexto.** O produto é whitelabel: quem compra é uma empresa, que recebe um
domínio, uma assinatura e vários acessos de pessoas. O modelo atual tem uma
tabela `accounts` que é uma pessoa, e nada acima dela.

**Decisão.** `accounts` passa a ser a **empresa**. A tabela de hoje é renomeada
para `users` e ganha `account_id` e `role`. O índice único de e-mail vira
`(account_id, email)`.

**Rationale.** "Account" é a palavra que o produto usa para a empresa que compra,
e a definição original em `CONTEXT.md` já reservava o rename para o dia do acesso
delegado. Rejeitados `tenants` e `organizations`: ambos custariam zero churn hoje
— nada seria renomeado, só acrescentado — mas deixariam o código chamando de
"tenant" aquilo que toda conversa comercial chama de "account", e essa
divergência não se paga depois. O momento é agora justamente porque o custo do
rename só cresce: seis tabelas, seis telas.

**Consequências.** Toca `libs/database/src/schema.ts` e a migration, o `sub` do
JWT, `IIdentityProvider` em `@vpn/ports` — que é **publicado**, logo exige
`packages:publish:local` e o `consumer-check` —, a suíte de conformidade de
identidade e as seis telas de `apps/web/features/auth`.

`accounts` deixa de ter e-mail e senha: essas colunas são de `users`. Uma account
nasce sem nenhum user, entre o webhook de ativação e o resgate do claim token
(DEC-039), e esse estado precisa ser representável.

---

### DEC-035 — Isolamento por RLS, não por `WHERE` na aplicação

**Data:** 2026-08-06 · **Status:** accepted

**Contexto.** Com múltiplas empresas no mesmo banco, toda query de domínio passa
a ter uma condição de tenant. A pergunta é onde essa condição mora.

**Decisão.** `account_id` em toda tabela de domínio, e uma policy de RLS por
tabela contra `current_setting('app.account_id')`, fixado com `SET LOCAL` na
transação da requisição. **Cada tabela ganha um teste negativo obrigatório**: um
`SELECT` com o setting de outra account devolve zero linhas.

**Rationale.** Um `WHERE account_id = ?` na aplicação funciona em noventa e nove
queries e falha na centésima — e a falha não é um erro, é um resultado com dados
de outra empresa. A policy é a única formulação em que esquecer a condição
produz "nada" em vez de "os dados errados".

O teste negativo é o que separa isto de teatro: uma policy contra uma conexão
superusuária lê como correta e não faz nada. A DEC-005 já criou `vpn_app`
`NOINHERIT` e **sem `BYPASSRLS`** exatamente para este dia — esta decisão não a
supera, a consome. `app_system` (NOLOGIN, bypass deliberado) continua sendo a
saída para jobs que legitimamente cruzam accounts.

**Consequências.** Toda requisição passa a abrir transação e emitir `SET LOCAL`
antes de qualquer query — hoje nem todo handler transaciona. Os repositórios não
ganham parâmetro de tenant, e isso é o ponto: eles não sabem que a tenancy
existe. O `SET LOCAL` é responsabilidade do kernel, não dos módulos.

---

### DEC-036 — Entitlements são um mapa versionado em código

**Data:** 2026-08-06 · **Status:** accepted

**Contexto.** Cada tier de assinatura entitula um conjunto de features. Esse
mapeamento precisa morar em algum lugar.

**Decisão.** Um `Record<TierId, Entitlements>` em `@vpn/contracts`, ao lado dos
schemas de billing, compartilhado com a web e com os clientes nativos.

**Rationale.** Entitlement é regra de produto, muda com deploy e precisa ser
tipada nos dois lados. Rejeitadas as tabelas `plans`/`plan_features`: seriam
dados sem nenhuma interface administrativa para editá-los — ou seja, um `UPDATE`
manual em produção com a aparência de flexibilidade — e o front perderia a
checagem de tipo sobre o nome da feature. Rejeitada também a metadata de produto
do Stripe: acoplaria a autorização ao provider que está atrás de uma porta
justamente para ser trocável, o que colide de frente com o inegociável nº 1.

**Consequências.** Mudar um tier é publicar `@vpn/contracts`. Override por
account não existe; quando um cliente exigir, é uma tabela estreita de exceções
lida por cima do mapa, e não a inversão do mecanismo.

---

### DEC-037 — Entitlements fora do access token; papel dentro

**Data:** 2026-08-06 · **Status:** accepted

**Contexto.** O access token é um JWT de 15 minutos, **não revogável** por
decisão explícita — a revogação mora no refresh token. Autorização precisa de
uma fonte.

**Decisão.** O token carrega `acc` (accountId) e `rol` (role). **Não** carrega
entitlements: eles são lidos por requisição a partir da subscription, com cache
via `ICacheStore`, e o handler de webhook invalida essa entrada.

**Rationale.** O critério é quem muda o dado. Papel muda por ação nossa, e já
existe o mecanismo de propagação: a rotação de família. Entitlement muda por ação
do provider — um `payment_failed` chega por webhook e precisa valer agora, não
em até quinze minutos. Colocá-lo no token seria escolher uma janela de quinze
minutos de acesso pago não pago.

**Consequências.** Uma leitura a mais por requisição autorizada, que é o que o
cache existe para absorver. A invalidação passa a ser efeito obrigatório do
handler de webhook — se for esquecida, o sintoma é entitlement velho servido por
até o TTL, e isso precisa de teste. `AccessTokenClaims` cresce, e todo lugar que
constrói um token de teste precisa dos campos novos.

---

### DEC-038 — Tenant resolvido pelo host na web, por slug no nativo

**Data:** 2026-08-06 · **Status:** accepted

**Contexto.** O e-mail de um user só é único dentro de uma account (DEC-034),
então o login precisa saber a account **antes** de procurar o e-mail. O
navegador chega por um host da account; o app nativo chama a API direto e não
tem host nenhum a oferecer.

**Decisão.** Um middleware do kernel, antes do `AccessTokenGuard`, resolve a
account a partir do `Host` — `{slug}.vpn.example.com` ou uma linha em
`custom_domains`. Clientes nativos informam o slug explicitamente no primeiro
login e passam a portá-lo na claim `acc` depois disso.

**Rationale.** Um conceito de resolução, duas portas de entrada. O host já é
tratado como entrada: a web app é servida a partir do host em que a API é
chamada. Rejeitada a descoberta por e-mail ("digite seu e-mail e achamos sua
empresa"): é um oráculo de enumeração de contas contra o inegociável nº 4, e
torná-lo seguro exige uma resposta tão vaga que o ganho de UX evapora.

**Consequências.** Precisam ser tratados: CORS, que passa a ter origem por
account; o cookie de refresh, que é host-scoped — o que significa uma sessão por
host de tenant, e isso é a propriedade correta, não um defeito; o host de retorno
do Checkout; e um host desconhecido, que precisa de resposta própria e não pode
virar 500.

`custom_domains` é modelada agora e a emissão de certificado fica para depois: o
wildcard cobre todo slug, e o domínio próprio do cliente é a única parte que
depende de ACME.

---

### DEC-039 — Uma account nasce do registro, não da compra

**Data:** 2026-08-06 · **Status:** accepted

**Contexto.** Account passou a ser a empresa (DEC-034), e a empresa precisa
existir antes de qualquer coisa pender dela. Duas ordens são possíveis: comprar
e depois receber acesso, ou registrar-se e depois comprar.

**Decisão.** **Self-serve.** Quem se registra cria, na **mesma transação**, a
account e o seu `owner`. A compra é um passo posterior de uma account que já
existe e já tem dono.

**Rationale.** É a ordem que o produto tem: registrar → comprar → usar. Também é
a que o sistema já faz — o cadastro de hoje cria a linha, e a mudança é o que
essa linha significa, não quando ela nasce.

Rejeitado o **claim token**, que era a decisão anterior aqui e vale registrar
porque o raciocínio segue correto para o fluxo que ele atende: numa venda
conduzida por vendas, a compra acontece antes de existir qualquer pessoa
cadastrada, o webhook de ativação cria a account, e um terceiro `purpose` em
`verification_tokens` (`account_claim`) é emitido e enviado a quem comprou —
reusando o `UPDATE` condicional que já torna um resgate único sob concorrência,
em vez de inventar um segundo mecanismo desses. Não é o fluxo deste produto
hoje, e uma tabela não ganha um `purpose` que nada emite.

Rejeitado também criar o user direto de um webhook a partir do e-mail de
cobrança: o e-mail que paga não é necessariamente o e-mail que administra, e um
webhook não tem senha para definir.

**Consequências.** Registro deixa de ser um `INSERT` e passa a ser uma
transação de dois — é o primeiro uso do `TransactionRunner` do kernel fora de
cobrança. Um `owner` por account é uma restrição, não uma convenção.

O `slug` da account precisa sair de algum lugar no registro: derivado do e-mail,
pedido no formulário, ou gerado. É decisão de produto e está na spec.

Nenhuma account existe sem user, o que elimina o estado "comprada mas não
resgatada" — e com ele a operação de suporte que o claim token exigiria.

---

### DEC-040 — Branding é dado da account, aplicado como tokens de tema

**Data:** 2026-08-06 · **Status:** accepted

**Contexto.** Cada empresa recebe a plataforma com a identidade visual dela.

**Decisão.** Um logo por `IObjectStorage` e um conjunto **fechado** de tokens de
tema por account, injetados como variáveis CSS na origem daquele host.

**Rationale.** O mecanismo já existe e é a DEC-021: tokens `@theme` nomeiam
papéis (`--background`, `--destructive`), nunca cores, e é isso que permite duas
paletas com um markup só. Trocar a paleta por account é o mesmo movimento que
trocar claro por escuro. Rejeitado CSS arbitrário do cliente: executa na nossa
origem, é XSS por definição, e ainda transforma qualquer mudança de UI nossa
numa quebra silenciosa no tema de um cliente.

**Consequências.** O conjunto de tokens vira contrato: acrescentar um é fácil,
remover um quebra clientes. Logo é upload, logo é validação de tipo e tamanho, e
é o primeiro uso real de `IObjectStorage` no produto.

---

### DEC-041 — Refresh token por body no nativo, cookie na web

**Data:** 2026-08-06 · **Status:** accepted

**Contexto.** Haverá app mobile (React Native) e desktop (Tauri/Electron). O
refresh token hoje trafega exclusivamente por cookie httpOnly.

**Decisão.** O mesmo token opaco, a mesma rotação por família, transportes
diferentes: cookie httpOnly na web, corpo da resposta no nativo — guardado em
Keychain/Keystore ou no cofre de credenciais do sistema.

**Rationale.** O cookie httpOnly existe para que um XSS na web não alcance o
token, e essa ameaça é específica de um documento com JavaScript de terceiros.
Um app nativo não tem esse modelo de ameaça e tem um cofre do sistema, que é a
garantia equivalente. Rejeitado body para todos: a web passaria a segurar o token
em JS, e um XSS viraria tomada de conta — estritamente pior que hoje, em nome de
simetria de código. Rejeitado OAuth device/PKCE: é a resposta certa para SSO
empresarial e desproporcional para o que existe agora; fica registrado como o
caminho quando SSO virar entitlement.

**Consequências.** A rota de refresh passa a ter duas formas de receber o token,
e a escolha precisa ser explícita do cliente — não inferida por presença, que é
o caminho para um cliente web receber acidentalmente o token no corpo. A DEC-006
continua intacta: a família, a rotação e a revogação em bloco não mudam.

---

### DEC-042 — Compra só na web

**Data:** 2026-08-06 · **Status:** accepted

**Contexto.** Apple e Google exigem compra in-app para assinaturas digitais, com
comissão de 15 a 30%.

**Decisão.** A compra acontece exclusivamente no domínio web da account. Os apps
nativos não têm fluxo de compra **nem link para um**.

**Rationale.** Quem compra é uma empresa, e o app é cliente de uma account que já
existe — que é a forma que as regras de loja permitem. A ausência do link não é
detalhe: é ela que sustenta a permissão. Rejeitado antecipar um segundo adapter
de `IBillingProvider` para StoreKit/Play: significaria duas fontes de verdade
sobre o estado de uma assinatura e uma reconciliação entre elas, para vender a um
público — o indivíduo comprando pelo celular — que este produto não tem.

**Consequências.** O app precisa degradar com elegância para um user cuja account
está sem assinatura ativa: explicar, sem oferecer compra e sem mandar para uma
página que a ofereça. `IBillingProvider` permanece Stripe-only, e a porta
continua tendo um único motivo para existir.

---

### DEC-043 — Limite contável é restrição de banco, não `count()`

**Data:** 2026-08-06 · **Status:** accepted

**Contexto.** `seats` e `devicesPerUser` são entitlements numéricos, aplicados no
momento em que um convite é aceito ou um device é registrado.

**Decisão.** A checagem acontece dentro da transação da escrita, apoiada em
`SELECT ... FOR UPDATE` na linha da account ou numa coluna contadora com `CHECK`
— nunca num `SELECT count(*)` seguido de `INSERT`.

**Rationale.** É literalmente o `if (jáVimos)` que o inegociável nº 3 proíbe:
dois convites aceitos ao mesmo tempo passam pelo `SELECT` juntos, cada um conta
24 de 25, e a account termina com 26 users. A diferença em relação à idempotência
de webhook é que aqui não há chave natural para um unique index — contar não é
deduplicar — e por isso o mecanismo é bloqueio ou constraint, não índice.

**Consequências.** O caminho de aceitar convite passa a serializar por account, o
que é aceitável porque a contenção é por empresa e a operação é rara. O downgrade
fica sem resposta automática: uma account que cai de 100 para 10 seats com 40
users viola o limite sem que ninguém tenha escrito nada, e decidir o destino
desses 30 é produto, não schema — está na spec, não aqui.

---

### DEC-044 — Prettier, depois de tudo

**Data:** 2026-08-06 · **Status:** accepted · **Supera:** DEC-022

**Contexto.** A DEC-022 recusou Prettier e escolheu
`eslint-plugin-better-tailwindcss` para o problema que existia então: ordem de
classe do Tailwind. O commit `9ba12a9` adotou Prettier assim mesmo — porque o
repositório havia derivado para dois estilos — e o log nunca registrou a
reversão. Uma decisão contrariada em silêncio é pior que uma decisão errada:
quem lê o log conclui o oposto do que o repositório faz.

**Decisão.** Prettier é o formatador. `.prettierrc.json` (tab, aspas simples,
largura 100, espaços em `json`/`md`/`yaml`), `.prettierignore`, `.editorconfig`,
e `format:check` como **primeiro** portão de `pnpm verify`.

**Rationale.** O argumento da DEC-022 era proporcional ao problema de então, e a
premissa mudou: não era mais "adotar um formatador reescreveria o repositório",
era "o repositório já está em dois estilos e a revisão gasta atenção com isso".
Formatar de uma vez custa um commit; formatar por revisão custa para sempre.

`format:check` vem antes de lint e typecheck por ser o portão mais barato: falha
em segundos e a correção é `pnpm format`.

Isto **não** reverte a outra metade da DEC-022: `eslint-plugin-better-tailwindcss`
continua instalado e continua responsável pela ordem de classe. O que a DEC-022
rejeitava e continua rejeitado é `prettier-plugin-tailwindcss`, que só ordena e
não sabe dizer que `bg-surface` não é um token nosso.

**Consequências.** `libs/database/migrations/` e `packages/` estão no
`.prettierignore` — saída gerada e submodule com workspace próprio não são
formatados daqui.

Não há hook de pre-commit: a garantia é `pnpm verify` e CI. Um hook é uma
decisão futura, não uma omissão desta.

---

### DEC-045 — A chave privada nasce no navegador

**Data:** 2026-08-06 · **Status:** accepted

**Contexto.** O produto entrega credenciais de VPN. A pessoa gera uma chave numa
página, baixa um `.conf` e o importa num cliente WireGuard. A pergunta é onde o
par de chaves é gerado.

**Decisão.** No **navegador**. O par é gerado com `crypto.subtle` (X25519), o
`POST` leva **só a chave pública**, e o `.conf` é montado e baixado no cliente. O
servidor persiste apenas a chave pública, e nunca vê a privada.

**Rationale.** A chave privada é a credencial: quem a tem é o túnel. Não
transmiti-la remove de uma vez o log que a registra sem querer, o backup que a
guarda, o response body que um proxy corporativo inspeciona e o incidente em que
um dump de banco é um conjunto de VPNs funcionando.

Rejeitada a geração no servidor. Não é indefensável — produtos reais fizeram e
fazem isso, e continua sobrevivível desde que a privada nunca seja persistida —
mas a alternativa custa uma dependência pequena, e "o servidor não pode vazar o
que nunca teve" é uma garantia estrutural em vez de uma disciplina.

Rejeitado exigir uma CLI que gere a chave: é a postura mais forte de todas, mas
transforma a página de chaves num passo que não entrega nada sozinho e faz a CLI
virar entregável antes de haver produto.

**Consequências.** `crypto.subtle` com X25519 é recente nos navegadores. O
fallback é `@noble/curves`, e **qual dos dois caminhos vale por navegador é
coisa a verificar, não a supor** — a versão exata de suporte não foi confirmada
ao escrever esta decisão.

O `.conf` só existe no cliente: um usuário que perde o arquivo **não** pode
pedir outro. Ele gera uma chave nova e a antiga é revogada — o que é a
propriedade certa, e precisa estar na interface, senão vira chamado de suporte.

A chave pública é o identificador do peer, e por isso a tabela de chaves fica sob
RLS como qualquer outra tabela de domínio (DEC-035).

---

### DEC-046 — Fila é uma porta, no nível de job

**Data:** 2026-08-07 · **Status:** accepted

**Contexto.** Envio de e-mail saiu da requisição (DEC-047), e isso precisa de uma
fila. O SQS já estava semeado no devstack desde o começo, com DLQ e
`maxReceiveCount: 5`, sem nada publicando nem consumindo.

**Decisão.** `IJobQueue` em `@vpn/ports`, token `JOB_QUEUE`, com
`enqueue({ name, data, idempotencyKey? })`, `receive` e `acknowledge`. Dois
adapters: `SqsJobQueue` e `MemoryJobQueue` (que é também o driver `memory`,
DEC-012), escolhidos por `QUEUE_DRIVER`.

**Rationale.** SQS é serviço externo, e o inegociável nº 1 não abre exceção. Não
estamos escrevendo uma fila: são 22 linhas de interface e 69 de wrapper de SDK.

A **forma** vem do `atlas`, que abstrai em `enqueue({name, data, ...})`; o
**driver**, do `convoy`, que usa SQS atrás de um `JobQueue` com
`SqsJobQueue`/`InProcessJobQueue`. A primeira versão desta porta era
`publish(body: string)` — transporte, não job — e obrigava o chamador a
serializar. Os dois repositórios de referência abstraem um nível acima, e estão
certos.

Rejeitado `@nestjs/bullmq`: é Redis, não SQS; seria abstração concorrente com
esta porta, que é exatamente o motivo pelo qual a DEC-029 rejeitou
`cache-manager`; e **não removeria o outbox**, porque `queue.add()` continua
sendo uma escrita fora da transação do Postgres. Ele conserta o que já está
resolvido e não toca no que dói. A linha de `bullmq` na tabela da DEC-029 foi
atualizada: dizia "não se aplica, não há fila", e a premissa caiu.

**Consequências — o que a porta deliberadamente não promete.**

**Não promete ordem.** Fila SQS padrão não é FIFO. Uma suíte que exigisse ordem
passaria contra a memória e reprovaria em produção.

**Não promete deduplicação.** O Inngest do `atlas` deduplica por
`idempotencyKey`; SQS padrão só deduplica em fila FIFO. O contrato afirma que a
chave **atravessa intacta**, e quem deduplica de fato é a chave de idempotência
que o `SmtpEmailSender` já reivindica no cache antes de enviar.

**Não tem `runAt`.** O `atlas` tem, e nós não temos chamador. O
`libs/providers/jobs/CLAUDE.md` dele diz que a forma de método único é
deliberada e que o resto entra "só quando houver necessidade documentada" —
seguir isso é mais fiel do que copiar a assinatura. Além disso `DelaySeconds` do
SQS teto em 900s, então a porta prometeria o que o adapter não entrega.

---

### DEC-047 — Outbox transacional, não publicar depois do commit

**Data:** 2026-08-07 · **Status:** accepted

**Contexto.** Todo e-mail saía dentro da requisição: `register` emitia o token e
chamava o SMTP antes de responder. Um SMTP lento é um cadastro lento, e um SMTP
fora do ar é um usuário que não consegue verificar a conta e não tem como
perceber.

**Decisão.** Serviço escreve uma linha em `outbox` **dentro da transação que já
existe**. Um **relay** drena (`for update skip locked`), publica na fila e marca
`published_at`. Um **consumer** recebe, despacha e só então reconhece.

**Rationale.** Enfileirar depois do commit não resolve: commit passa, publish
falha, notificação perdida. É a mesma forma do bug que a Fase 0 removeu do
webhook de cobrança, com outro nome. Dentro da transação, a notificação passa a
ser tão durável quanto a mudança de estado que a causou.

Não é teórico: o `convoy` envolve `enqueueEmail` num try/catch e loga
`pwd_reset_email_enqueue_failed`. É o dual-write, nomeado e aceito lá. Nem
`convoy` nem `atlas` têm outbox.

**Consequências.** Entrega é **at-least-once** nos dois saltos — o relay pode
morrer entre publicar e marcar; o consumer, entre enviar e reconhecer. Isso é
seguro porque o `SmtpEmailSender` já reivindica uma chave de idempotência antes
de enviar. Essa propriedade, que já existia, é o que torna o desenho viável.

Um job com `kind` desconhecido **não** é reconhecido: volta para a fila e o
`maxReceiveCount: 5` do devstack o manda para a DLQ. Descartar seria perder em
silêncio.

`OutboxRelay` e `NotificationConsumer` são serviços do kernel, não do worker:
`apps/worker` é só o laço e o ciclo de vida do processo. É o que permite o e2e
drenar no mesmo processo em vez de duplicar a lógica num helper de teste.

---

### DEC-048 — O outbox carrega intenção, nunca um token

**Data:** 2026-08-07 · **Status:** accepted

**Contexto.** `AuthMailer.sendVerification` monta a URL com o token **em claro**.
Isso era seguro enquanto o token só existia em memória: `libs/database/CLAUDE.md`
afirma que _"nenhum token é guardado em claro… um dump do banco não é um conjunto
de credenciais funcionando"_.

**Decisão.** O payload do outbox é uma **intenção** — `{ accountId }` — e nunca
uma mensagem renderizada. Quem emite o token é o **worker**, no momento do envio.

**Rationale.** Enfileirar o e-mail pronto colocaria o token em claro no `outbox`
**e** no SQS até a entrega, e um dump naquela janela seria um conjunto de
credenciais válidas. Vale para `verify_email` e `reset_password`, que são os dois
do caminho crítico.

Rejeitado cifrar o payload: resolveria o dump do banco e não resolveria o SQS, e
trocaria uma propriedade estrutural por uma chave para administrar e rotacionar.
Rejeitado aceitar a janela com exclusão imediata: transformaria uma invariante
escrita em "quase sempre", que é o tipo de erosão que ninguém percebe depois.

**Consequências.** A emissão sai da requisição. "Emitir invalida o anterior"
passa a valer no envio, não no `POST` — dois `resend` seguidos são resolvidos
pela ordem em que o worker processa. O rate limit continua no request, que é onde
protege.

`AuthMailer`, `BillingMailer` e `VerificationTokenService` subiram para o kernel
(`shared/notifications/`, `shared/verification/`): dois consumidores passaram a
precisar deles, e a regra do `CLAUDE.md` é que o que dois módulos precisam mora
em `shared/`.

Um teste de e2e faz grep no payload atrás de token. É feio, e é o que impede a
regressão silenciosa.

---

### DEC-049 — `IIdentityProvider` é aposentada; identidade é repositório

**Data:** 2026-08-07 · **Status:** accepted

**Contexto.** A DEC-026 decidiu que repositório é código nosso e não ganha
interface: o Postgres já está atrás de uma fronteira, e um repositório mora em
cima dela, não no lugar dela. Identidade foi a exceção — e a própria DEC-026 a
citava como parte da justificativa ("para identidade a porta `IIdentityProvider`
com duas implementações conformes"), o que a manteve de pé por precedência, não
por argumento.

**Decisão.** `IIdentityProvider` sai de `@vpn/ports`. `DrizzleIdentityProvider`
vira `AccountRepository`, `UserRepository` e `SessionRepository` em
`apps/api/src/shared/identity/`, mais um `IdentityService` com a política. A
suíte de conformidade não é apagada: é **convertida** em teste de integração dos
repositórios.

**Rationale.** Três fatos, e o primeiro sozinho já bastaria.

Não existe driver `memory` de identidade registrado em `adapters.module.ts` —
todos os outros portos têm um, este nunca teve. `MemoryIdentityProvider` não roda
em lugar nenhum, e é exatamente a divergência silenciosa que a DEC-012 existe
para impedir. O fake que a DEC-012 defende é o que roda todo dia; este não rodava
nunca.

A DEC-039 exige que o registro crie a account e o seu owner na **mesma
transação**. Não dá enquanto a criação de conta mora atrás de uma porta que abre
a própria transação e comita antes de devolver.

A DEC-035 exige que toda query de domínio rode dentro da transação da requisição.
Tornar a porta transaction-aware não seria um parâmetro opcional em `register` —
seria em todos os onze métodos, e o tipo de transação do Drizzle vazaria para
`@vpn/ports`, cujo contrato é **zero import**.

Rejeitado estreitar a porta para a fatia genuinamente substituível: sobraria
metade da identidade atrás de porta e metade não, que é literalmente o que a
DEC-026 chamou de "pior que qualquer um dos dois extremos".

Isto **não** supera a DEC-026 — a confirma. O que muda é que a exceção citada lá
deixa de existir, e o critério do inegociável nº 1 ("eu teria que substituir
isto?") passa a valer sem asterisco.

**Consequências.** `@vpn/ports` e `@vpn/testing` são publicados, então isto exige
o ciclo de `packages:publish:local` e o `consumer-check` — cujo `check.mjs`
afirmava justamente `MemoryIdentityProvider.register()`, e passa a afirmar outra
coisa.

A regra que impede a mudança de custar cobertura: **política mora num serviço e
tem teste unitário; forma de SQL mora num repositório e tem teste de
integração.** `repositories/**` está fora da cobertura por DEC-026, então tudo
que não for statement atômico sobe para `IdentityService`, que **é** testável em
unidade — sem essa separação o piso cairia.

**A conversão é feita em duas metades, e só uma delas landou junto com esta
decisão.** A metade de política virou `slug.spec.ts`, `session-rotation.spec.ts`
e `identity.service.spec.ts`. A metade de SQL — a atomicidade do
`UPDATE … WHERE spent_at IS NULL RETURNING`, o `SELECT … FOR UPDATE`, a busca
case-insensitive contra o Postgres real — **ainda não tem casa**, e segue
coberta só indiretamente pelo e2e. Ela é escrita junto com a suíte negativa de
RLS, porque as duas precisam do mesmo harness e porque escrevê-la contra o
schema que a DEC-034 está prestes a renomear seria escrevê-la duas vezes.
Enquanto isso não acontece, a dívida "repositório não tem teste de integração"
continua **aberta** no roadmap.

Identidade vai para `shared/`, não para `modules/auth/`: o
`NotificationDispatcher` é kernel e precisa ler um user, e kernel não importa de
módulo (DEC-027).

---

### DEC-050 — O caminho pré-autenticação roda como `app_system`

**Data:** 2026-08-07 · **Status:** accepted

**Contexto.** A DEC-035 fixa `app.account_id` com `SET LOCAL` na transação da
requisição. Mas login, refresh, verificação de e-mail e reset de senha rodam
**antes** de existir qualquer account conhecida — são precisamente o código que
descobre quem você é. Não há valor para fixar, e uma policy contra um setting
vazio devolve zero linhas: o login falharia sempre, sem erro.

**Decisão.** O kernel expõe duas espécies de transação. **Transação da
requisição** emite `set_config('app.account_id', …, true)` e atende tudo depois
do guard. **Transação de sistema** emite `set local role app_system` e atende o
caminho pré-autenticação, o relay do outbox e o webhook de cobrança. Toda tabela
continua com policy e com o teste negativo obrigatório.

**Rationale.** É o que a DEC-005 criou `app_system` para ser, na frase dela
mesma: "bypass deliberado para jobs". O caminho pré-auth tem a mesma natureza que
um job — não tem tenant porque ainda não há tenant, não porque alguém esqueceu.

O detalhe que quase passa: `app_system` **não** tem `BYPASSRLS`. Sem uma policy
explícita `TO app_system`, ele lê zero linhas igual a `vpn_app`. O bypass precisa
ser escrito, e escrever `USING (true)` numa policy nomeada é melhor que um
atributo de papel — aparece no schema, aparece no diff, e some junto com a tabela.

Rejeitado resolver a account antes das credenciais e rodar tudo tenant-scoped: é
o isolamento mais forte, mas obrigaria o slug a ser obrigatório no login
(DEC-051 decide o contrário) e ainda deixaria o `refresh` de fora — ele
apresenta um token opaco e nada mais, e não há de onde tirar uma account antes de
consultá-lo.

Rejeitado deixar as tabelas de credencial fora da RLS: menor mudança, mas a
DEC-035 diz "toda tabela de domínio", e uma tabela de token sem policy é por onde
o próximo join vaza.

**A policy usa `current_setting('app.account_id')` estrito**, sem o segundo
argumento `missing_ok`. Com `missing_ok`, uma query fora de qualquer escopo lê
`NULL` e devolve zero linhas — sem erro, sem log, sem nada que aponte para a
causa. Estrito, ela levanta `42704 unrecognized configuration parameter`, que
nomeia o problema na primeira vez que alguém esquece de abrir a transação. A
propriedade que a DEC-035 realmente compra — _tenant errado devolve nada, nunca
os dados de outro_ — não muda: um setting de outra account continua devolvendo
zero linhas.

Isso vale também para a limpeza dos testes, que é onde a armadilha ia morder
primeiro: `DELETE FROM users` como `vpn_app` fora de escopo passa a falhar em vez
de apagar zero linhas e deixar as asserções seguintes estranhas por um motivo
invisível.

**Consequências.** `set local role` reverte no commit, então o escopo é a
transação e não a conexão do pool. O acesso de sistema fica contável: são poucos
pontos, todos no kernel, e um módulo que precisar de um está fazendo algo errado.

Toda requisição passa a abrir transação, o que hoje quase nenhuma faz. O executor
ambiente do kernel **lança** quando não há transação corrente, em vez de cair
para o pool — é a mesma escolha do `current_setting` estrito, um nível acima, e
os dois juntos fazem "esqueci o escopo" ser sempre barulhento.

Uma transação de sistema **não pode** ser aberta dentro de uma transação da
requisição, e o runner lança se alguém tentar. `SET LOCAL ROLE` dentro de um
savepoint sobrevive ao release dele: o resto da transação externa seguiria como
`app_system`, escapando de toda policy sem erro e sem log. Verificado contra o
Postgres, não deduzido. Nenhum caminho de hoje faz isso — a guarda existe para o
primeiro que fizer.

O `refresh` roda inteiro como sistema: o cookie chega sem claim `acc`, e a
account é descoberta **a partir** do token. É correto — o hash do token é a
autorização, e as FKs compostas garantem que família e user concordam sobre a
account — mas significa que o caminho mais quente do sistema não tem policy de
tenant aplicada, e isso merece um teste próprio: um token da account B rotaciona
para uma sessão de B, nunca de A.

O rate limit continua com chave por e-mail, então o mesmo endereço em duas
accounts divide o balde e martelar o login de uma tranca a outra. Corrigir exige
resolver a account **antes** de limitar, que é trabalho antes do throttle.
Fica como está, e entra no roadmap nomeado em vez de ser descoberto depois.

**Emenda — 2026-08-07.** Os dois parágrafos acima sobre o `refresh` e sobre o
consumer descrevem o que valia quando esta decisão foi tomada. A decisão não
muda; o **escopo** dela encolhe, e é isso que esta emenda registra.

O kernel ganha uma **terceira espécie de transação**. `runInDiscoveredAccount`
começa como `app_system`, roda **uma** consulta de descoberta, e no instante em
que a account aparece emite `reset role` e fixa `app.account_id` — tudo dentro da
mesma transação. O `refresh` passa a usá-la: só o `lockByTokenHash` roda como
sistema, e gastar o token, emitir o novo e ler o user acontecem sob a policy da
account descoberta. Que `SET LOCAL ROLE` possa ser abandonado no meio da
transação foi verificado contra este devstack, não deduzido.

A rotação continua numa transação só, e isso é inegociável: partir em duas
deixaria uma janela em que o token antigo já foi gasto e o novo ainda não existe,
e um crash ali destrói a sessão. O `spendToken` — `UPDATE … WHERE spent_at IS
NULL … RETURNING` — é a garantia de concorrência inteira.

A forma da API é o que torna o estreitamento estrutural em vez de disciplinar: o
trabalho só é alcançável depois que o runner trocou de papel, então esquecer de
estreitar não é um caminho que exista. O que a descoberta devolve é uma
descoberta, não um resultado — quem quiser trabalhar antes de estreitar tem que
escrever isso de propósito.

Descobrir **nada** não estreita para lugar nenhum: o token que nenhuma família
responde devolve `undefined`, o trabalho nunca roda, e o handler responde
`UNAUTHENTICATED`. Detecção de reuso, ao contrário, **descobre** uma account, e a
revogação da família passa a ser verificada pela policy. O `throw` continua fora
da transação — lançar dentro desfaz a revogação e devolve um token roubado
funcionando.

No lado assíncrono, o `claimPending` passa a carregar o `account_id` da linha do
outbox para dentro do envelope do job, e o consumer abre `runInAccount` por
mensagem. O `NotificationDispatcher` não muda: as buscas dele simplesmente passam
a ser verificadas pela policy, e um `userId` de outra account deixa de resolver.
A correção deixa de repousar sobre o payload ser confiável e passa a repousar
sobre uma checagem. O **relay** continua sistema — ele drena uma tabela
compartilhada por todo mundo, e a suíte de RLS afirma exatamente isso.

Sobram como sistema o resto do caminho pré-auth (`register`, `login`,
`verifyEmail`, `resendVerification`, `forgotPassword`, `resetPassword`), o relay
e o webhook de cobrança. `login` é o próximo candidato natural, e não cabe aqui:
a DEC-051 deixa o slug opcional, então a account só é conhecida **depois** da
busca por e-mail, e estreitar ali exige decidir antes o que fazer com o e-mail
ambíguo. Fica nomeado no roadmap em vez de ser descoberto depois.

---

### DEC-051 — Login resolve a account por slug opcional; ambiguidade é credencial inválida

**Data:** 2026-08-07 · **Status:** accepted

**Contexto.** Com o único de e-mail virando `(account_id, email)` (DEC-034), a
mesma pessoa pode ser usuária de duas empresas e `findByEmail` deixa de ser uma
pergunta bem formada. O `CONTEXT.md` já anotava a consequência: isso "obriga o
login a saber de qual account está falando **antes** de procurar o e-mail".

**Decisão.** `loginRequestSchema` ganha `slug` **opcional**. Informado, ele
resolve a account. Ausente, o e-mail é procurado entre as accounts e exige
exatamente uma correspondência; zero ou mais de uma devolvem
`INVALID_CREDENTIALS` — idêntico no corpo, no status e no tempo à senha errada.

**Rationale.** O caminho definitivo é a DEC-038: host na web, slug no nativo.
Ele não cabe aqui — o devstack fala um host só (DEC-032), e implementar
resolução por host arrastaria roteamento por slug no Traefik e a tabela de
domínios, que são Fase 3.

Slug obrigatório agora seria honesto com o índice e custaria um campo no
formulário, uma mudança de contrato e todo login do e2e, para proteger um caso
que o PoC ainda não produz: hoje todo registro cria a própria account, e o
primeiro e-mail em duas accounts só aparece quando a página de usuários existir.

Colapsar a ambiguidade em `INVALID_CREDENTIALS` é o que mantém o inegociável nº 4
válido **por tenant**: "esse e-mail está em mais de uma empresa" é a mesma
informação que "esse e-mail existe", dita com outras palavras.

**Isto não supera a DEC-038, e a diferença precisa estar escrita** — senão quem
ler as duas conclui que uma foi contrariada em silêncio, que é o defeito que a
DEC-044 registrou como pior que uma decisão errada. A DEC-038 rejeitou a
**descoberta por e-mail**: "digite seu e-mail e achamos sua empresa", uma tela
cuja resposta _diz_ o que encontrou e por isso enumera. O que fica decidido aqui
é um **login**, cuja resposta não distingue caso nenhum — e-mail inexistente,
senha errada, e-mail em outra account e e-mail ambíguo produzem os mesmos bytes,
o mesmo status e o mesmo tempo. O oráculo que a DEC-038 recusou é a resposta
diferenciada, não a consulta; sem resposta diferenciada não há oráculo. A DEC-038
segue valendo e segue sendo o destino: quando o host resolver a account, o ramo
sem slug deixa de ser alcançável.

**Consequências.** Enquanto o slug for opcional, existe um estado em que uma
pessoa legítima não consegue entrar sem saber o slug da própria empresa — e a
mensagem não pode dizer por quê, porque dizer vazaria. Isso é aceitável só
enquanto a resolução por host não existe, e é a razão de a DEC-038 ser
pré-requisito da página de usuários, não um item paralelo. Está registrado no
roadmap.

---

### DEC-052 — Slug derivado do e-mail, colisão resolvida pela restrição

**Data:** 2026-08-07 · **Status:** accepted

**Contexto.** A DEC-039 decidiu que a account nasce do registro e deixou
explícito o que faltava: "o `slug` da account precisa sair de algum lugar no
registro: derivado do e-mail, pedido no formulário, ou gerado. É decisão de
produto e está na spec."

**Decisão.** Derivado: o local part do e-mail, slugificado. A inserção é
`insert … on conflict (slug) do nothing returning id`; conjunto vazio significa
slug tomado, e a próxima tentativa acrescenta `-2`, `-3`, e assim por diante.
Nunca um `SELECT` antes.

Um conjunto fechado de slugs reservados (`www`, `api`, `admin`, `app`, `mail`,
`auth`, `billing`, `static`) conta como tomado desde a primeira tentativa: o slug
vira host (DEC-038), e `api.vpn.example.com` pertencente a um cliente é um
problema de roteamento antes de ser um problema de nomes.

**Rationale.** Não acrescenta campo, tela nem chave de i18n a um formulário que
já é o muro de entrada do produto, e o slug continua sendo algo que uma pessoa
reconhece — que é o ponto dele, já que vira subdomínio (`CONTEXT.md`).

A colisão resolvida pela restrição não é detalhe de implementação: um
`SELECT count(*)` seguido de `INSERT` é o `if (jáVimos)` que o inegociável nº 3
proíbe, e dois registros simultâneos com o mesmo local part passariam juntos pelo
`SELECT`.

`on conflict do nothing returning` em vez de deixar o `INSERT` levantar e
capturar o erro: a DEC-039 exige que o registro inteiro seja **uma** transação, e
no PostgreSQL um comando que falha aborta a transação inteira — a segunda
tentativa receberia `25P02 current transaction is aborted` e derrubaria o
cadastro, não só o slug. Conjunto vazio é um resultado, não um erro, e a
restrição continua sendo quem decide. É a mesma forma que
`BillingEventRepository.claim()` já usa para idempotência de webhook.

Rejeitado pedir no formulário: honesto para whitelabel, mas exige um erro
"slug já usado" — e um endpoint público que responde diferente conforme o slug
exista enumera empresas, que é o inegociável nº 4 com outro sujeito.

Rejeitado slug opaco: zero colisão e zero enumeração, e `x7k2q.vpn.example.com`
derrota a única razão de o slug ser legível.

**Consequências.** O slug nasce de um e-mail pessoal e frequentemente não será o
nome que a empresa quer. Renomear é operação de produto, fica de fora desta fase
e entra no roadmap — e quando entrar, precisa lidar com o subdomínio já em uso.

Dois sufixos numéricos seguidos (`ada-2`, `ada-3`) revelam que alguém com o mesmo
local part se registrou antes. É informação sobre um endereço, não sobre uma
conta, e não é observável pelo formulário — só por quem já conhece o slug
resultante.

---

### DEC-053 — Policies declaradas no schema do Drizzle, não em SQL escrito à mão

**Data:** 2026-08-07 · **Status:** accepted

**Contexto.** As policies da DEC-035 precisam chegar ao banco por alguma
migration. Duas formas: declará-las em `libs/database/src/schema.ts` com
`pgPolicy`, ou escrevê-las à mão num arquivo `.sql`.

**Decisão.** No schema, com `pgPolicy` e `pgRole(...).existing()`.

**Rationale.** O argumento decisivo é desta fase: `0000_init` é **regenerada**, e
provavelmente mais de uma vez enquanto o schema assenta. SQL escrito à mão dentro
dela é apagado silenciosamente no próximo `db:generate` — e o sintoma seria uma
policy que sumiu sem que nada falhasse, que é precisamente o modo de falha que a
DEC-035 quer impossível. Declarada no schema, a policy é regenerada **junto** com
a tabela.

O segundo argumento é de leitura: a policy fica três linhas abaixo da coluna que
protege. "Esta tabela está coberta?" se responde lendo um arquivo, em vez de um
arquivo que o `.prettierignore` e todo editor tratam como saída gerada.

Rejeitado um `0001_rls.sql` à mão. Seria seguro — `db:generate` compara schema
com snapshot, não com o banco, então ele não seria tocado — e daria acesso a
`FORCE ROW LEVEL SECURITY` e a `GRANT`s. Nenhum dos dois é necessário: o dono é
`vpn_migrator` e queremos que migration rode sem filtro, e os grants já saem do
`ALTER DEFAULT PRIVILEGES` da DEC-005. Não vale uma segunda fonte de verdade.

**Consequências.** `drizzle.config.ts` precisa de
`entities: { roles: { exclude: [...] } }` listando os quatro papéis. Sem isso o
drizzle-kit passa a gerenciar papéis como entidades e emite `CREATE ROLE` /
`DROP ROLE` que brigam com `devstack/postgres/init/01-roles.sql` — os papéis são
criados fora do Drizzle e precisam continuar assim, porque nascem antes de
qualquer migration.

O comportamento do drizzle-kit para índice único parcial com literal de enum
(`where role = 'owner'`) e para FK composta é **para conferir na primeira
geração, não para supor**. Se decepcionar, o remendo daquele pedaço é um
statement à mão numa migration **separada**, nunca dentro de `0000_init`.

---

### DEC-054 — O tier vem do status da subscription; o cache guarda o tier

**Data:** 2026-08-07 · **Status:** accepted

**Contexto.** A DEC-036 põe os entitlements num mapa por tier, em código. Falta
dizer de onde sai o tier de uma account, e o que exatamente a DEC-037 manda
cachear.

**Decisão.** O tier é **derivado** do `status` da subscription: `active` e
`trialing` resolvem para `pro`, todo o resto resolve para tier nenhum. A função
que decide mora ao lado do mapa, em `@vpn/contracts`. O cache guarda `{ tier }`;
os entitlements são derivados do mapa a cada leitura.

**Rationale.** Duas alternativas foram rejeitadas por motivos diferentes.

Uma coluna `tier` na `subscriptions` seria, com um tier só, uma constante
persistida — e não há de onde escrevê-la: `NormalizedBillingEvent` não carrega
tier em nenhuma das quatro variantes, então ela nasceria de um mapa priceId →
tier no adapter, que é acoplar autorização ao provider (o que a DEC-036 recusou).
Com o segundo tier a coluna passa a valer, e é aí que a porta ganha o campo.

Cachear os entitlements derivados seria pior de um jeito silencioso: o mapa é
código, e um deploy que muda o que `pro` inclui passaria a conviver com entradas
antigas até o TTL de cada account. Guardando o tier, o mapa novo vale na primeira
leitura. É a mesma razão pela qual o mapa não é tabela.

**Consequências.** Um webhook perdido deixa a projeção parada e a account
entitulada indefinidamente. O TTL **não** conserta isso — ele só encurta a janela
de uma invalidação perdida, não de um evento que nunca chegou. O conserto é um job
que pergunta ao provider, e está no roadmap como dívida.

O status `past_due` revoga na hora, sem carência. Dunning é o provider quem faz, e
enquanto ele tentar de novo a account está `past_due`; dar carência aqui seria
inventar uma segunda política de cobrança do lado errado da porta.

---

### DEC-055 — O gate é guard, e lê fora da transação da requisição

**Data:** 2026-08-07 · **Status:** accepted

**Contexto.** A capability é aplicada no momento da requisição (`CONTEXT.md`), e a
DEC-025 já decidiu que controle de acesso é kernel. Mas a transação da requisição
— a que fixa `app.account_id` e sem a qual `currentExecutor()` lança — é um
**interceptor**, e o Nest roda guard **antes** de interceptor.

**Decisão.** `CapabilityGuard` em `shared/access-control/`, como o
`AccessTokenGuard`. A leitura do tier é primeiro no cache; no miss, o serviço abre
a própria transação com `runInAccount`. `SubscriptionRepository` sobe para
`shared/subscriptions/`, porque o kernel passa a lê-la e `shared/` não importa de
`modules/`.

**Rationale.** A alternativa era um segundo interceptor global, registrado depois
do de tenancy, que rodaria dentro da transação e poderia usar o executor corrente.
Rejeitada: põe a decisão de autorização **dentro** do pipeline do handler, no
lugar de na frente dele, e um interceptor que lança 402 é um guard escrito com o
mecanismo errado. Guard é onde o Nest — e quem lê o controller — espera encontrar
"quem pode chamar isto".

O custo é uma transação a mais **apenas no miss**, que é o que o cache existe para
absorver (DEC-037 já orçou uma leitura por requisição autorizada). O serviço
ramifica em `hasScope()`: dentro da transação da requisição usa o executor
corrente, fora dela abre a sua. O mesmo idioma que o
`TenantTransactionInterceptor` já usa para não abrir transação duas vezes.

**Consequências.** A invalidação do webhook acontece **depois** do commit. Antes
dele, uma requisição concorrente leria a linha pré-commit e reescreveria a entrada
com o valor velho; depois dele, uma queda na janela entre commit e `delete` serve o
valor velho até o TTL. Escolhemos o pior caso limitado em vez do errado silencioso.

`AccessControlModule` deixa de ser só `jose` mais issuer e audience: passa a
importar o módulo de entitlements, e portanto o cache e o banco. Isso não recoloca
domínio no kernel — subscription é projeção de cobrança, não regra de auth — mas o
argumento da DEC-025 de que o guard "nunca consulta uma conta" vale agora só para
o `AccessTokenGuard`.

---

### DEC-056 — Cobrança local roda contra o Stripe em test mode; o fake é o modo offline

**Data:** 2026-08-08 · **Status:** accepted

**Contexto.** A DEC-009 escolheu `MemoryBillingProvider` como padrão local porque
o localstripe não implementa `/v1/checkout/sessions`. O que ela não disse é como
alguém vê uma assinatura ficar ativa no navegador: o `.env.example` continuou
mandando `BILLING_DRIVER=stripe` — contradizendo a própria decisão —, o fake
devolvia uma URL `memory://` que nenhum navegador abre, e nada entregava o webhook
de ativação. O botão de assinar respondia 500 nos dois drivers, por motivos
diferentes.

**Decisão.** Dois modos, ambos honestos.

Para exercitar cobrança de verdade: **Stripe em test mode com a CLI**. Chaves
`sk_test_`, `STRIPE_API_BASE` fora, `stripe listen --forward-to`. O checkout é a
página hospedada de verdade, o webhook é assinado de verdade, e o adapter que roda
é o de produção. `pnpm billing:prices` cria produto e preços na conta de quem
roda, porque id de preço é a única parte da configuração que não pode ter default.

Offline continua sendo `memory`, e o fake passa a devolver a `successUrl` que
recebeu. A ativação vem de `pnpm billing:activate`, um **script**, que assina o
envelope e faz `POST /billing/webhook`.

Fica **recusado no boot**: `BILLING_DRIVER=stripe` com `STRIPE_API_BASE` definido.
Sobrescrever a base significa mock, e nenhum mock que subimos cria uma Checkout
Session.

**Rationale.** Rejeitado um endpoint de ativação protegido por `NODE_ENV`. Um
endpoint existe no artefato entregue e depende de uma guarda para ser inofensivo;
um script não pode ser chamado por ninguém em produção porque não está lá. E o
script atravessa a rota real com assinatura real — verificação, deduplicação e
invalidação de cache acontecem como no dia em que o provider chamar. Um atalho
para dentro do serviço testaria menos que o caminho que ele imita.

Rejeitado também o Stripe Elements com o `localstripe-v3.js` para ter checkout
offline: ele coloca formulário de cartão na **nossa** origem, que é a única coisa
que o `CONTEXT.md` diz que nunca acontece, e é trabalho de front-end por um PoC
que ainda não tem data plane.

**Consequências.** No modo offline o botão **Cancelar** falha, e de propósito: ele
pede ao fake da API o cancelamento de uma assinatura que o fake nunca criou, e um
provider deve recusar um id que não conhece — tolerar divergiria o fake do adapter
do Stripe, que é o que a suíte de conformidade impede. O script tem
`cancel` para isso.

A validação do Stripe Checkout contra a API real sai de "só em staging" para
"qualquer laptop com a CLI", e a linha do roadmap muda de bloqueio para tarefa.

---

### DEC-057 — O parser de webhook lê as duas formas de payload

**Data:** 2026-08-08 · **Status:** accepted

**Contexto.** Medido contra a conta real em test mode: o default dela é
`2026-04-22.dahlia`, enquanto `StripeBillingProvider` fixa
`2025-02-24.acacia` e o SDK é o `stripe@17` (o npm está no 22). Dois campos que o
adapter lê mudaram de lugar nesse intervalo:

| Lido em                                 | Onde está hoje                                 |
| --------------------------------------- | ---------------------------------------------- |
| `subscription.current_period_end`       | `subscription.items.data[].current_period_end` |
| `invoice.subscription_details.metadata` | `invoice.parent.subscription_details.metadata` |

O primeiro gravava `current_period_end` nulo — a tela cai no texto "o fim do
período vigente" e ninguém percebe. O segundo é pior: `accountIdOf` devolvia
`null`, o evento normalizava para `null`, o webhook respondia `applied: false` e o
e-mail de "não conseguimos processar seu pagamento" **nunca saía**. Silencioso, e
invisível para toda a suíte: as fixtures foram escritas na forma antiga.

**Decisão.** O parser lê as duas formas: subscription primeiro, item depois;
`parent.subscription_details` primeiro, raiz depois. Fixtures das duas versões no
teste unitário.

**Rationale.** Não é tolerância defensiva por hábito — é o contrato do provider.
Um endpoint de webhook guarda a versão com que foi criado **para sempre**, então
um payload antigo pode chegar amanhã, de um endpoint criado ano passado, e uma
reentrega de evento chega na versão de quando ele nasceu.

Rejeitado fixar a versão no endpoint: funciona, e continua sendo uma boa ideia no
deploy, mas faz a correção depender de um campo de dashboard que não aparece em
lugar nenhum do código — e não resolve o endpoint que já existe.

Rejeitado subir o SDK e ler só a forma nova: a versão do SDK decide o que as
**nossas chamadas** recebem, não o que um endpoint entrega. Ler só a forma nova
troca um bug silencioso por outro.

**Consequências.** Duas leituras estruturais com cast documentado, porque o SDK
tipa cada campo só onde a versão dele o coloca. Subir o `stripe` para o 22 segue
desejável e agora é separado: o parser aguenta as duas pontas, então a atualização
deixou de ser urgente. Está no roadmap.

---

### DEC-058 — A página de retorno espera o webhook; tempo esgotado é estado neutro

**Data:** 2026-08-08 · **Status:** accepted

**Contexto.** `success_url` e `cancel_url` apontam para `/billing/success` e
`/billing/cancel`, e o router web mandava `/billing/*` para `/`. Pagar, desistir
e abandonar a aba terminavam idênticos: a app reaparecia sem dizer nada. Pior que
o silêncio — quem ativa a assinatura é o **webhook**, que é assíncrono, e medido
localmente o redirect ganha essa corrida. O usuário que acabou de pagar caía numa
tela dizendo **Sem assinatura**.

**Decisão.** Duas rotas de verdade, declaradas antes do catch-all, e a de sucesso
consulta a projeção a cada 2 s por até 15 s. Três desfechos: **ativada** (o tier
resolvido pela `resolveTier` que a API usa), **ainda ativando** enquanto espera, e
**sendo processada** quando a espera acaba — com um "verificar de novo", nunca com
uma mensagem de erro. A tela reconhece o pagamento nos três, e em nenhum momento
afirma que ele falhou.

**Rationale.** Assumir a ativação mentiria: a tela seguinte negaria o acesso.
Chamar o tempo esgotado de falha mentiria pior, porque o dinheiro já está com o
provider e a única coisa que falta é um evento que **está** a caminho — o pior
caso do timeout é uma espera, não um problema.

Não existe redirect de falha para modelar: um cartão recusado não sai da página
hospedada, o Stripe renderiza o erro lá. Falha posterior é dunning, que
`invoice.payment_failed` já cobre. Duas rotas, três estados.

**Recusado:** acrescentar `?session_id={CHECKOUT_SESSION_ID}` à `success_url`. O
redirect já **é** a afirmação do provider de que o checkout concluiu, então o
parâmetro não carrega fato novo; usá-lo para afirmar mais forte exigiria
`checkout.sessions.retrieve`, e um segundo caminho para o mesmo fato contraria a
DEC-037, que põe a verdade no webhook. E `checkout.sessions.create` não tem
caminho de teste aqui — o localstripe não implementa a rota —, então a linha
nasceria sem cobertura. A página ignora a query string, inclusive o
`?checkout=…&price=…` que o driver `memory` acrescenta.

**Consequências.** É o primeiro polling do `apps/web`; o intervalo e o limite são
constantes nomeadas na página. No modo offline a tela **sempre** chega ao estado
de espera, porque não há provider mandando o webhook — quem manda é
`pnpm billing:activate` (DEC-056). Isso é um segundo caso de teste, não um
defeito. `/billing/*` continua existindo para subpath desconhecido, inclusive o
`/billing` que os e-mails de cobrança linkam.

---

### DEC-059 — A ativação também manda e-mail, e ele segue o tier

**Data:** 2026-08-08 · **Status:** accepted

**Contexto.** Até aqui só falha de pagamento e cancelamento viravam intenção de
outbox. A omissão era deliberada: o Stripe manda o próprio recibo.

**Decisão.** `subscription_activated` passa a enfileirar
`billing.subscription_activated`, **condicionado a `resolveTier(status) !== null`**.

**Rationale.** O recibo do provider fala de dinheiro; o que a pessoa comprou é
acesso, e ninguém além de nós pode dizer que ele está liberado. Com a página de
retorno podendo terminar em "sendo processada" (DEC-058), o e-mail é o que fecha
o ciclo para quem fechou a aba antes de o webhook chegar.

O gate por tier não é defesa por hábito. `StripeBillingProvider` normaliza **todo**
`customer.subscription.created` como ativação, e um `created` pode chegar
`incomplete` — 3DS/SCA. Anunciar como ativa uma assinatura que ainda não paga nada
é exatamente a mentira que a DEC-058 recusa na tela; recusá-la na tela e cometê-la
no e-mail seria pior, porque o e-mail não se corrige sozinho.

**Consequências.** Uma assinatura que nasce `incomplete` e só depois vira `active`
não gerava e-mail: a transição chega como `subscription_updated`, e mandar em todo
`updated` mandaria um e-mail por renovação. Ficou registrado como limite conhecido —
e **a DEC-061 o removeu**, ao trocar o gatilho de "evento de criação com tier" por
"transição de tier", que distingue virar ativo de continuar ativo.

`EmailTemplate` mora em `@vpn/ports`, então acrescentar um template sobe `ports`, e
`@vpn/testing` sobe por arrasto — ele declara `@vpn/ports` como `workspace:*`, que
vira versão exata no `pack`, e deixá-lo para trás instalaria duas cópias da porta.
`renderEmail` resolve `email.${template}` com cast, então uma chave faltando
renderizaria o **nome da chave** como assunto; o teste unitário dos adapters passou
a recusar isso explicitamente.

---

### DEC-060 — Retomar é método próprio da porta; confirmar é do cliente

**Data:** 2026-08-08 · **Status:** accepted

**Contexto.** Cancelar era um clique só, sem pergunta e sem volta: o `onClick`
disparava `DELETE /billing/subscription` direto, e depois disso a tela virava um
beco sem saída — o mesmo botão continuava lá, desabilitado, e não havia caminho de
volta em lugar nenhum do sistema. `IBillingProvider` só sabia escrever
`cancel_at_period_end: true`.

**Decisão.** A porta ganha `resumeSubscription(externalId)`, com rota
`POST /billing/subscription/resume`. A confirmação é do **cliente**: um
`AlertDialog` antes de agendar o cancelamento.

**Rationale.** Alargar a união existente para
`cancelSubscription(id, 'now' | 'period_end' | 'never')` foi rejeitado: "cancelar
com quando = nunca" mente no nome, e obrigaria todo call-site a re-narrowar uma
união que cresceu sem que o domínio crescesse junto.

A confirmação não sobe para o servidor porque um passo de confirmação
server-side seria estado de UI no banco — um "cancelamento pendente" que precisa
expirar, e que a pessoa pode abandonar fechando a aba. A guarda que o servidor
precisa ter ele já tem: a assinatura tem que existir, e quem manda no resto é o
provider.

Retomar **não** invalida o cache de entitlement, e isso é simétrico com cancelar:
agendar o fim do período nunca tirou o tier (`active` continua `active`), então
desfazer o agendamento não o devolve. Não há nada a invalidar, e chamar
`invalidate` aqui sugeriria que há.

**Consequências.**

`setCancelAtPeriodEnd` não participa da guarda monotônica do `upsert` — é um
`UPDATE` direto que não toca `lastEventAt`. Logo um webhook atrasado pode reverter
um retomar. Isso é **correto**, não uma corrida a consertar: a subscription local é
projeção, o provider é a autoridade (`CONTEXT.md`), e o evento seguinte — mais novo
— reconverge. O mesmo já valia para o cancelar; retomar só torna o efeito visível.

A suíte de conformidade de billing **continua sem rodar contra o
`StripeBillingProvider`**, e agora está escrito por quê: ela começa por
`createCheckout`, e o localstripe não implementa `/v1/checkout/sessions` (DEC-009).
Registrar o Stripe faria o bloco de checkout falhar por limitação do mock, não do
adapter. Enquanto isso, retomar é pinado à mão em `stripe.integration.spec.ts`,
onde o cancelamento já era. Partir a suíte em dois blocos — checkout e ciclo de
vida — para que o Stripe passe pelo segundo está no roadmap.

Estendendo a suíte, apareceu que ela **não afirmava nada sobre
`cancelSubscription`**: cobria checkout, verificação e parsing, e nada do ciclo de
vida. O bloco novo cobre os dois lados, e o `BillingProviderHarness` ganhou
`activeSubscription(accountId)` porque não havia como obter o `externalId` de uma
subscription viva de dentro da suíte.

No modo offline retomar falha como cancelar já falha, pelo mesmo motivo da
DEC-056: o fake que a API montou nunca criou aquela subscription.

---

### DEC-061 — Ação do usuário também escreve intenção, e o aviso segue o estado

**Data:** 2026-08-08 · **Status:** accepted

**Contexto.** Todo e-mail do sistema nascia de um webhook ou de um fluxo de auth.
Três momentos ficavam mudos, e um falava errado:

- **agendar um cancelamento** não avisava nada. O `cancel_at_period_end` chega como
  `customer.subscription.updated` com status ainda `active`, normaliza para
  `subscription_updated`, e esse kind não enfileirava nada;
- **retomar** não avisava nada, por não existir até a DEC-060;
- **perder o acesso** não avisava nada. `past_due` aparecia num único lugar do
  código — o mapa de status do adapter — e nada reagia a ele. O e-mail de dunning
  fala do cartão; nada falava da consequência;
- e o e-mail de **término** dizia _"o acesso continua até {{endsAt}}"_ disparando em
  `customer.subscription.deleted`, quando o acesso já tinha acabado. Texto de
  agendamento no gatilho do término.

**Decisão.** Cancelar e retomar enfileiram intenção no outbox **dentro da transação
da requisição**, e a idempotência chaveia no **instante pedido** em vez de num id de
evento do provider. E o aviso de ganhar e o de perder o tier passam a ser
disparados pela **transição** `resolveTier`, nas duas direções — não pelo nome do
evento. `endsAt` migra do e-mail de término para o de agendamento, que é onde a
data é futura.

**Rationale.** `OutboxRepository.enqueue` já assume
`executor = currentExecutor()`, e as rotas de billing rodam dentro da transação que
o `TenantTransactionInterceptor` abre — guard roda antes de interceptor, e o guard é
quem põe `request.auth`. Então a atomicidade da DEC-047 vale sem plumbing novo.
Imitar o webhook não era opção: `runAsSystem` recusa aninhar dentro de um escopo
aberto, porque `set local role` sobrevive ao savepoint. O caminho de auth abre a
própria transação justamente por ser pré-autenticação e não ter escopo; billing tem.

Chavear no instante é o que faz cancelar → retomar → cancelar render três avisos
enquanto um retry do relay reenvia um só. Não é invenção: `sendPasswordChanged` já
chaveia `password-changed:${userId}:${segundos}` pela mesma razão.

O aviso de suspensão segue o **tier** porque é a outra metade da regra que a DEC-059
fixou para a ativação. Enumerar `past_due` e `unpaid` no handler seria repetir, num
segundo lugar, a decisão que a `resolveTier` já toma — e o dia em que um status novo
revogar acesso, o e-mail sai sozinho. Também é o que faz o aviso sair **uma vez por
perda** em vez de uma vez por cobrança recusada, que é o que o dunning já cobre.

Escrita a metade que faltava, ficou evidente que a outra estava incompleta: a
ativação disparava em "evento de criação **e** status já dá tier", e o Stripe
frequentemente cria a subscription `incomplete` e só a promove a `active` no evento
seguinte — que chega como `subscription_updated` e não enfileirava nada. **Compra
concluída, tier concedido, ninguém avisado.** Era o limite que a DEC-059 registrou
como conhecido, e ele deixou de ser aceitável no momento em que a maquinaria de
transição passou a existir para a revogação. O gatilho da ativação passa a ser
`nulo → não-nulo`, que é o que distingue _virar_ ativo de _continuar_ ativo — a
renovação segue muda. De brinde, recuperar de um `past_due` volta a avisar, porque
é genuinamente um tier reconquistado.

**Consequências.**

A transição só é confiável com duas informações que o handler não tinha: o tier
**anterior** e se o upsert **de fato aplicou**. `SubscriptionRepository.upsert`
passa a devolver `boolean` via `.returning()` — o `onConflictDoUpdate` com `setWhere`
falso não devolve linha, então o sinal cai de graça. Sem ele, um evento atrasado
carregando `past_due` mandaria "você perdeu o acesso" para quem não perdeu, e a
guarda monotônica que existe desde a DEC-047 ficaria correta no banco e mentirosa na
caixa de entrada.

**O cancelamento ganha do genérico.** Uma assinatura que termina também perde o
tier, e sem ordem explícita ela receberia "seu acesso foi suspenso" em vez de
"assinatura cancelada". Os eventos com e-mail próprio são resolvidos primeiro; a
revogação é o que sobra. Isso é teste, não comentário.

`findExternalId` fica sem chamador e sai: cancelar e retomar precisam do estado
anterior de qualquer forma, então leem a linha inteira uma vez. `StoredSubscription`
ganha `externalId`, que a query já trazia e só o tipo omitia.

Acrescentar kind ao outbox exige acrescentá-lo **também** a `BILLING_KINDS`, e
esquecer não dá erro de compilação: `parseOutboxJob` devolve `null`, o consumer joga
o job em `unknown` e nunca dá acknowledge — a mensagem volta para sempre e nenhum
e-mail sai.

---

### DEC-062 — NAT no próprio nó de saída, e o nó do devstack não é artefato de produto

**Data:** 2026-08-09 · **Status:** accepted

**Contexto.** O spike do WireGuard subiu um contêiner, semeou um peer à mão e
provou um handshake vindo do cliente do Windows. Provar o túnel obrigou a decidir
onde o tráfego é traduzido: o pacote entra em `wg0` com origem `10.13.13.2`, e
sem tradução a resposta do destino volta para o gateway da bridge, que não tem
rota nenhuma de volta para dentro do túnel. Medido: o egress responde `200` com a
regra, `000` sem ela.

**Decisão.** O NAT mora **no nó de saída**, como `POSTROUTING MASQUERADE` na
saída física do nó, aplicado pelo `PostUp` do próprio `wg0.conf` e desfeito pelo
`PostDown`. E o contêiner `wireguard` do `devstack/` é um **fixture de
desenvolvimento**, não um artefato que o produto publica: um nó de saída real é
recurso da stack `network` (DEC-011), com ciclo de vida, imagem e observabilidade
próprios.

**Rationale.** O nó é a única coisa no caminho que conhece a faixa do túnel. Pôr
o NAT num gateway à frente dele significaria ensinar esse gateway a rota de cada
faixa de cada nó, e passar a ter dois lugares que precisam concordar sobre uma
coisa que muda toda vez que um nó nasce. Manter no nó faz a configuração do túnel
e a tradução do tráfego nascerem e morrerem juntas — que é o que `PostUp` e
`PostDown` já expressam sem nenhum código nosso.

Rejeitado `--privileged` no compose. `cap_add: [NET_ADMIN]` mais
`/dev/net/tun` é exatamente o que o WireGuard precisa, e é a diferença entre um
arquivo que alguém copia em direção a produção e um que ensina o hábito errado.
O kernel do WSL2 do Docker Desktop traz `CONFIG_WIREGUARD=y` e `CONFIG_TUN=y`, e
por isso nem `SYS_MODULE` nem fallback em espaço de usuário são necessários.

A segunda metade da decisão é a que evita um erro caro por omissão. O contêiner
tem a **forma** de um nó de saída, e é por isso que ele engana: quem o encontrar
funcionando pode concluir que basta implantá-lo. Não basta — as chaves são
fixtures commitados, o endpoint de todo peer é o gateway da bridge, a faixa
`172.16.0.0/12` do peer é larga demais para qualquer coisa real, e não há
provisionamento, revogação nem medição. Registrar que ele **não** é entregável é
o que impede alguém de tratar `devstack/wireguard/` como ponto de partida de
infraestrutura.

**Consequências.** O compose do devstack ganha o primeiro `build:` e o primeiro
`cap_add`, `devices` e `sysctls` — e a primeira porta UDP, `21820` (DEC-010).

Um nó real herda a forma do `wg0.conf` e nada mais. Quando a stack `network`
existir, `MASQUERADE` na interface do nó compõe com o roteamento da VPC em vez de
substituí-lo, e é lá que se decide se o endereço de saída é um EIP por nó — que é
a pergunta que **regiões** vão fazer, e que este spike não responde.

O que o spike aprendeu e não decidiu está em `docs/specs/data-plane.md`, com uma
seção dizendo explicitamente o que não sobrevive à mudança para um nó de verdade.
Conhecimento vai para a spec; só a escolha arquitetural vira DEC.

---

### DEC-063 — O nó de saída entra por uma porta, e o adapter fala HTTP com um agente

**Data:** 2026-08-09 · **Status:** accepted

**Contexto.** Provisionar um peer é falar com um sistema externo, então o
inegociável nº 1 se aplica: interface em `@vpn/ports`, suíte de conformidade
antes dos adapters, uma implementação in-memory e uma real. Faltava decidir duas
coisas: o **nível** da interface e o **transporte** do adapter real.

**Decisão.** `IExitNode` é de domínio — `provisionPeer`, `revokePeer`,
`listPeers`, `describe` — e não de transporte (`wg set`). O adapter real fala
**HTTP** com um agente de controle que roda no próprio nó; no devstack esse
agente é `busybox httpd` mais três scripts CGI, publicado em `21821` (DEC-010).

**Rationale.** O nível vem da DEC-046, que rejeitou o primeiro desenho de
`IJobQueue` por ser transporte (`publish(body)`) em vez de trabalho
(`enqueue({name, data})`). Uma porta no nível do `wg` obrigaria todo chamador a
saber o que é uma allowed-ip; no nível do peer, quem chama sabe o que quer e não
como se faz.

`describe()` mora na porta e devolve a chave pública **que o nó reporta**, não
uma que o ambiente declare. Uma chave copiada para o `.env` é uma chave que
diverge do nó em silêncio, e o sintoma seria um túnel que nunca completa
handshake sem nada em log nenhum apontando para a causa. Endpoint e faixa são o
inverso: só o deployment sabe por onde o cliente alcança o nó, e por isso vêm de
env — do mesmo jeito que `S3ObjectStorage` recebe o bucket.

Rejeitado SSH. É o que se faz numa máquina sem agente, e um adapter sobre SSH
sobreviveria quase intacto à produção — mas frota grande com SSH a partir da
aplicação piora em tudo que importa: distribuição de chave, pool de conexões,
auditoria. O que muda daqui para um nó real **não é o protocolo**, é
autenticação e transporte seguro (mTLS ou token). E se esse julgamento estiver
errado, a porta é o que faz disso uma classe e não uma auditoria.

Rejeitado `docker exec` pelo socket: acopla o adapter ao Docker em vez de ao
WireGuard, e o socket não está montado em lugar nenhum — nem deveria.

**Consequências.** O agente do devstack é **sem autenticação**, e isso só é
defensável porque a DEC-062 já registrou que aquele contêiner é fixture e não
artefato. Autenticação é a primeira coisa que um nó real precisa, antes de
qualquer outra, e está dita aqui para que ninguém a descubra depois.

O formato do fio é texto linha a linha porque quem atende é shell; interpretar
JSON ali seria a parte frágil. A entrada é recusada fora do alfabeto base64
antes de chegar ao `wg`.

A suíte de conformidade roda contra os dois adapters, e a asserção que carrega
peso é a que a spec do plano de dados antecipou: aplicar o mesmo peer duas vezes
converge. É ela que torna a reentrega da DEC-064 segura.

---

### DEC-064 — O peer é reconciliado pelo outbox, não escrito na requisição

**Data:** 2026-08-09 · **Status:** accepted

**Contexto.** Criar um device escreve uma linha e precisa que o nó passe a
conhecer a chave. São duas escritas em sistemas diferentes na mesma operação —
exatamente a forma do dual-write que a DEC-047 tirou do e-mail e que o
`docs/04-ROADMAP.md` ainda registra como dívida no `createCheckout`.

**Decisão.** A linha em `devices` e a intenção `device.provision` são escritas na
**mesma transação**. Quem fala com o nó é o worker, pelo mesmo relay e a mesma
fila das notificações. `device.revoke` segue o mesmo caminho.

**Rationale.** As três alternativas falham de jeitos conhecidos. Chamar o nó
**dentro** da transação prende uma conexão do pool por uma ida e volta de rede e
repete a dívida que o roadmap já nomeia. Chamar **depois do commit** deixa, numa
queda entre os dois, uma linha que nenhum processo jamais provisiona — e nada a
repara, porque não há quem varra. Não chamar e deixar o nó ser a verdade inverte
o dono do dado: o banco tem RLS, a account e o histórico; o nó tem uma lista de
chaves.

O que torna o outbox seguro aqui é a porta ser convergente (DEC-063): `wg set`
aplicado duas vezes é o mesmo que aplicado uma. At-least-once só é aceitável
quando repetir é inofensivo, e é.

**Consequências.** O peer aparece um instante **depois** do download, e a
interface diz isso em vez de fingir. `provisioned_at` é gravado pelo worker
quando o nó aceita — nulo é "ainda não", não "falhou". Uma tela que mostrasse o
device como pronto antes disso mentiria pelo tempo que a fila levar.

O consumidor deixa de ser só de notificação. Ele drena uma tabela que agora tem
duas famílias de trabalho, e passar um job de device por um dispatcher que
resolve destinatário de e-mail exigiria um destinatário que não existe — por
isso ele subiu para `shared/outbox/` e roteia por família.

Revogar é `revoked_at`, não `DELETE`. A chave pública é o identificador do peer
nas duas pontas, e o worker precisa dela **depois** de a linha deixar de valer
para dizer ao nó o que esquecer. O índice único é parcial, então o endereço e a
chave voltam a ficar livres.

---

### DEC-065 — Uma fronteira que um cache ausente desliga não é fronteira

**Data:** 2026-08-10 · **Status:** accepted

**Contexto.** Duas metades da verificação de fronteira estavam quebradas de
formas diferentes, e as duas passavam em verde.

`@nx/enforce-module-boundaries` emite "No cached ProjectGraph is available. The
rule will be skipped" e **sai com 0** quando
`.nx/workspace-data/project-graph.json` não existe. `pnpm lint` era só
`eslint . --max-warnings 0`, sem nada que materializasse o grafo — então depois
de um `nx reset` toda a checagem de tag da DEC-017 parava de rodar e nada
avisava. Foi assim que a tag errada de `apps/worker` sobreviveu.

As zonas de par da DEC-027 estavam enumeradas à mão e cobriam `auth` e
`billing`. `modules/devices` e `modules/entitlements` nasceram depois e não
apareciam em zona nenhuma: `devices` podia importar `billing` sem que nada
reclamasse.

**Decisão.** `lint` passa a ser `node scripts/nx-graph.mjs && eslint .`. O script
chama `createProjectGraphAsync()`, confere que `readCachedProjectGraph()` devolve
projetos e sai com 1 dizendo por quê se não devolver. E as zonas de par deixam de
ser lista: `siblingZones()` lê `apps/api/src/modules` e `apps/web/src/features` do
disco e emite as N·(N−1) zonas.

**Rationale.** Uma regra que pula é pior que uma regra ausente — a ausente não
mente sobre o que foi verificado. O grafo é barato de construir e o script
transforma "pulei" em "falhei", que é a única forma de a regra ser uma garantia.

Derivar as zonas ataca a outra metade do mesmo problema: enumeração envelhece
em silêncio, e o modo de falha é exatamente o que aconteceu — o módulo novo
chega sem zona e ninguém percebe, porque não há erro para perceber. Lido do
disco, um módulo é coberto no instante em que a pasta existe.

Isto **não** revoga o aviso da DEC-027 de que zonas de par crescem em N·(N−1) e
que chegar a 5 módulos é o sinal de promover módulo a projeto Nx. Hoje são 4, e
derivar não muda a aritmética — só garante que o custo apareça em erro de lint,
não em fronteira faltando.

**Consequências.** `eslint.config.mjs` passa a ler o sistema de arquivos no
carregamento. É `.mjs` e roda em Node, então não custa nada, mas quer dizer que
uma pasta órfã dentro de `modules/` vira zona.

`module-boundaries.spec.ts` importa o config da raiz e afirma que todo par
ordenado tem zona — a prova de que a derivação cobre o que a enumeração cobria.

As quatro sondas foram feitas, cada uma revertida:

| Sonda                                       | O que falha                                       |
| ------------------------------------------- | ------------------------------------------------- |
| `nx reset` e `pnpm lint`                    | nada: o script reconstrói o grafo                 |
| `modules/devices` importa `modules/billing` | `import-x/no-restricted-paths`, zona derivada     |
| `shared/` importa `modules/`                | `import-x/no-restricted-paths`, zona do kernel    |
| `infra` importa `@vpn-poc/env`              | `@nx/enforce-module-boundaries`, restrição de tag |

A terceira e a quarta são as que importam: a primeira prova que o portão novo
não é decorativo, e a quarta prova que a regra do Nx voltou a rodar de verdade.
Um par circular (`libs/env` → `apps/api`) não serve de sonda de tag — a regra
reporta o ciclo antes de chegar à tag, e o erro não é o que se quer provar.
