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

**Data:** 2026-08-05 · **Status:** accepted

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

| Pacote                                | Veredito                        | Motivo                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `terminus`                            | **adotado**                     | DEC-030                                                                                                                                                                                                             |
| `throttler`                           | rejeitado                       | ver abaixo                                                                                                                                                                                                          |
| `config`                              | rejeitado                       | `libs/env` é zod mais descoberta de `.env`, e é consumido fora do Nest — migrations e `infra`. `ConfigModule` só existe dentro do container                                                                         |
| `jwt`                                 | rejeitado                       | é wrapper de `jsonwebtoken`; usamos `jose`, e `AccessTokenService` injeta a porta `CLOCK`, que um wrapper não aceita                                                                                                |
| `passport`                            | rejeitado                       | abstrai _várias_ estratégias; temos uma. O refresh é opaco com rotação por família (DEC-006) e não passa por strategy nenhuma                                                                                       |
| `class-validator` / `ValidationPipe`  | rejeitado                       | DEC-008                                                                                                                                                                                                             |
| `cache-manager`                       | rejeitado                       | abstração concorrente com `ICacheStore`, que tem suíte de conformidade e chave estruturada em vez de string                                                                                                         |
| `axios`                               | rejeitado                       | não há HTTP de saída fora de SDK de vendor                                                                                                                                                                          |
| `schedule`, `bullmq`, `event-emitter` | não se aplica                   | não há cron nem fila; a stack `workers` está vazia (DEC-011) e a idempotência é índice único (DEC-026), não event bus                                                                                               |
| `swagger`                             | adiado, com a forma já definida | não há OpenAPI hoje. `@ApiProperty` seria a segunda definição de "corpo válido" que DEC-008 rejeita; a forma aceitável é gerar o spec **a partir** de `@vpn/contracts` e usar `@nestjs/swagger` só para servir a UI |

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
