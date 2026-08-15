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

**Emenda — 2026-08-08.** Um quinto papel, `vpn_admin`: `LOGIN`, `BYPASSRLS`,
DML completo mais TRUNCATE, e **nenhuma** posse de schema. É o papel de um
humano num cliente gráfico, e existe só no devstack.

O que ele resolve é o atrito real de olhar o banco pelo DBeaver. `vpn_app` não
serve: a policy da DEC-035 usa `current_setting` estrito, então toda query fora
de uma transação com escopo levanta `42704` — correto por construção, inútil
para navegar. `vpn_readonly` não serve quando é preciso escrever. Sobrava
`vpn_migrator`, que funciona por ser dono das tabelas — RLS está `ENABLE`, não
`FORCE`, e o dono é isento das próprias policies.

Usar o migrator é justamente o que a emenda evita. Ele é a identidade que possui
o histórico de migrações; um `ALTER TABLE` digitado à mão numa GUI sob esse papel
não se distingue de schema legítimo, e drift ali é caro de perceber. `vpn_admin`
tem `USAGE` em `public` e nada de `CREATE`, então DDL falha com
`permission denied for schema public` em vez de virar dívida silenciosa.

TRUNCATE é o único privilégio que ele tem e `vpn_app` não. A assimetria é
proposital e serve de detector: um teste que precise deste papel está afirmando
contra privilégios que a aplicação nunca terá, e a regra de limpar com `DELETE`
continua valendo.

Rejeitado criar o papel à mão na conexão: `01-roles.sql` só roda no initdb, e
`make reset` é `docker compose down -v` — um papel não versionado evapora no
próximo reset e reaparece como um erro de login sem causa óbvia. Rejeitado
`SUPERUSER`: nada aqui precisa, e um superusuário na lista de conexões salvas é
o caminho mais curto para alguém apontar a aplicação para ele e não ver policy
nenhuma falhar.

Não há credencial nova em `.env`: nenhum processo conecta como `vpn_admin`. Ele
existe para um humano digitar num formulário de conexão.

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

---

### DEC-066 — O artefato de deployment é um bundle, e `tsc` nunca o produziu

**Data:** 2026-08-10 · **Status:** accepted

**Contexto.** `pnpm --filter @vpn-poc/api build` falhava, e o roadmap registrava
isso como dívida anterior a este trabalho: `tsconfig.build.json` tem
`rootDir: src`, e `libs/*` entram por caminho de fonte, fora dele. O
`typecheck` nunca reclamou porque `noEmit: true` desliga a checagem de
contenção do `rootDir`.

Ao medir os três apps, o quadro ficou pior do que a dívida dizia:

| Comando                     | Desfecho medido                                                    |
| --------------------------- | ------------------------------------------------------------------ |
| `@vpn-poc/api build`        | falha com `TS6059` em `libs/adapters`, `libs/database`, `libs/env` |
| `@vpn-poc/api-lambda build` | **sai com 0**                                                      |
| `@vpn-poc/worker build`     | **sai com 0**                                                      |

Os dois que saem com 0 são o problema de verdade. Sem `rootDir` alcançável, o
`tsc` infere a raiz comum e **emite `.js` e `.d.ts` dentro de `libs/*/src/`,
ao lado do `.ts`** — arquivos não versionados que passam a competir com a fonte
na resolução. E o `dist` que sai não roda:

```console
$ node apps/worker/dist/main.js
ERR_UNKNOWN_FILE_EXTENSION  Unknown file extension ".ts"
for .../apps/api/src/worker.ts
```

`@vpn-poc/api` declara `exports: { ".": "./src/bootstrap.ts" }`, então o
especificador nu resolve para TypeScript em runtime. Um `build` verde cujo
produto não executa é pior que um `build` vermelho.

**Decisão.** Apagar os três scripts `build`, os dois `start` que apontavam para
um `dist/main.js` que ninguém produzia, e os três `tsconfig.build.json`. O
artefato de deployment é um **bundle** — esbuild via `NodejsFunction` — e isso
passa a estar escrito em vez de suposto.

**Rationale.** Consertar o `rootDir` foi considerado e rejeitado: tirar o
`rootDir` faz o `tsc` sair com 0 e emitir uma árvore que continua não rodando,
porque o problema não é o layout do output, é o especificador nu resolver para
`.ts`. Seria verde pelo verde.

Dar `build` de verdade às libs — `main`/`types` apontando para `dist`, project
references — produz uma árvore executável, mas é a maior mudança possível aqui e
mexe em como `vite-node`, `vitest` e `pnpm dev` resolvem as libs hoje, que é
justamente o acordo que a DEC-018 fixou. Um bundler resolve o mesmo problema sem
tocar nesse acordo, e é o que a Lambda vai precisar de qualquer forma.

**Consequências.** `pnpm build` na raiz passa a construir só `apps/web`, que é o
único build que sempre produziu algo utilizável. `infra/` ainda não tem
`NodejsFunction` — o roadmap ganha o item, e agora ele nomeia o que falta em vez
de nomear um `tsc` quebrado.

O script da raiz também trocou `pnpm -r --filter './apps/*' --filter './libs/*'`
por `pnpm -r`. O filtro por caminho é o mesmo que o roadmap já registra em
`packages:publish:local`: no Git Bash ele não casa, e o `pnpm` responde
`No projects matched the filters` **saindo com 0**. Ou seja, `pnpm build` era um
no-op silencioso mesmo quando havia o que construir — a mesma forma de falha que
a DEC-065 acabou de tirar do lint, no comando ao lado. Filtrar por nada e deixar
cada pacote declarar se tem `build` é o que os scripts `test` e `typecheck` já
faziam.

Quem escrever o bundle não precisa mexer em `exports`: um bundler segue o
especificador até a fonte de propósito. Foi isso que o `tsc` tentou fazer sem
ser um bundler.

---

### DEC-067 — O submodule formata a si mesmo

**Data:** 2026-08-10 · **Status:** accepted · **Emenda a:** DEC-044

**Contexto.** A DEC-044 pôs `packages/` no `.prettierignore` com o argumento de
que submodule com workspace próprio não é formatado daqui. O argumento continua
válido; a consequência é que **ninguém** formatava. O submodule não tinha
`prettier`, não tinha `format`, não tinha `format:check`. Quatorze arquivos já
haviam derivado — incluindo os cinco `package.json` cujo `files`/`exports` a
DEC-002 depende que sejam legíveis.

**Decisão.** O submodule ganha `prettier`, uma cópia do `.prettierrc.json`, um
`.prettierignore` e um `verify` próprio: `format:check && typecheck && test`. A
fronteira da DEC-044 não se move — a raiz continua sem formatar `packages/`.

**Rationale.** Rejeitado tirar `packages/` do `.prettierignore` da raiz. Seria a
opção que mais pega drift, porque todo `pnpm verify` passaria por lá, mas põe um
config deste repositório governando texto de outro que tem toolchain próprio —
exatamente o acoplamento que a DEC-002 evita. Uma cópia do config é uma coisa a
manter em sincronia; um repositório governado de fora é uma fronteira que só
existe no papel.

O custo aceito é que o portão só roda de dentro de `packages/`. Isso é honesto:
é o mesmo lugar de onde `publish:local` e `consumer-check` já rodam, e é o
momento em que o drift importa.

**Consequências.** Escrever o `verify` revelou um bug maior que o problema
original. `nx run-many` resolve a raiz do workspace subindo até o **último**
diretório com `nx.json` — que é o repositório de fora. Medido:

```console
$ cd packages && pnpm exec nx show projects
["@vpn-poc/api-lambda","@vpn-poc/adapters","@vpn-poc/database",
 "@vpn-poc/worker","@vpn-poc/api","@vpn-poc/env","@vpn-poc/web","@vpn-poc/infra"]
```

Ou seja: `build`, `test` e `typecheck` de dentro de `packages/` rodavam os alvos
do consumidor e reportavam sucesso como se fossem os nossos. O pior é o
`publish:local`, que começa com `pnpm build` — ele publicava o `dist` que
estivesse no disco, sem reconstruir nada. Um publish sem build é a forma de
falha que a DEC-002 menos pode tolerar, e ela existia em silêncio.

Os três scripts passam a `pnpm -r run <alvo>`, que escopa por construção e já
ordena por dependência. `test:agent` sai junto: existia para desligar daemon e
cloud do nx, e sem nx não tem o que desligar. O `nx.json` do submodule fica —
ele é o que faz `pnpm exec nx` ser utilizável de lá com raiz explícita — mas
nenhum script depende dele.

---

### DEC-068 — A descrição do nó é cacheada com prazo, e uma chave trocada é dita em voz alta

**Data:** 2026-08-10 · **Status:** superseded by DEC-095

**Contexto.** `ExitNodeDirectory` memoizava a **promessa** de `describe()` pela
vida do processo. A memoização em si está certa: `describe()` está no caminho de
`GET /devices` e de `POST /devices`, e guardar a promessa — não o valor — é o que
faz dez chamadores concorrentes produzirem uma ida ao nó em vez de dez.

O que faltava era prazo. Reconstruir o contêiner do nó gera uma chave nova, e a
API continuava servindo a antiga até alguém reiniciá-la. Quem baixasse um `.conf`
nesse intervalo recebia um arquivo que **nunca** completa handshake, e a DEC-063
já tinha registrado que esse é justamente o sintoma sem log.

**Decisão.** A memo ganha TTL de **60 segundos** — o mesmo prazo que
`EntitlementsService` usa — e a releitura compara a chave com a anterior. Se
mudou, sai `exit_node.public_key_changed` em nível de erro, com a chave velha e a
nova.

**Rationale.** Das três invalidações possíveis, o TTL é a única que resolve o
caso real. "Limpar a memo quando falha" **já existia** e continua: uma rejeição
nunca foi cacheada. Mas um nó reconstruído não falha — ele responde, com outra
chave —, então o caminho de erro nunca é percorrido. "Reler quando um provision
falha" não ajuda: quem provisiona é o worker, que injeta `EXIT_NODE` direto e não
passa pelo directory; seria invalidar a memo do processo errado.

60 segundos limita o dano a uma janela, e o log é o que transforma essa janela em
algo diagnosticável. Só o TTL seria uma correção silenciosa de um problema
silencioso: quem baixou o `.conf` velho continua com um arquivo morto, e ninguém
saberia dizer por quê. Rotação da chave do nó continua fora de escopo como
produto (a spec de chaves diz isso), mas **detectá-la** não é escolha de produto.

**Consequências.** O directory passa a depender de `IClock`, então o teste
controla o tempo em vez de esperar. O arquivo não tinha spec nenhuma; agora tem
oito casos, e os dois que estavam vermelhos são o TTL e a chave trocada.

`e2e.setup.ts` passa a fixar `EXIT_NODE_DRIVER=memory`. Era o único driver que o
arquivo não fixava, e sem isso a suíte e2e conversa com o contêiner do devstack
que outras suítes usam ao mesmo tempo — um acoplamento que não se manifesta hoje
e se manifestaria em cheio no primeiro teste que varra os peers do nó.

O logger é `new Logger(...)` do `@nestjs/common`, como no `GlobalExceptionFilter`
e no `HealthCheckFilter`: `MODULE_LOGGER` é registrado por módulo de rota, e o
directory mora no kernel, que não tem um.

---

### DEC-069 — Uma consulta escolhe onde a varredura começa; o índice continua decidindo

**Data:** 2026-08-10 · **Status:** accepted

**Contexto.** `DevicesService.create` percorria `assignableAddresses` a partir
de `.4` e disparava um `INSERT ... ON CONFLICT DO NOTHING` por candidato. Com
197 endereços ocupados, o 201º device custava ~197 idas ao banco **dentro da
transação da requisição**, segurando uma conexão do pool o tempo todo.

O jeito óbvio de consertar — perguntar ao banco quais endereços estão livres —
esbarra na tenancy. O índice `devices_live_address_key` é único **global**: o nó
é um só e a faixa é uma só. Mas toda leitura de `devices` passa pela policy
`devices_tenant`, que a prende a uma account. E `runAsSystem` **lança** dentro
da transação já aberta pelo `TenantTransactionInterceptor` (DEC-050), de
propósito. Então dentro de `POST /devices` não existe leitura que enxergue a
faixa inteira.

**Decisão.** Uma view, `live_tunnel_addresses`, com **uma** coluna:

```sql
CREATE VIEW live_tunnel_addresses AS
  SELECT tunnel_address FROM devices WHERE revoked_at IS NULL;
GRANT SELECT ON live_tunnel_addresses TO vpn_app, app_system;
```

O dono é `vpn_migrator`, e o `security_invoker` do Postgres é `false` por
padrão: a view executa como o dono, que é dono de `devices` e — porque a RLS é
`ENABLE` e não `FORCE` — é isento das próprias policies. O serviço lê o conjunto
uma vez, calcula o primeiro host livre e começa o laço ali. O laço continua
existindo e o índice parcial continua sendo a **única** autoridade.

**Rationale.** Rejeitada uma função `SECURITY DEFINER` devolvendo o primeiro
host livre. Vazaria menos — um inteiro em vez de uma coluna — mas seria SQL
escrito à mão que o drizzle-kit não modela, enquanto `pgView` é declarado no
`schema.ts` e sobrevive a uma regeneração de `0000_init`. A diferença de
exposição é nominal: a view devolve endereços de túnel, que são inventário do
nó, e não identificam account nenhuma. A prova disso é asserção do teste — o
segundo caso afirma que a view tem exatamente uma coluna.

Rejeitado começar num host aleatório. Não custa schema nenhum e melhora o caso
médio, mas é probabilístico, piora conforme a faixa enche, e não responde a
pergunta que interessa: _qual_ endereço está livre.

Rejeitado tornar a faixa por account. Um nó, uma `/24`: dividir a faixa por
tenant desperdiça endereço e inventa uma fronteira que a rede não tem.

**Consequências.** A dica pode estar velha quando o `INSERT` chega — outra
requisição pode ter tomado o endereço no intervalo. É por isso que o laço não
foi removido: ele tenta o próximo, e o gerador **dá a volta** até `.4` em vez de
parar no fim da faixa, para que "sem endereço livre" continue querendo dizer
exatamente isso. O teste que fixa esse contrato é o que conta 251 candidatos
partindo de `200`.

Esta é a primeira view do schema e a primeira brecha deliberada na RLS. Ela é
estreita por construção — uma coluna, sem `account_id` — mas é uma brecha, e o
teste de integração existe para que ela não vire duas. Ele afirma, como
`vpn_app` escopado na account B, que a view devolve um endereço que um `SELECT`
direto de B **não** devolve. Fica vermelho no dia em que alguém puser
`FORCE ROW LEVEL SECURITY` na tabela, que é exatamente quando se quer saber.

`GRANT` não é modelado pelo drizzle-kit, então ele foi escrito à mão em
`0002_tunnel_allocation.sql`, depois do `--> statement-breakpoint`. Quem
regenerar `0000_init` recupera a view pelo `pgView` e **perde o `GRANT`** — está
dito aqui e no roadmap.

---

### DEC-070 — Posse é o escopo padrão; a role só alarga

**Data:** 2026-08-10 · **Status:** superseded by DEC-082

**Contexto.** O `CONTEXT.md` diz há tempo que autorização tem duas dimensões que
compõem: o entitlement diz o que a _empresa_ contratou, a role diz o que _esta
pessoa_ pode fazer, e o efetivo é a interseção. A primeira ganhou chamador de
produção com `/devices` (DEC-055). A segunda não tinha chamador **nenhum**:
`role` era escrita como `'owner'` no cadastro, copiada para o claim `rol` e nunca
mais lida.

Duas consequências, em direções opostas:

- `GET /devices` filtra por `claims.userId`, então um `owner` **não vê** o device
  de um membro. Desligar alguém deixa o túnel dessa pessoa de pé, e não há tela
  que mostre isso.
- `DELETE /devices/:id` filtrava só pelo `id`. O que segurava a requisição era a
  policy `devices_tenant`, que para na account — **não** na pessoa. Ou seja: um
  `member` já podia revogar o device de um colega, adivinhando um id que o `GET`
  nunca lhe mostraria.

As duas são a mesma dimensão faltando, vista de lados opostos.

**Decisão.** Toda operação de device tem um **escopo**: `{ ownedBy: userId }` por
padrão, `{ wholeAccount: true }` quando `hasAtLeastRole(role, 'admin')`. A policy
dá o limite da account; a consulta dá o limite da pessoa. `hasAtLeastRole` é uma
função pura em `shared/access-control/roles.ts`, com um mapa de ranks.

**Rationale.** `admin` entra junto com `owner` porque desligar gente é trabalho de
administração, e deixar `admin` de fora manteria uma role que o código continua
não lendo — que é exatamente o problema que esta decisão fecha.

O 404 do caso negativo é deliberado: um id inexistente e o id de outra pessoa
respondem igual. Um 403 confirmaria que o device existe para quem não pode
vê-lo, o que é a mesma família de vazamento que o inegociável nº 4 trata em
`login`.

**Não existe `@RequiresRole`.** Nenhuma rota aqui é barrada por role sozinha: as
duas roles chegam ao `DELETE /devices/:id` e o que muda é o **escopo**, não o
acesso. Um guard que responde sim/não antes do handler não sabe expressar isso —
ele teria que ler a linha para decidir, e ler a linha é trabalho do serviço. O
roadmap já registra o custo de embarcar um guard sem chamador de produção:
`@RequiresCapability` esperou `/devices`. `@RequiresRole` chega com a página de
usuários, que é a primeira rota barrada por role e nada mais. `FORBIDDEN → 403`
já existe em `app-error.ts` para esse dia.

**Consequências.** `DeviceRepository.revoke` e `listLive` recebem escopo em vez
de `userId`. `DevicesService` passa a receber os claims inteiros em vez de duas
strings soltas — a decisão de escopo é dele, e para decidir ele precisa da role.

Um `member` continua vendo só os próprios devices; um `admin` passa a ver os da
account inteira, e cada linha carrega de quem é. Isso muda o `deviceSchema` de
`@vpn/contracts`, que ganha `userId` e `userEmail`. Não é vazamento novo: um
`member` só recebe as próprias linhas, então o único e-mail que ele vê continua
sendo o dele.

---

### DEC-071 — Um cascade não publica em sistema externo: o banco recusa, e o worker reconcilia

**Data:** 2026-08-10 · **Status:** accepted

**Contexto.** `devices.account_id`, a FK composta `(user_id, account_id)` e
**também** `outbox.account_id` são todas `ON DELETE cascade`. Então
`DELETE FROM accounts` apaga as linhas de device **e** qualquer intenção
`device.revoke` ainda não publicada, no mesmo comando. Não existe ordem de
escrita que salve: se a intenção é escrita antes, o cascade a leva junto; se
depois, a FK recusa porque a account já não existe.

Resultado: apagar uma account deixa peers no nó para sempre. Não há endpoint de
exclusão ainda, e é exatamente por isso que o mecanismo precisa existir antes de
alguém escrever um.

**Decisão.** Duas metades, porque elas cobrem buracos diferentes.

**O banco recusa o caminho silencioso.** Um trigger `BEFORE DELETE` em `devices`
levanta `restrict_violation` quando `revoked_at IS NULL`. Trigger de linha
dispara em delete cascateado, então isso pega o caminho da account, o do user e
cirurgia manual, sem depender de disciplina. Quem quiser apagar tem que revogar
antes — que é a ordem que o outbox consegue carregar.

**O worker repara o que o trigger não alcança.** Um `PeerReconciler` compara
`listPeers()` do nó com os devices vivos lidos como `app_system` e converge nos
dois sentidos.

**Rationale.** Rejeitada uma tabela de lápide com `account_id ON DELETE set null`,
no precedente de `billing_events`. Ela sobreviveria ao `DELETE FROM accounts` —
e é justamente isso que a torna errada aqui: o `beforeEach` do e2e apaga accounts
para zerar o mundo, e uma tabela que sobrevive a isso acumula entre testes e
vaza de um para o outro. Fazer `outbox.account_id` virar `set null` falha antes
disso: a coluna é `NOT NULL` e é o que `runInAccount` e a policy leem.

Só o trigger não basta. Ele não ajuda quando o device **já foi revogado** e a
intenção ainda não foi publicada: aí o delete é legítimo, e a linha do outbox vai
junto no cascade. Também não ajuda com nó reconstruído, job que terminou na DLQ,
nem restauração de backup. O nó é uma projeção (DEC-064), e projeção se conserta
reconciliando.

Só o reconciler também não basta, e por um motivo diferente: ele conserta depois,
e "depois" tem duração. Entre o `DELETE` e a varredura, o peer continua roteando
tráfego de alguém que a empresa acha que desligou. O trigger fecha essa janela
para o caminho que se sabe percorrer; o reconciler cobre o resto.

**Consequências.** `listPeers()` passa a devolver `PeerSpec[]` em vez de chaves.
Sem o endereço, a varredura não distingue um peer nosso do fixture semeado à mão
em `10.13.13.2` no devstack, e removeria o fixture. Com ele, o reconciler se
limita à faixa que o alocador entrega (`.4`–`.254`): o que ele não distribuiu não
é dele para revogar. É mudança quebrando em `@vpn/ports`, e a suíte de
conformidade muda **antes** dos dois adapters.

O trigger quebra `DELETE FROM accounts` sem qualificação. Os três lugares que
faziam isso — o `beforeEach` do e2e e o `beforeAll`/`afterAll` da suíte de RLS —
passam a revogar antes. Isso é a propriedade certa, não um custo: o harness
deixa de conseguir fazer o que produção não pode.

O reconciler lê `listPeers()` **fora** de transação, abre `runAsSystem` só para
ler as linhas vivas, fecha, e só então fala com o nó. Chamada externa com
transação aberta é a dívida que o roadmap já nomeia em `createCheckout`, e
repeti-la aqui seria escrevê-la de novo de propósito.

---

### DEC-072 — A lista de dispositivos pesquisa enquanto houver pendente, e sem prazo

**Data:** 2026-08-10 · **Status:** accepted

**Contexto.** Criar um device responde 201 com `provisioned_at` nulo: quem
escreve o peer no nó é o outbox (DEC-064), e isso termina cerca de um segundo
depois. O `invalidatesTags: ['Devices']` da mutation dispara **um** refetch,
imediatamente após o POST — ou seja, sempre dentro da janela em que o worker
ainda não terminou. A resposta volta pendente, nada mais refaz a consulta, e o
badge fica em "Liberando o acesso no servidor…" até alguém apertar F5.

O que torna isso pior que uma tela desatualizada: o túnel **já funciona** nesse
meio tempo. O handshake completa, o tráfego passa, e a única coisa errada na
máquina é a frase na tela dizendo que ainda não está pronto.

**Decisão.** `useDevicesQuery` recebe `pollingInterval` de 2s enquanto **algum**
device da lista estiver sem `provisioned_at`, e 0 quando não houver nenhum. O
predicado é derivado da lista, não do sucesso da mutation: um device pendente
carregado num boot de página — outra aba, outro dispositivo, um reload no meio
do provisionamento — resolve igual.

**Rationale.** Sem prazo, ao contrário da DEC-058, e a diferença não é
inconsistência. Lá o polling alimenta uma tela terminal, e o limite existe
porque há um estado neutro para oferecer no fim dele: "sendo processada", com um
botão de verificar de novo. Aqui o polling alimenta um badge dentro de uma lista
que já é o estado vivo da página, e não existe evento terminal único a esperar.
Um limite sem estado novo não resolveria nada — recriaria este mesmo bug alguns
segundos mais tarde, que é precisamente o defeito que a decisão está corrigindo.

Rejeitado também acordar a lista pelo retorno da mutation: isso conserta só o
caminho de quem acabou de clicar em gerar, e é o caminho que menos precisa de
conserto, porque é o único em que a pessoa sabe o que está esperando.

**Consequências.** É o segundo polling do app, e `apps/web/CLAUDE.md` deixa de
dizer que a tela de checkout é o único. O custo no caso normal é uma requisição:
o worker termina em ~1s e o predicado fecha na primeira volta.

Se o worker estiver morto, uma aba aberta na página consulta a cada 2s pelo tempo
que ficar aberta. É aceitável e é deliberado — a alternativa é parar de perguntar
e continuar mostrando "liberando", que é a mentira que a decisão remove.
Diagnosticar worker morto é trabalho do `tunnel:doctor`, não do badge.

`listLive` não devolve device revogado, então uma linha revogada antes de ser
provisionada não segura o polling aberto para sempre.

---

### DEC-073 — O plano de controle do nó exige credencial, e quem a cobra é o `httpd`

**Data:** 2026-08-10 · **Status:** superseded by DEC-098

**Contexto.** A DEC-063 registrou em voz alta que o agente do nó não tem
autenticação nenhuma, e a DEC-062 é o que tornava isso defensável: aquele
contêiner é fixture, não artefato. Mas `21821` está publicado no host, e qualquer
coisa que o alcance adiciona ou remove qualquer peer — inclusive um `wg set` que
mova o endereço de um device de outra account. É a primeira coisa que um nó real
precisa e a última de que alguém vai lembrar.

**Decisão.** HTTP Basic contra um **token compartilhado**, cobrado pelo próprio
`busybox httpd`: o entrypoint escreve `/:worker:$EXIT_NODE_API_TOKEN` em
`/etc/httpd.conf` e sobe `httpd -c /etc/httpd.conf -r 'poc-vpn exit node'`. O
adapter carrega o cabeçalho; `EXIT_NODE_DRIVER=http` sem `EXIT_NODE_API_TOKEN`
falha no boot, em `assertDriverConfiguration`, e o entrypoint do nó recusa subir
sem token para conferir.

**Rationale.** O 401 acontece **antes de qualquer CGI rodar**. É a mesma razão
pela qual a idempotência aqui é restrição de banco e não `if`: não existe script
que possa esquecer a checagem, porque nenhum script participa dela. Os três CGI
ficam byte a byte como estavam.

Rejeitado token `Bearer` comparado dentro de cada CGI. São três cópias da mesma
guarda em shell, e a quarta rota que alguém escrever nasce sem ela. Além disso
depende de o busybox repassar `Authorization` ao CGI, o que não é conferível
contra esta imagem sem reconstruí-la — enquanto `-r REALM`, `-c FILE` e `-m` estão
no `httpd --help` dela.

O custo de trocar depois é simétrico e pequeno, e é isso que torna a escolha
barata: a credencial **não entra na porta**. `IExitNode` e
`describeExitNodeContract` não mudaram uma linha, então `packages/` não é
republicado e os quatro consumidores não se movem. Se a suíte de conformidade
tivesse precisado de edição, a credencial teria vazado para a porta e o desenho
estaria errado. Ir para `Bearer` é uma linha no adapter mais uma guarda por CGI.

mTLS continua sendo o teto, e é de um nó de verdade: ele é certificado de cliente
num dispatcher de `fetch` mais terminação TLS no nó, e **não reaproveita esquema
de cabeçalho nenhum**. Por isso um `Bearer` hoje não adiantaria caminho para o
mTLS de amanhã.

**Consequências.** O nome `worker` é constante nas duas pontas — o nó não tem
diretório de usuários, então o token é a senha e o nome é literal no `Dockerfile`
(`CONTROL_USER`) e em `HttpExitNode`. É o único detalhe do esquema que fica
gravado, e ele desaparece junto com o esquema.

`HttpExitNode` lança no construtor com token vazio, no precedente do
`ConsoleSmsSender`: fecha o `?? ''` da factory do registry, que existe só para o
tipo.

O healthcheck do compose virou script (`healthcheck.sh`), com três sondas em vez
de duas. A nova é a que importa: uma chamada **sem** credencial não pode receber a
chave pública. Ela afirma a ausência do corpo, não um `401` — o texto da linha de
status pertence a quem serve o realm, e o corpo é o que não pode escapar.

O token do devstack é fixture commitado, na categoria de `vpn_app_dev` em
`01-roles.sql` e das chaves de `wireguard/peers/`. Ele aparece em `.env.example` e
como default no compose, e são dois lugares porque o diretório de projeto do
compose é `devstack/`: o `.env` da raiz é invisível para ele, que é a razão de
cada porta ali já ter default. O `check.sh` lê o token do `.env` da raiz, não do
default — então a asserção que pede a chave pública prova também que **as duas
metades concordam**. Sem isso, uma divergência é um 401 silencioso dentro do
worker.

Um nó real não herda nada disso a não ser a forma: um token só para a frota
inteira não é rotacionável sem derrubar todos os nós ao mesmo tempo, e isso está
no roadmap em voz alta.

---

### DEC-074 — A varredura converge duas projeções, e pendente não é falho antes de um prazo

**Data:** 2026-08-10 · **Status:** accepted

**Contexto.** A DEC-064 escolheu o outbox para que uma queda não perdesse o
trabalho, mas at-least-once só vale enquanto alguém continua entregando. Um
`device.provision` que esgota o `maxReceiveCount: 5` termina na DLQ, e a linha diz
`provisioned_at IS NULL` para sempre: sem alarme e sem reparo. A DEC-071 já pôs um
reconciliador no worker, e ele repõe o **peer** — mas não carimba a coluna. O
roadmap registrava exatamente esse descompasso: o túnel volta a funcionar e a tela
continua dizendo "liberando o acesso no servidor" indefinidamente.

**Decisão.** A mesma varredura converge as duas projeções da linha: a lista de
peers do nó **e** `provisioned_at`. Um device vivo sem carimbo, passado um prazo
de 120s desde `created_at`, tem o peer reposto se faltar e a coluna carimbada com
o instante da varredura. Dentro do prazo ele não é assunto da varredura: continua
em `wanted`, para que o peer que um job acabou de escrever nunca seja confundido
com órfão, mas não é provisionado nem carimbado.

Os pontos de entrada são dois: `runOnce()` varre sempre, `runIfDue()` mantém o
intervalo de 300s e é o que o laço do worker chama.

**Rationale.** O prazo é o que separa "o job está a caminho" de "o job morreu".
Sem ele a varredura disputaria com o consumer todo device recém-criado — inofensivo,
porque `wg set` converge (DEC-063), mas passaria a haver dois processos escrevendo
a mesma coluna no mesmo segundo e nenhum jeito de dizer, num log, qual dos dois fez
o trabalho.

Rejeitado reenfileirar `device.provision` para que o job continuasse o único
escritor da coluna. Isso põe uma leitura de `outbox` justamente no serviço que não
pode disputar com o relay: sem `for update skip locked` ela brigaria, e o sintoma
seria um job rodando duas vezes ou nenhuma, diferente a cada corrida. E
reconduziria o trabalho exatamente pelo caminho que já esgotou as tentativas dele.
Hoje o reconciliador **não toca em `outbox`**, e é uma propriedade a manter.

O que autoriza a varredura a escrever nas duas pontas é o que a DEC-071 já
argumentou: o banco tem a RLS, a account e o histórico; o nó tem uma lista de
chaves. O nó é projeção, e projeção se conserta reconciliando — em qualquer um dos
dois sentidos.

**Consequências.** `ReconcileReport` ganha `stamped`, e o
`exit_node.reconciled` do log passa a dizer os três números. Uma varredura em
regime devolve `{ revoked: 0, provisioned: 0, stamped: 0 }` e não escreve nada:
medido contra o nó real, três varreduras seguidas, lista de peers idêntica e
carimbo intacto.

`markProvisioned` continua `where provisioned_at is null`, então nem a segunda
entrega do job nem a varredura seguinte movem o carimbo. As escritas acontecem numa
**segunda** transação de sistema, depois de todas as chamadas ao nó: chamada
externa com transação aberta é a dívida que o roadmap já nomeia em
`createCheckout`, e a DEC-071 já tinha se recusado a repeti-la.

Um peer que o nó recusa aborta a varredura e nada é carimbado — carimbar o que o
nó não aceitou seria mentir na direção mais cara. A próxima varredura repete, e é
`wg set` convergir que torna isso seguro. Isolar peer a peer fica no roadmap.

O `runIfDue()` continua com o intervalo num campo privado do processo, então dois
workers varreriam em paralelo. Há um; a dívida segue registrada.

---

### DEC-075 — A prova do túnel é um recurso privado próprio, e o nó não mascara o caminho até ele

**Data:** 2026-08-10 · **Status:** accepted

**Contexto.** Nada neste repositório responde "o túnel carrega tráfego?". O
`check.sh` afirma que o peer semeado existe e que o plano de controle responde —
as duas coisas são estáticas e ficam verdes com zero pacote atravessando. O e2e
fixa `EXIT_NODE_DRIVER=memory`, então não toca `wg` nenhum. Handshake, `ping` e a
sonda de NAT existem só como prosa em `data-plane.md`, medidos uma vez à mão. A
própria spec já dizia o que falta: _"'O contêiner subiu' não é sucesso."_

**Decisão.** Um **recurso privado** de propósito, o canário: uma página e um
`GET /api/hello` numa sub-rede fixada, `172.30.13.0/24`, **sem porta publicada**.
O nó ganha um pé nessa rede e uma regra `RETURN` acima do MASQUERADE existente. O
serviço mora num repositório irmão, `poc-vpn-canary`; a rede é declarada aqui.

**Rationale.** A sonda de `data-plane.md` mira o Verdaccio, e isso tem dois
defeitos que só aparecem na segunda vez que alguém a roda. Ela **empresta um
serviço** — o Verdaccio existe para publicar `@vpn/*`, e uma prova de rede que
depende dele passa a falhar por motivo de registry. E ela mira um endereço que
**se move**: o próprio documento mediu o Verdaccio saindo de `172.18.0.7` para
`172.18.0.8` num `reset`, e declara todo `172.18.x.x` ilustrativo. Uma prova cujo
alvo precisa ser descoberto antes de cada execução não vira asserção. Fixar a
sub-rede é o que troca "descubra o endereço" por um número que se pode escrever
num teste.

`RETURN` acima do MASQUERADE, e não mais MASQUERADE, por duas razões. Um recurso
privado precisa ver o **endereço do túnel**, não o do nó, ou não tem como dizer
_qual_ device o alcançou — e `seenFrom` é a única linha que separa "um servidor
respondeu" de "um servidor viu meu device". MASQUERADE é para egress à internet,
onde o mundo lá fora não tem rota de volta para `10.13.13.0/24`; aqui a rota
existe, porque o nó está nas duas redes. A regra casa em **destino**
(`-d 172.30.13.0/24`) em vez de interface, o que a torna independente de qual de
`eth0`/`eth1` o Docker entrega a cada rede — uma ordem que o Docker não garante
depois que um contêiner entra em duas. A linha de MASQUERADE fica byte a byte
como estava, então o `200 → 000 → 200` de `data-plane.md` continua verdadeiro.

`172.30.13.0/24` não é arbitrário. Está dentro de `172.16.0.0/12`, que é o que o
`.conf` do spike já traz em `AllowedIPs`, então o arquivo commitado alcança o
canário sem edição. E está livre da tabela de rotas que `data-plane.md` mediu
nesta máquina — `192.168.15.0/24`, `192.168.48.0/20` e `26.0.0.0/8`, esta última
a rota default do Radmin VPN.

Repositório irmão pelo mesmo argumento da DEC-062, um passo adiante. Lá a linha
foi desenhada porque o nó é fixture e não artefato de produto; o canário está
ainda mais fora, porque ele não representa nem a nossa infraestrutura — ele faz o
papel do **serviço de um cliente**. Um diretório dentro deste repo diria que o
produto tem um recurso privado, e ele não tem.

**Consequências.** Nenhuma mudança de código de aplicação, e nenhuma em
`apps/web`. O caminho já é genérico: `EXIT_NODE_CLIENT_ALLOWED_IPS` já é dividido
por vírgula em `adapters.module.ts`, `exitNodeSchema.allowedIps` é
`z.array(z.string())` sem forma por entrada, e o teste de `buildWireguardConfig`
já afirma o caso de duas faixas. **`packages/` não se move.**

O compose passa a declarar `networks:`, o que `data-plane.md` citava como não
sendo o caso. O que aquele documento afirma continua valendo: o endereço na
bridge default continua vindo do pool do Docker e continua se movendo num
`reset`. O que ganha endereço estável é só a rede do canário.

`wireguard` precisa listar `default:` explicitamente. No instante em que um
serviço declara `networks:`, ele deixa de entrar na rede default implicitamente —
e o sintoma seria todo o resto do devstack perdendo o nó, não o canário falhando.

A rede é declarada **aqui** e consumida como `external` lá, para que `make up`
funcione numa máquina que nunca ouviu falar do repositório do canário. Em troca,
`make reset` destrói a rede e o canário precisa subir de novo.

Em produção nada disso é configuração: `EXIT_NODE_CLIENT_ALLOWED_IPS=0.0.0.0/0` e
qualquer recurso privado é alcançável sem faixa nenhuma listada. A faixa estreita
local é contorno da rota default desta máquina, não desenho que cresce para uma
tela.

---

### DEC-076 — Um user criado por admin nasce verificado, e a senha é gerada e mostrada uma vez

**Data:** 2026-08-10 · **Status:** accepted

**Contexto.** Não existe convite por e-mail no PoC, e o roadmap diz isso desde a
Fase 2: _"Admin cria user direto com senha. Sem convite por e-mail"_. Sobram duas
perguntas que ninguém tinha respondido, e as duas são de produto e não de schema:
o endereço já está verificado, e de onde sai a primeira senha.

A primeira não é opcional. `email_verified_at` nulo faz o login responder
`EMAIL_NOT_VERIFIED` **para sempre**, porque o caminho que emitiria o token é o de
auto-cadastro e ninguém o percorreu.

**Decisão.** O user nasce com `email_verified_at = now()`. A senha é **gerada pelo
servidor** — 32 bytes de `randomBytes` em base64url —, devolvida uma única vez no
corpo do 201, e guardada só como hash scrypt, na mesma coluna e pelo mesmo caminho
de todas as outras.

**Rationale.** Nascer verificado é a decisão, não um atalho: **o admin avalizou**.
Ele digitou o endereço de alguém que conhece, dentro da própria account,
autenticado. Verificação de e-mail existe para provar que quem se cadastrou
controla o endereço que informou; aqui não houve auto-cadastro. O `colleagueOf` do
e2e já carimbava `now()` desde que existe — o harness acertou por necessidade, e a
feature precisa dizer o mesmo em voz alta em vez de herdá-lo por acidente.

Gerada em vez de digitada pelo admin, e essa foi a escolha menos óbvia. Uma senha
que um humano inventa num formulário, com pressa, para outra pessoa, é a mesma
senha que ele vai usar nos próximos cinco users — e é a única do sistema que nasce
fraca por construção, num fluxo em que ninguém a escolheu de propósito. Uma senha
gerada é uniforme, não vem reaproveitada de outro sistema e não passa pela cabeça
de ninguém. O custo é **um** estado de tela: um valor mostrado uma vez, com botão
de copiar, que some no reload.

Rejeitado **forçar troca no primeiro login**. Custa uma coluna, uma tela e um ramo
em toda rota autenticada, e num PoC em que o admin entrega a senha na mão a troca
é convenção que ninguém verifica. Fica registrado como o que falta para isto virar
produto.

Rejeitado **mandar a senha por e-mail**. É a mesma objeção da DEC-048: um e-mail
renderizado carrega o segredo **em claro**, e todo o desenho de token existe
justamente para que o banco só guarde hash. Mandar a senha por e-mail desfaria
aquilo pela porta dos fundos.

Rejeitado **devolver a senha em qualquer leitura posterior**. Ela existe no corpo
de uma resposta e em lugar nenhum mais; quem a perdeu usa "esqueci minha senha",
que é o caminho de todo mundo e já está construído.

**Consequências.** `passwordSchema` pede no mínimo 12 caracteres e no máximo 200;
43 caracteres de base64url passam com folga, então a senha gerada é válida pelas
mesmas regras que uma digitada — ela não é uma espécie à parte.

Nenhuma coluna nova, nenhum caminho de login novo.

Aparece uma segunda via de criação de user, e com ela um problema que estava
adormecido: `UserRepository.insert` fazia `onConflictDoNothing()` **sem alvo**, o
que absorve os quatro índices únicos de `users` de uma vez — o mesmo defeito que o
trabalho de devices já consertou uma vez (DEC-069).

**Emenda — 2026-08-11.** A primeira versão desta decisão dizia que o cadastro
"nunca alcança os índices de owner de outro jeito" e que bastaria nomear um alvo.
Errado, e o e2e provou: o cadastro **depende** de absorver `users_owner_email_key`
— é exatamente assim que ele detecta um e-mail repetido e devolve o mesmo 202 do
caso novo, que é o inegociável nº 4. Nomear `(account_id, email)` fez um segundo
cadastro levantar `23505` e virar 500.

São dois caminhos com índices diferentes, e cada um nomeia o seu, no precedente do
`device.repository`, que já usa `target` com `where` para índice parcial:

- `insert`, do cadastro, nomeia `(email) where role = 'owner'`. Uma account nova
  não pode colidir em `(account_id, email)`, então esse é o único índice
  alcançável ali.
- `insertMember`, da página de usuários, nomeia `(account_id, email)`.

Em ambos, o que **não** foi nomeado levanta `23505` em vez de virar um "não fiz
nada" silencioso — que é o ponto original, agora aplicado com o alvo certo em cada
lado.

---

### DEC-077 — Exit node é dado do tenant, e o que vale é o que o nó responde

**Data:** 2026-08-10 · **Status:** superseded by DEC-090

**Contexto.** Existe **um** nó, e ele vem de variável de ambiente
(`EXIT_NODE_*`). Isso bastou enquanto o produto tinha um data plane só e nenhuma
tela para administrá-lo. O brief pede gerenciamento de servidores e regiões, e uma
frota não cabe num `.env`: ela muda em runtime, ela é diferente por cliente, e ela
precisa de dono.

**Decisão.** `exit_nodes` vira tabela **sob RLS**, como qualquer outra tabela de
domínio, com `account_id`. Colunas: rótulo, região, endpoint, URL de controle, a
chave pública **reportada**, referência à credencial e `last_seen_at`. O registro
de um nó **chama `describe()`** e guarda o que o nó respondeu. A semente é o que
hoje está no `.env`.

**Rationale.** Num produto whitelabel o nó é do cliente: é a máquina dele, na
região dele, com a banda dele. Um nó global compartilhado seria um produto
diferente — e, pior, faria uma account enxergar a infraestrutura de outra. RLS não
é enfeite aqui; é a mesma razão da DEC-035, e a tabela nasce com policy por
construção.

Guardar **o que o nó responde**, e nunca o que o formulário afirmou, é a parte que
carrega peso. A chave pública é a identidade do nó nas duas pontas — é ela que vai
para dentro de todo `.conf` baixado. Aceitar a chave que alguém digitou num campo é
aceitar que um erro de digitação vire um `.conf` que nunca fecha handshake, e a
falha aparece longe, no cliente, sem nada apontando para a causa. A DEC-063 já
tinha desenhado essa custódia — _"a chave pública que o nó reporta"_ —, e esta
decisão só a move de uma variável de ambiente para uma linha.

`last_seen_at` existe para uma regra e não para um gráfico: **um nó que não
responde há tempo demais não é entregue a um device novo**. Sem isso, o primeiro
sintoma de um nó morto é um cliente com um `.conf` que não conecta.

**Consequências.** O `.conf` nomeia um servidor específico, o que o tenant
registrou. Isso é limitação e vai dita em voz alta, no registro que
`data-plane.md` usa: **um device fica preso ao nó que lhe foi atribuído**, e se
esse nó sair do ar o `.conf` é **reemitido**, não reapontado. Em troca, não existe
par de chaves compartilhado por região nem DNS para reapontar, e a custódia da
DEC-063 sobrevive inteira.

A faixa de endereços passa a ser **por nó**, e isso levanta um teto que já estava
perto: o índice único parcial de hoje distribui de um único `/24` — `.4` a `.254`,
**251 endereços** — contra `seats: 25 × devicesPerUser: 5 = 125` devices vivos por
account totalmente assinante. **Duas** accounts e acabou. Como dois nós são redes
independentes, o índice vira `(exit_node_id, tunnel_address) where revoked_at is
null` e cada nó ganha os seus 251. A view `live_tunnel_addresses` da DEC-069 passa
a ser por nó — e o `GRANT` dela é escrito à mão em `0002_tunnel_allocation`, porque
o drizzle-kit não modela privilégio.

A varredura passa a rodar **por nó**, convergindo cada um contra os devices vivos
atribuídos a ele. É também o momento de consertar o defeito que o roadmap já
registra: hoje um peer recusado aborta a varredura inteira, e o isolamento por nó é
a fronteira natural para isolar peer a peer.

---

### DEC-078 — O entitlement de região conta, não lista

**Data:** 2026-08-10 · **Status:** superseded by DEC-099

**Contexto.** `REGIONS = ['us','eu']` é um enum fechado em `@vpn/contracts`, e
`entitlements.regions` é um array dele. Foi assim desde a DEC-036, quando região
era um rótulo de produto que nós escolhíamos.

**Decisão.** As regiões passam a ser **nomeadas pelo tenant**, e o entitlement
deixa de dizer _quais_ para dizer **quantas**: `regions` vira um inteiro, da mesma
natureza de `seats`, aplicado na escrita e por restrição de banco (DEC-043).

**Rationale.** Um enum fechado e um produto whitelabel são incompatíveis, e a
prova cabe numa frase: uma empresa brasileira não vai vender "us | eu" para os
clientes dela. Ela quer "São Paulo" e "Rio". No instante em que o cliente nomeia, o
enum deixa de poder ser a fonte da verdade — ele viraria uma tabela de-para entre o
nome que o cliente mostra e o rótulo que nós guardamos, que é a pior das duas
opções porque parece funcionar.

E se o nome é do cliente, o tier não tem como entitular **quais**: ele não conhece
os nomes. Sobra o que ele sempre pôde dizer — quantas. Contador é uma forma que já
existe aqui e cujo mecanismo já está decidido: aplicar na escrita, por restrição,
nunca `count()` seguido de `INSERT`.

Rejeitado manter o enum fixo e fazer os tenants arquivarem os servidores deles sob
ele. É mais simples, é uma linha de código a menos, e está errado pelo motivo que
importa: obriga o cliente a traduzir a geografia dele para a nossa. Num produto
cujo ponto inteiro é não ter a nossa marca, impor o nosso vocabulário de região é a
mesma falha de marca com outra roupa.

**Consequências.** `REGIONS` e `regionSchema` saem de `@vpn/contracts` como fonte
da verdade. `regions` vira tabela do tenant, sob RLS, e `entitlements.regions` muda
de `Region[]` para `number` — uma mudança **quebrante** no pacote, e é por isso que
ela viaja na mesma release da superfície de usuários.

`devices` ganha **duas** colunas e não uma: `region_id`, que é a escolha da pessoa,
e `exit_node_id`, que é a nossa atribuição. São fatos diferentes, e o glossário
existe para não deixar que virem o mesmo campo.

Continua valendo o que a DEC-043 diz: com **um** tier não há o que aplicar, e
meio-aplicado parece aplicado. O contador entra no tipo e no schema agora; a
aplicação chega quando existir um segundo tier para diferenciar.

---

### DEC-079 — Admin gere pessoas; owner gere dinheiro

**Data:** 2026-08-11 · **Status:** superseded by DEC-080

**Contexto.** `POST /billing/checkout`, `DELETE /billing/subscription` e
`POST /billing/subscription/resume` traziam só `@UseGuards(AccessTokenGuard)`.
Qualquer autenticado da account — inclusive um `member` recém-criado — podia
cancelar a assinatura da empresa. A DEC-070 previu que `@RequiresRole` chegaria
"com a página de usuários, que é a primeira rota barrada por role e nada mais"; a
palavra que envelheceu foi **primeira**, lida como **única**, e cobrança nasceu
sem portão porque ninguém voltou a fazer a pergunta.

**Decisão.** As três rotas que movem dinheiro exigem `owner`. `admin` recebe 403
junto com `member`.

`GET /billing/subscription` **continua aberta a qualquer autenticado**. Ela
alimenta a home da conta — endereço, idioma, sair, navegação —, e barrá-la
deixaria o member sem tela inicial. Ele perde os botões, não a página.

**Rationale.** O corte não é por rank, é por assunto: administrar quem tem acesso
e comprometer o cartão da empresa são responsabilidades diferentes, e um `admin`
que pode desligar gente não deveria poder desligar o produto. É exatamente o caso
do `admin` que separa esta decisão de `/users` — sem ele, "owner" seria só um
sinônimo mais caro de "admin".

Rejeitado esconder só os botões: o portão é o servidor, e a tela é conveniência.
Rejeitado também subir o `@UseGuards` para a classe, como faz
`users.controller.ts` — `POST /billing/webhook` é deliberadamente não autenticado,
quem o valida é a assinatura do provider, e um guard de classe exigiria token dele.
Em `billing` os guards ficam **por método**, e isso é a decisão, não o descuido.

Para quem não é owner os controles somem **sem explicação**. Uma mensagem
gastaria chave de i18n — logo, uma release do submodule — para dizer a alguém algo
que ele não pode acionar de qualquer forma.

**Consequências.** `CONTEXT.md` §Autorização deixa de descrever `/users` como a
única rota barrada por role: são **dois portões, com degraus diferentes**. A
distinção que a DEC-070 defende continua intacta — em `/devices` a role é
**escopo**, e nada aqui a retroaplica.

Nasce `authorization.guard.spec.ts`, que lê a fonte de todo `*.controller.ts` sob
`modules/` e exige, para cada rota mutante, um decorator de portão ou uma entrada
numa lista curta de exceções justificadas. Ele também cobra o `@UseGuards`
correspondente: um `@RequiresRole` sem `RoleGuard` alcançável responde **500**, não 403. Este furo existiu porque a checagem era memória de quem revisa; ela passa a
ser teste, na mesma forma da asserção "toda tabela de domínio está sob RLS" do
`check.sh`.

Quando a DEC-080 trocar rank por permissão, `@RequiresRole('owner')` aqui vira
`@RequiresPermission('billing.manage')` e esta decisão fica superada — mas o furo
não podia esperar por ela.

---

### DEC-080 — Permissão é dado do tenant e desce até a pessoa; rank sai de cena

**Data:** 2026-08-11 · **Status:** accepted

**Contexto.** A DEC-079 fechou um furo real com a ferramenta que existia, e ao
fazê-lo deixou o problema à mostra: dois portões — `admin` em `/users`, `owner` em
cobrança — cuja diferença é o **assunto**, não a força. `hasAtLeastRole` responde
"quem é mais forte"; a pergunta do produto é "**esta empresa** deixa **esta
pessoa** fazer isto". Não existe ordenação em que "member gera chave, admin não
gere cobrança" caiba, e num produto whitelabel a resposta muda por cliente — o que
rank não sabe expressar de jeito nenhum, porque rank é código e a resposta é dado.

**Decisão.** Uma **permissão** nomeada por rota mutante, conjunto **fechado** em
`@vpn/contracts`, aplicada por `@RequiresPermission` + `PermissionGuard` (403).
`@RequiresRole` e `RoleGuard` **saem**. Resolução em três camadas:

1. `DEFAULT_ROLE_PERMISSIONS[role]` — mapa em código, versionado como `ENTITLEMENTS`.
2. `role_permissions` — delta por account.
3. `user_permissions` — delta por pessoa, por cima do resultado.

**Rationale.** Delta nas duas camadas, e não substituição, por duas razões que só
aparecem quando se tenta escrever o caso motivador. O conjunto **vazio** precisa
ser expressável: "aqui member não gera a própria chave" é exatamente ele, já que
`devices.create` é todo o padrão de member — e por substituição o vazio seria zero
linhas, indistinguível de "nunca customizou". E uma permissão acrescentada ao mapa
depois tem que alcançar quem já customizou; por substituição, o tenant que mexeu na
role uma vez nunca mais receberia nada. As duas tabelas ficam com a mesma forma
porque são a mesma ideia em alturas diferentes.

`permission` é `text` e não `pgEnum`: o conjunto fechado mora no pacote (DEC-036) e
um enum no banco custaria uma migração por permissão. A integridade é
`permissionSchema` na escrita e o resolver ignorando o desconhecido na leitura, o
que faz renomear uma permissão degradar em vez de derrubar a account que a tinha.

Os **nomes** seguem o vocabulário do domínio, não o da UI: `users.*` e não
`members.*`, porque `member` já é uma role e a colisão leria como "criar members";
`devices.*` e não `keys.*`, porque o contrato é compartilhado com API, web e
clientes nativos, e ali a palavra é device desde a DEC-070.

**As roles continuam sendo o enum** `owner|admin|member`. O que virou dado é a
permissão. Isso mantém intactos os dois índices parciais de owner em `users`, o
claim `rol` e o `hasAtLeastRole` que a DEC-070 usa para **escopo** — e deixa o
schema aditivo para roles por tenant, se o dia chegar: `role` vira FK sem tocar em
`role_permissions`.

**Consequências.** `permissions.manage` existe porque a tela que edita concessões
precisa de portão, e editar o que uma role pode é mais poderoso que trocar a role
de alguém. Com ela vem uma invariante: **o owner sempre a tem, no resolver, sem
consultar linha**. A alternativa era recusar a escrita que deixaria a account sem
ninguém — um `if (sobrou alguém)` que duas edições concorrentes furam, exatamente o
que o inegociável nº 3 proíbe.

`PermissionService` cacheia as **concessões cruas da account**, não o conjunto
resolvido de cada pessoa: uma entrada por account faz editar uma role invalidar
todo mundo com um `delete` só. Mesma razão pela qual o cache de entitlement guarda
o tier e não os entitlements (DEC-054). E ele ramifica em `hasScope()`, porque
guard roda antes do interceptor (DEC-055).

Em `/devices` os dois guards convivem, nesta ordem: `CapabilityGuard` antes de
`PermissionGuard`, para que **402 venha antes de 403** — o que a empresa não
comprou é uma resposta diferente do que a pessoa não pode.

A web lê `GET /permissions` por requisição, nunca do token: a role muda por ação
nossa e a rotação de família a propaga, mas tirar uma concessão não dispara rotação
nenhuma, e um JWT de 15 minutos serviria permissão revogada por esse tempo
(DEC-037). `useHasPermission` mora em `app/access/`, não numa feature, pelo mesmo
argumento que pôs `logout` em `app/store/`: três features precisam dele.

A resposta de concessões carrega o e-mail de cada pessoa. Sem isso a tela de
permissões teria de ler a API de usuários, e feature não importa feature — o lint
de fronteira recusa, e estava certo.

---

### DEC-081 — O dono não é editável, e as telas de assinante exigem assinatura

**Data:** 2026-08-12 · **Status:** accepted

**Contexto.** Duas coisas apareceram quando a tela da DEC-080 ficou de pé.

A tela desenhava as três roles, e a do `owner` vinha com tudo marcado e **um**
checkbox desabilitado. O resto parecia editável e não era: a DEC-080 já dava ao
dono um piso de `permissions.manage`, mas nada impedia de tirar `billing.manage`
dele — e um dono sem `billing.manage` é uma account que ninguém pode mais cobrar.

E `/users` e `/permissions` atendiam conta que nunca pagou. Só `/devices`
respondia 402. Dava para abrir a lista de usuários, criar gente e editar
concessões sem assinatura nenhuma.

**Decisão.** Duas, e elas não se misturam.

**O `owner` tem todas as permissões, sempre.** `effectivePermissions` curto-circuita
nele e as duas camadas de delta não o alcançam. `PUT /permissions/roles/owner` e o
`PUT` por pessoa contra o dono respondem **403**, e `GET /permissions/grants` não
descreve mais a role dele — a tela mostra duas, não três.

**`/devices`, `/users` e `/permissions` exigem tier.** Entra
`@RequiresSubscription()` + `SubscriptionGuard`, **402** quando `tier === null`,
rodando antes do `PermissionGuard`. Na web as três somem do nav e as rotas
redirecionam para a home.

**Rationale.** Um piso com exceções é a formulação errada de "não se mexe nisto":
ele convida a mexer e recusa só na última linha. Invariante é mais barata de
entender e mais barata de provar — a tela não precisa saber quais permissões do
dono são intocáveis, porque nenhuma é editável, e por isso a linha some em vez de
ficar cinza. É a mesma escolha que a DEC-079 fez com `PlanActions`: o controle
some, não fica desabilitado.

Rejeitado reusar `@RequiresCapability('vpn_access')` como marcador de "assinou".
Ele hoje coincide com isso porque só existe um tier, mas administrar usuários não é
acesso à VPN, e no dia em que existir um tier sem `vpn_access` a página de usuários
quebraria por um motivo que ninguém conseguiria ler no código. O guard novo diz o
que a regra é.

`GET /permissions` e `GET /billing/subscription` continuam abertas, e é deliberado:
uma alimenta o nav, a outra é onde se assina. Barrar as duas trancaria a conta fora
da própria porta de entrada.

**Consequências.** `authorization.guard.spec.ts` passa a separar duas listas.
`@RequiresSubscription` **não** conta como portão para a asserção "toda rota mutante
pergunta quem está chamando" — ele responde o que a empresa contratou, e aceitá-lo
ali deixaria uma rota mutante passar sem nunca perguntar quem chama. Ele entra só na
asserção de fiação, que cobra o `@UseGuards` correspondente.

Em `UsersController` o decorator está na **classe**, não em cada método: as quatro
rotas precisam dele, e uma rota nova ali passa a nascer fechada. Em
`PermissionsController` fica por método, porque `GET /permissions` tem de continuar
aberta.

A web ganha `GET /entitlements` — que existia no servidor e ninguém consumia —, o
hook `useSubscriptionStatus` e o wrapper `RequireSubscription`. O hook tem três
estados e não dois: enquanto a resposta não voltou ele diz `unknown`, e o wrapper
espera. Com booleano, "ainda não sei" e "não assinou" seriam o mesmo valor, e uma
conta pagante seria expulsa da própria página no primeiro render — o mesmo defeito
que o `auth-slice` evita com `unknown`.

---

### DEC-082 — Quem alarga o escopo é a permissão, e o controle que não serve some

**Data:** 2026-08-12 · **Status:** accepted · **Supersedes:** DEC-070

**Contexto.** Duas coisas, e elas se encontraram no mesmo lugar.

A DEC-080 tirou rank de cena em toda parte, menos numa: `scopeFor` em
`devices.service.ts` continuava perguntando `hasAtLeastRole(claims.role, 'admin')`
para decidir se a listagem é da conta inteira ou só do que a pessoa possui. Era o
**último** chamador de `roles.ts`. E a pergunta que ele responde é exatamente a
que a DEC-080 disse que rank não sabe responder: "esta empresa deixa esta pessoa
ver a chave dos outros?" não é uma questão de quem é mais forte.

A outra é que a tela nunca acompanhou. A camada existia — `GET /permissions`,
`useHasPermission`, `RequireSubscription` — e tinha **três** chamadores em toda a
`apps/web`. Quem tinha só `users.read` via o formulário de criar usuário, o botão
de trocar papel e o de remover; quem não podia gerir cobrança via a seção de
assinatura inteira, sem os botões. A DEC-081 já tinha nomeado o defeito e
corrigido metade dos lugares.

**Decisão.** Três, e elas se sustentam juntas.

**O alcance em `/devices` é permissão.** `devices.readAll` alarga a listagem,
`devices.revokeAll` alarga a revogação, e `scopeFor` vira uma consulta ao
`PermissionService`. `roles.ts` e `hasAtLeastRole` são **deletados**.

**Atribuir uma chave é `devices.assign`.** `createDeviceRequestSchema` ganha um
`userId` opcional; ausente significa "para mim". A rota mantém
`@RequiresPermission('devices.create')` e o serviço recusa com 403 quando o alvo
difere de quem chama e falta `devices.assign`.

**A tela mostra o que a concessão permite fazer.** Toda rota da área logada nasce
atrás de `RequirePermission`, todo controle mutante atrás de `useHasPermission`, e
a tela que sobraria vazia some do nav.

**Rationale.** Duas permissões de alcance e não uma porque ler e cortar são
poderes diferentes — `devices.readAll` serve quem audita, `devices.revokeAll`
derruba o túnel de alguém no meio do expediente —, e o conjunto fechado é barato:
o que custa é descobrir depois que a única permissão que existe é grossa demais
para o cliente que reclamou.

`devices.assign` separada de `devices.create` porque **a chave privada nasce no
navegador de quem preenche o formulário**. Bundlada, o padrão de `member` — que é
`devices.create` sozinho — daria a qualquer um acesso à VPN gravado no nome de um
colega e descontado do `devicesPerUser` dele. É um caminho de escalada com
aparência de conveniência.

O padrão de `admin` recebe as três novas, então **nenhuma account muda de
comportamento**: o que `hasAtLeastRole(role, 'admin')` concedia é exatamente o que
`DEFAULT_ROLE_PERMISSIONS.admin` passa a conceder. A migração é de mecanismo, não
de política.

`GET /devices` e `DELETE /devices/:id` continuam **sem portão**, e isso é o
coração da DEC-070 sobrevivendo à sua própria superação: a permissão ali é filtro,
não recusa. Quem não tem `devices.readAll` vê as próprias chaves em vez de levar 403. Por isso `authorization.guard.spec.ts` continua sem cobrar decorator nessas
duas — e por isso `DELETE` sem `devices.revokeAll` responde **404**: o `UPDATE`
não casa, e dizer 403 confirmaria que o id existe.

Rejeitado esconder `/keys` só de quem não pode criar. A pergunta certa é "esta
pessoa tem alguma razão para abrir esta tela?", e ela tem quatro respostas
possíveis — daí `DEVICE_PERMISSIONS` em `@vpn/contracts`, com um teste que cobra
que todo `devices.*` do conjunto fechado está lá. `components/` não pode importar
de `features/`, então a lista não podia morar na feature de chaves; e no contrato
ela fica ao lado da fonte que a define.

**Consequências.** `RequirePermission` precisa de um hook de **três** estados
(`usePermissionStatus`), não do `useHasPermission` existente. `useHasPermission` é
fail-closed — devolve `false` enquanto a resposta não voltou —, o que é correto
para esconder um botão e errado para redirecionar uma rota: quem pode seria
expulso da própria página no primeiro render. É o mesmo defeito que a DEC-081
evitou em `useSubscriptionStatus`, aparecendo pela terceira vez.

`GET /devices/assignees` existe em vez de a tela de chaves ler `GET /users`.
Feature não importa feature, o lint de fronteira recusa, e é a mesma razão pela
qual a resposta de concessões carrega o e-mail de cada pessoa (DEC-080). Ela pede
`devices.assign`, não `users.read`: quem atribui não precisa administrar gente.

A seção de assinatura some para quem não tem `billing.manage`, mas
`PlanEntitlements` fica. O que a empresa contratou é informação de quem usa o
produto; o estado da cobrança, de quem paga por ele.

O seletor de papel deixa de ser o único `<select>` nativo do app e passa ao mesmo
primitivo do seletor de idioma. Na lista de membros, o link que alternava
`admin ↔ member` sem mostrar o valor corrente vira o mesmo `Select` — um controle
que não diz em que estado está não é mais barato, é só mais quieto.

---

### DEC-083 — A fatura é projeção, e o PDF é nosso

**Data:** 2026-08-12 · **Status:** accepted

**Contexto.** Quem paga não tinha como ver o que já pagou. A tela de conta mostra
o estado de agora e nada do que veio antes, e a única testemunha do histórico era
o painel do provider — que nem todo mundo que precisa da informação acessa, e que
some no dia em que trocarmos de provider.

**Decisão.** Uma tabela `invoices`, projetada pelo webhook, atrás de
`billing.manage`. O PDF é buscado por um job do worker e arquivado em
`IObjectStorage` na **chegada do evento**, e servido **pela nossa API**.

**Rationale.** Projeção e não leitura ao vivo pela mesma razão que
`subscriptions` é projeção: uma tela que consulta o provider em tempo de request
herda a latência e a disponibilidade dele, e perde a história inteira numa troca.
A tabela acumula em vez de sobrescrever porque histórico é o produto aqui.

Arquivar na chegada e não no primeiro download é o ponto da feature. A URL do
provider expira, e a fatura que ninguém abriu antes da troca de provider é
justamente a que se perderia — a que ninguém abriu é a que mais precisa do
arquivo, porque ninguém vai notar que sumiu.

**O evento do provider continua virando exatamente um `NormalizedBillingEvent`.**
`invoice.payment_failed` já existia como `payment_failed` e move o e-mail de
dunning; ele foi **estendido** com a fatura em vez de ganhar uma variante irmã.
Emitir dois eventos normalizados a partir de um evento do provider colidiria com
o único `(source, external_event_id)` de `billing_events` — o mecanismo de
idempotência recusaria o segundo, e a fatura ou o e-mail se perderia conforme a
ordem. O que entra novo é só `invoice_paid`.

O PDF é streamado pela API e não entregue como URL assinada. `signedUrl` existe na
porta e seria menos trabalho para o servidor, mas um link assinado é credencial ao
portador: vale para qualquer um que o tenha até expirar, fora de qualquer checagem
nossa. Streamar mantém `billing.manage` conferida em toda requisição, que é a
mesma regra da DEC-082 aplicada a um byte em vez de a um botão.

**As duas rotas não pedem `@RequiresSubscription`.** Quem cancelou é exatamente
quem mais precisa dos recibos, e o guard responderia 402 justo para ele. É a mesma
exceção, pelo mesmo tipo de argumento, que já deixa `GET /billing/subscription` de
fora (DEC-081).

**Consequências.** `IObjectStorage` ganha o primeiro consumidor de produto — ele
existia, com suíte e dois adapters, e nenhuma feature o usava. Nada de infra nova:
`STORAGE_DRIVER=s3` já aponta para o localstack e o bucket já nasce no `ready.d`.

A suíte de conformidade de billing **não** roda contra o Stripe (DEC-060): ela
abre por `createCheckout`, que o localstripe não tem. As asserções novas cobrem o
fake, e o lado Stripe é fixado à mão nas fixtures de `invoice.paid` — nas duas
versões de API, acacia e dahlia, porque a metadata da subscription mudou de lugar
(DEC-057).

Backfill do que aconteceu antes de ouvirmos fica **de fora**, deliberadamente. A
história começa quando começamos a ouvir; a tabela comporta o passado, e puxá-lo é
trabalho próprio com o seu próprio custo de paginação e limite do provider.

---

### DEC-084 — Quem conta a janela é o balde, e ele responde quanto falta

**Data:** 2026-08-13 · **Status:** accepted · **Supera:** a limitação registrada na DEC-029

**Contexto.** Quatro dívidas do mesmo mecanismo. A chave do limite era o e-mail,
então quem trouxesse uma lista de endereços não era limitado por nada. O mesmo
e-mail em duas empresas dividia um balde, e martelar o login de uma trancava a
pessoa da outra. Nenhum 429 dizia quanto esperar. E a copy dizia "alguns
minutos" enquanto três das quatro regras tinham janela de uma hora.

A DEC-029 registrou que o `Retry-After` **não era obtível sem mudar a porta**,
porque `ICacheStore.increment` devolvia a contagem e não o TTL. Era verdade, e é
por isso que as quatro andam juntas: as outras três dependem dessa mudança.

**Decisão.** `increment` passa a devolver `{ count, ttlSeconds }`. O limitador
consome **dois** baldes por tentativa — um por sujeito, escopado pelo tenant, e
um por endereço de origem, com teto próprio e mais alto — e a recusa carrega o
que sobrou da janela, no header e no corpo.

**Rationale.** Dois baldes e não um porque as duas ameaças são diferentes: o
balde do sujeito defende **um** endereço de ser martelado, e o do IP defende o
sistema de quem traz uma lista. Um só nunca cobre as duas — limitar apenas por IP
tranca um escritório inteiro atrás de um NAT, e limitar apenas por e-mail é o
furo que esta dívida nomeia.

**Os dois são consumidos antes de qualquer um ser julgado.** Lançar no primeiro
que estoura deixaria o contador de IP parado: quem martela um endereço sozinho
trancaria o balde dele, e o contador que de fato o observa nunca avançaria.

O tenant vem do que a requisição **já traz** — o slug que o login enviou, ou o
primeiro rótulo do host — e nunca de uma consulta. Resolver a account antes de
limitar poria uma query na frente do throttle, que é exatamente o que a DEC-050
recusou e o que um ataque de volume passaria a exercitar.

O TTL é lido no **mesmo** round trip que escreve o contador: `INCR`, `EXPIRE NX`
e `TTL` num `MULTI`. Perguntar depois seria uma segunda chamada contra um
contador que outro chamador já pode ter rolado.

A copy do catálogo **não pode** nomear uma janela, porque as quatro regras têm
duas. `errors.RATE_LIMITED` passa a dizer "mais tarde", sem mentir, e a tela usa
`common.retryInMinutes` quando o servidor disse quanto — arredondado para cima,
porque mandar esperar zero convida a repetir a tentativa que acabou de ser
recusada.

**Consequências.** `app.set('trust proxy', 1)`: atrás de um balanceador toda
requisição chega do mesmo endereço, e um limite por IP juntaria a internet
inteira num balde. Um salto e não a cadeia toda — confiar na cadeia deixa o
chamador forjar o header e escolher o próprio balde.

O e2e passou a limpar os contadores no `beforeEach`, do mesmo jeito que limpa as
tabelas: um limite por endereço de origem é estado compartilhado, e a suíte
inteira chega de loopback. `MemoryCacheStore` ganhou `clear()`, que é método do
**fake** e não da porta — a mesma categoria dos `seed*` do
`MemoryBillingProvider`.

---

### DEC-085 — Uma janela no cache é o que faz duas cópias do worker não varrerem juntas

**Data:** 2026-08-13 · **Status:** accepted

**Contexto.** O `PeerReconciler` decidia se estava na hora por um campo de
instância. Isso só limita o processo que o carrega: dois workers varreriam o
mesmo nó em paralelo. E não havia varredura nenhuma para duas coisas que
precisavam de uma: a assinatura, cuja projeção congela quando um webhook se
perde, e as tabelas que crescem para sempre.

**Decisão.** A janela vira um contador no cache: quem o leva de 0 a 1 é dono
dela, e o TTL a rearma. Três varreduras usam a mesma forma — peers (5 min),
assinaturas (15 min) e expurgo (1 h).

**Rationale.** O contador **é** a reivindicação; não há `SELECT` antes dele. Uma
linha travada no banco resolveria igual e custaria uma transação por turno de
laço, num laço que roda a cada 500 ms.

`SubscriptionReconciler` só invalida o cache de entitlement quando o provider
**discorda** da projeção, e nunca apaga uma linha por não achar a assinatura lá:
uma consulta que falhou não é motivo para revogar o acesso de quem paga. Ele
escreve com o instante corrente e não com um carimbo do provider, porque é a
leitura mais fresca que existe — a guarda monotônica do upsert tem que deixá-la
vencer o que o último webhook escreveu.

O expurgo deixa **um dia** de folga atrás do corte. Nada no código lê esse dia;
quem lê é quem abre um incidente de manhã.

**Consequências.** Um peer recusado pelo nó deixou de abortar a varredura: cada
chamada é isolada, o relatório ganhou `failed`, e ninguém é carimbado como
provisionado sem que o `wg set` dele tenha acontecido. Antes disso o relatório
afirmava um total que não havia alcançado.

---

### DEC-086 — O teto de dispositivos da account é um índice, não uma contagem

**Data:** 2026-08-13 · **Status:** accepted

**Contexto.** Os 251 endereços de um `/24` são **globais** (DEC-069), então uma
account podia consumir a faixa inteira e as vizinhas paravam de conseguir criar
chave. `seats` e `devicesPerUser` estavam anunciados no tier e aplicados em lugar
nenhum.

**Decisão.** `devices` ganha `account_slot` e um índice único parcial em
`(account_id, account_slot) where revoked_at is null`. O serviço lê as vagas
ocupadas como **dica**, tenta a mais baixa livre, e quem recusa é o índice.
Estourar o teto responde `QUOTA_EXCEEDED` (402).

**Rationale.** Um `count()` seguido de `INSERT` é o `if (jáVimos)` que o
inegociável nº 3 proíbe: duas requisições concorrentes leem a mesma contagem e
passam juntas. Um trigger que conta no `BEFORE INSERT` tem o mesmo defeito sob
`READ COMMITTED`. A restrição é a única coisa que duas transações não atravessam
— é o mesmo desenho do endereço de túnel, que já vive de dica mais índice.

Esgotar a faixa **não** é motivo para tentar a próxima vaga: o range é
compartilhado, então estaria vazio para ela também. Por isso o laço distingue os
dois desfechos, e só a perda de corrida avança a vaga.

`QUOTA_EXCEEDED` é código próprio e não `PAYMENT_REQUIRED`: a empresa pagou, e
"é necessário ter uma assinatura ativa" seria falso na tela. É 402 porque a
dimensão é entitlement — o contador é a espécie de entitlement que se aplica na
escrita (DEC-043).

**Consequências.** Isto **não** levanta o teto global; ele continua sendo da
DEC-077, com a faixa por nó. O que sai de cena é a starvation: um tenant deixa de
poder derrubar os vizinhos. A linha do roadmap foi reescrita nesses termos em vez
de marcada como fechada.

Um downgrade de plano deixa vagas acima do novo teto ocupadas por dispositivos
que já existiam. Eles continuam válidos e o teto passa a valer para o próximo —
revogar chave de quem já conectou não é decisão de código.

---

### DEC-087 — O handler que fala com terceiro abre a própria transação

**Data:** 2026-08-13 · **Status:** accepted

**Contexto.** `BillingService.createCheckout` falava com o Stripe com a
transação da requisição aberta, prendendo uma conexão do pool pela ida e volta
inteira. O roadmap dizia que a alternativa seria um escape hatch que reabre o
buraco da query sem escopo.

**Decisão.** `@SkipTenantTransaction()` na rota, e o serviço abre `runInAccount`
só para ler o owner. A transação fecha, e só então o provider é chamado.

**Rationale.** A leitura continua **dentro** de um escopo, então a policy vale
igual — não é escape hatch, é uma transação mais curta. O que o decorator desliga
é o interceptor, não a RLS.

O escasso é a conexão, não a transação: um checkout que demora dois segundos
contra o provider segurava uma conexão do pool por dois segundos, e o pool é o
que acaba primeiro num pico.

**Consequências.** O decorator é opt-in e por método. Uma rota que o use e leia o
banco **fora** de `runInAccount` levanta `42704` no `current_setting` estrito
(DEC-050) em vez de devolver zero linhas — o erro aparece na hora, que é a razão
de o `current_setting` não ter `missing_ok`.

---

### DEC-088 — O NAT do nó casa por destino, e uma asserção o vê disparar

**Data:** 2026-08-13 · **Status:** accepted

**Contexto.** A regra de MASQUERADE do nó casava por interface
(`-o eth0`), enquanto o `RETURN` do canário casava por destino. O roadmap
registrava isso como risco hipotético: "se a default virasse `eth1`, o egress à
internet pararia de ser mascarado".

Não era hipotético. Neste devstack `eth0` **é** a rede do canário
(`172.30.13.2/24`) e a bridge do projeto é `eth1`. Medido antes da mudança:
três pacotes saídos de `10.13.13.1` para o verdaccio atravessaram o POSTROUTING
e **zero** bateram na regra de MASQUERADE. O egress do túnel para a bridge
estava saindo sem NAT — e é exatamente o caminho que a sonda `200 → 000 → 200`
de `data-plane.md` percorre.

**Decisão.** O MASQUERADE passa a casar por destino:
`-s 10.13.13.0/24 ! -d 10.13.13.0/24 -j MASQUERADE`. E o `check.sh` ganha uma
asserção que **zera o contador, emite tráfego com origem no túnel e exige que a
regra tenha disparado**.

**Rationale.** Nenhum critério baseado no nome da interface é estável: quem
decide qual nome cada rede recebe é o Docker, e a ordem de `networks` no compose
não é promessa. Destino é a única coisa que o operador controla.

A negação do próprio CIDR do túnel, e não um `-j MASQUERADE` sem qualificador:
sem ela, tráfego entre dois devices da mesma rede sairia mascarado e cada um
veria o endereço do nó no lugar do endereço do outro. É o mesmo defeito que o
`RETURN` do canário existe para evitar, com outro sujeito — e ele deixa de ser
teórico assim que a frota tiver mais de um peer por nó.

A asserção nova não substitui a de ordem, e é por isso que são duas. A antiga
afirma o **texto** das regras e a adjacência delas; foi ela que sobreviveu verde
o tempo todo enquanto o NAT não acontecia. Uma regra afirmada só textualmente é
uma regra que ninguém viu funcionar.

O destino da sonda é outro contêiner **pelo nome**, não um endereço: o IP da
bridge muda a cada `reset` e um endereço fixo transformaria a asserção numa
armadilha de manutenção. Ela não espera resposta — o NAT acontece na ida —,
então o que ela afere é o contador, nunca alcançabilidade.

**Consequências.** `make check` passa de 19 para 20 asserções.

A sonda zera os contadores de `POSTROUTING` ao rodar. É um smoke check de
devstack, e nada lê esses contadores para decidir coisa alguma; num nó real, a
mesma asserção precisaria ler o delta em vez de zerar.

O nó continua sem regra de egress específica por interface, o que significa que
um nó real com uma interface de gerência separada mascararia tráfego por ela
também. Isso é trabalho da stack `network` e do nó real, onde a fronteira é
firewall e não `wg-quick`.

---

### DEC-089 — O plano de controle é copiado para dentro no boot, não servido do mount

**Data:** 2026-08-13 · **Status:** accepted

**Contexto.** `control/` entrava na imagem por `COPY`, então um
`docker compose restart wireguard` continuava servindo o script velho e só um
`build` publicava a alteração. O sintoma é a suíte de conformidade do
`HttpExitNode` vermelha **contra um adapter correto** — o pior tipo de vermelho,
porque aponta para o lugar errado.

**Decisão.** O compose monta `control/` em `/srv/control-src`, e o `entrypoint.sh`
copia para `/srv/control` e faz `chmod +x` do lado de dentro antes de subir o
`httpd`. A imagem continua trazendo `/srv/control` por `COPY`.

**Rationale.** Copiar em vez de servir o mount direto é o ponto inteiro, e a
razão é o bit de execução. Os CGI são `100644` no git; um mount servido
diretamente responde 500 em qualquer host que honre esse modo. Medido: neste
Windows o Docker Desktop apresenta os mesmos arquivos como `rwxrwxrwx`, então o
mount ingênuo **funcionaria aqui** e quebraria para um colega no Linux. Um
conserto que só é verde na máquina de quem o escreveu não é conserto, é a
armadilha seguinte — que é exatamente o que esta decisão foi encarregada de não
fazer.

A diferença entre dev e produção é a **presença do mount**, não uma variável no
compose. Um nó real não tem repositório para montar, `/srv/control-src` não
existe lá, e o bloco inteiro vira no-op sem ninguém precisar lembrar de desligar
nada. Uma variável seria uma segunda coisa a errar, e erraria em silêncio.

**Consequências.** Editar um CGI vale com `restart`, nunca com `build`. Não vale
sem nada: o `httpd` serve de `/srv/control`, e a cópia acontece no boot. Servir
o mount direto e resolver o modo de outro jeito — `httpd.conf` mapeando
interpretador por extensão — exigiria renomear os CGI para `*.sh`, e o nome
deles é a URL que `HttpExitNode`, `check.sh` e a spec citam.

Um `build` continua sendo necessário para `entrypoint.sh`, `healthcheck.sh` e o
`Dockerfile`, que não são montados. É a fronteira certa: são o contrato do
contêiner, não o conteúdo que se itera.

---

### DEC-090 — A frota é da plataforma, e não existe CRUD de servidor nem de região

**Data:** 2026-08-14 · **Status:** accepted · **Supersedes:** DEC-077

**Contexto.** Existe **um** nó e ele vem de variável de ambiente. O brief pede
gerenciamento de servidores e regiões, e uma frota não cabe num `.env`: ela muda
em runtime e precisa de dono.

O dono somos **nós**. Os servidores de saída são máquinas que a plataforma opera
e cuja banda a plataforma paga; quem gera uma chave escolhe entre os que já
existem. A leitura oposta — o nó como máquina do cliente, registrada por ele numa
tela — foi considerada e recusada: ela transforma o produto em outro, obriga cada
account a cadastrar as mesmas máquinas, e põe uma URL fornecida pelo cliente no
caminho de uma requisição nossa, que é SSRF por construção.

**Decisão.** `regions` e `exit_nodes` são tabelas **sem `account_id` e sem
policy**. Não há rota que crie, altere ou remova qualquer das duas, não há
`GET /exit-nodes`, e o catálogo de permissões não nomeia servidor. Existe **uma**
rota: `GET /regions`, que alimenta o seletor do formulário de chave e responde
nome e disponibilidade — nunca endereço, url de controle ou contagem de máquinas.

**Rationale.** Uma tabela que não pende de account não tem o que uma policy
isole. Mas **não ter policy não é o mesmo que não ter escrita**: o
`ALTER DEFAULT PRIVILEGES` de `01-roles.sql` concede `SELECT, INSERT, UPDATE,
DELETE` a `vpn_app` em toda tabela criada pelo migrator, e enquanto havia policy
era o `WITH CHECK` dela que segurava a escrita. Por isso a migration faz
`REVOKE INSERT, UPDATE, DELETE ON regions, exit_nodes FROM vpn_app`, e o teste de
isolamento afirma o `42501`. É esse `REVOKE` que faz "tabela da plataforma" ser
um fato verificável e não uma convenção de nomenclatura.

O papel do tenant continua lendo `credential_ref`, porque ele viaja na linha que
o provisionamento carrega. Não é vazamento: a referência é o **nome** de onde o
segredo mora, e resolvê-la exige alcançar o Secrets Manager — o que acontece pelo
`ISecretStore`, fora da transação do tenant. O valor nunca passa por uma conexão
de tenant.

Não é devida migration de limpeza para `role_permissions` e `user_permissions`
que guardem `servers.*`: `effectivePermissions` faz `safeParse` de cada linha e
ignora o que o catálogo não publica mais, então uma concessão órfã é inerte.

**Consequências.** As duas viram as **únicas** tabelas de domínio fora do RLS, e
os dois portões que cobravam a regra em bloco — `check.sh` e
`rls.integration.spec.ts` — passam a afirmar o conjunto exato
(`exit_nodes,regions`) em vez de contar zero. Igualdade de conjunto é mais forte
que exclusão: falha se aparecer uma terceira tabela sem RLS, e falha também se
alguém ligar RLS numa destas duas.

O `.conf` continua nomeando um nó específico, e um device continua preso ao nó que
lhe foi atribuído — se ele sair do ar o `.conf` é reemitido, não reapontado. O
que muda é quem conserta: era o cliente, agora somos nós.

**Sobre o próprio arco.** As decisões DEC-090 a DEC-098 anteriores descreviam a
frota do tenant, e foram reescritas junto com o código que as implementava: se
aquele arco não aconteceu, não há o que superar. As que sobrevivem intactas
mantiveram o número, para que `superseded by DEC-095` e `superseded by DEC-098`
continuem apontando para algo.

Os commits são narrativa, não estados independentes: o teto de endereços, o
repositório, a atribuição e o adapter mudam juntos, e separá-los em commits
verdes exigiria fundir cinco num só. O que é verificado é a **ponta** — `verify`,
integração, e2e duas vezes sem resetar o banco, e `make check` 53/53 —, e é assim
que este arco deve ser lido.

---

### DEC-091 — O lugar de um device é um par que o banco cobra, e remover um nó solta quem já foi revogado

**Data:** 2026-08-14 · **Status:** accepted

**Contexto.** Um device carrega duas coisas que não podem colapsar numa só: a
**região**, que é a escolha da pessoa, e o **exit node**, que é a nossa
atribuição. Nada impedia que as duas discordassem — uma linha podia dizer
"Frankfurt" e apontar para uma máquina de São Paulo.

**Decisão.** `devices` referencia `exit_nodes` por um par:
`(exit_node_id, region_id) → exit_nodes(id, region_id)`, com
`ON DELETE SET NULL ("exit_node_id")`. A coluna `region_id` tem FK própria para
`regions(id)` com `RESTRICT`.

**Rationale.** O par é a única coisa que recusa um device cujo lugar não fecha. Um
`FK` só em `exit_node_id` aceitaria a discordância, e checar em código não
sobrevive a dois processos concorrentes.

A lista de colunas no `SET NULL` é escrita à mão porque o drizzle-kit não a
modela. Sem ela o PostgreSQL anula **as duas** colunas do par, e anular
`region_id` apaga a escolha da pessoa — que é justamente o que precisa sobreviver
quando uma máquina é aposentada. A faixa de endereços é por nó, então o índice
vivo é `(exit_node_id, tunnel_address)`.

O `SET NULL` só dispara para device já revogado: um trigger recusa apagar um nó
que ainda tem chave viva nele, e a mensagem diz qual é o caminho de saída.

**Consequências.** `region_id` e `exit_node_id` são anuláveis, o que só existe
para o `SET NULL` poder disparar. Um `CHECK` cobra o que a anulabilidade abriu:
device vivo tem os dois preenchidos.

---

### DEC-092 — `live_tunnel_addresses` some, e a dica de endereço vira função da própria faixa

**Data:** 2026-08-14 · **Status:** accepted

**Contexto.** A DEC-069 criou a view `live_tunnel_addresses` para escolher por
onde a busca de endereço começa, num tempo em que a faixa era global. Com a faixa
por nó, a view perdeu o assunto — e o `GRANT` escrito à mão que ela obrigava era
uma armadilha registrada.

**Decisão.** A view é apagada. No lugar dela, uma função
`live_addresses_on(node uuid) RETURNS SETOF text`, `SECURITY DEFINER`, com
`EXECUTE` concedido a `vpn_app`.

**Rationale.** A view sozinha não bastava e a ausência dela também não. Um nó da
plataforma atende várias accounts, e `takenAddresses` roda dentro da transação do
tenant: sob a policy de `devices` ele enxerga só os devices **daquela** account,
enquanto o índice único é global. Enquanto o nó pertencia a uma account só, os
dois concordavam; agora a dica subcontaria, e a alocação degradaria para um
`INSERT` recusado por endereço já ocupado, a partir do `.4`, dentro da requisição.

A função devolve os endereços vivos daquele nó e **nada** sobre quem os possui —
nem `account_id`, nem `user_id`, nem a chave pública. É o mínimo que faz a dica
voltar a ser dica, sem reabrir leitura entre tenants sobre quem está onde.

`SECURITY DEFINER` e não uma view justamente porque o privilégio fica no corpo da
função, com um argumento obrigatório: não existe "selecionar tudo" a partir dela.

**Consequências.** A capacidade real passa a ser **251 devices vivos por nó,
somando todas as accounts**. Com `seats 25 × devicesPerUser 5 = 125`, duas
accounts cheias enchem uma região. Está registrado como limitação em
`docs/specs/servers-and-regions.md`, e o caminho de saída é mais de um nó por
região — que o schema já comporta e o devstack ainda não demonstra.

---

### DEC-093 — O endpoint de um nó é validado por estrutura, e IPv6 entra entre colchetes

**Data:** 2026-08-13 · **Status:** accepted

**Contexto.** `exitNodeEndpointSchema` era `/^[A-Za-z0-9.-]+:\d{1,5}$/` mais uma
checagem de faixa de porta. Uma classe de caracteres não sabe o que é um host:
`...:80`, `.:1`, `-:1` e `999.999.999.999:80` passavam todos. O último é o
interessante — quatro rótulos numéricos são um hostname perfeitamente comum
para qualquer regra que não distinga hostname de endereço.

E ela **recusava IPv6**. `[2001:db8::1]:51820` é endpoint legítimo de WireGuard,
e um nó alcançável só por IPv6 era impossível de registrar.

**Decisão.** O endpoint é partido em host e porta e cada metade é validada pelo
que ela é: IPv6 entre colchetes, senão IPv4 ou hostname. `exitNodeSchema.endpoint`
passa a reusar o schema estrito, como `label` já fazia.

**Rationale.** Partir em vez de uma regex só porque uma regex que cobrisse IPv6,
IPv4 e hostname de uma vez seria ilegível e — o que importa mais — impossível de
ler para conferir. A validação de IP sai do zod, que já a tem, em vez de virar a
décima variação caseira de um regex de IPv6 no mundo.

Os colchetes não são cosmética: sem eles o último `:` de `2001:db8::1:51820`
pertence ao endereço e não há porta para encontrar. É por isso que a forma sem
colchetes é recusada em vez de tolerada — não existe leitura correta dela.

A regra do último rótulo não poder ser todo dígito é o que fecha o
`999.999.999.999`: ele falha como IPv4 nos octetos, e falha como hostname
porque um TLD numérico não resolve em lugar nenhum.

A resposta reusando o schema do request é a mesma razão da DEC-090 sobre o par
região/nó: dois lugares descrevendo a mesma coisa com regras diferentes acabam
discordando, e o lado que discorda em silêncio é o que não tem teste.

**Consequências.** Um nó registrado antes desta versão com um endpoint que a
regra nova recusa continua na tabela — a validação é de entrada, e nada revalida
linha existente. No devstack não há nenhum; num ambiente que tenha, o sintoma é
um `.conf` que já não fechava handshake.

`@vpn/contracts` vai a **0.20.0**. É mudança de comportamento de validação, não
de tipo: quem já mandava um endpoint válido não vê diferença.

---

### DEC-094 — A varredura e o provisionamento são por nó, e silêncio não é lista vazia

**Data:** 2026-08-13 · **Status:** accepted

**Contexto.** `PeerReconciler` e `DeviceProvisioner` ainda injetavam o `EXIT_NODE`
único do container e liam `EXIT_NODE_TUNNEL_CIDR` do ambiente. Com `exit_nodes`
sendo tabela (DEC-090), isso significa que toda a frota era varrida contra **um**
nó: os peers de um nó eram comparados com os devices vivos de **todos** eles, e
qualquer device atribuído a outra máquina aparecia como peer faltando.

**Decisão.** O laço externo passa a ser `fleet.listAllNodes()`. Cada nó é
comparado só com os devices atribuídos a ele, dentro da faixa da **linha** dele.
Um nó que não responde ao `listPeers()` é pulado inteiro, e o relatório ganha
`unreachable`.

**Rationale.** Pular o nó em vez de tratar a lista como vazia é a decisão que
mais importa aqui, e a spec já a pedia em voz alta: uma exceção lida como
"nenhum peer" faz a varredura concluir que **tudo** naquela máquina é órfão. O
resultado seria revogar todos os peers de um nó que só estava inalcançável — a
varredura destruindo exatamente o que ela existe para conservar.

`unreachable` é campo separado de `failed` porque as duas coisas se contam em
unidades diferentes: `failed` conta peers que o nó recusou, e de um nó calado não
sabemos nem quantos peers seriam. Somar os dois num número só produziria um
relatório que ninguém consegue interpretar.

A faixa vem de `row.tunnelCidr`, e é isso que faz `isAssignable` decidir o que é
nosso para revogar **naquele** nó. Com o CIDR vindo do ambiente, uma frota com
faixas diferentes teria a varredura ignorando peers legítimos de um nó e adotando
peers semeados à mão em outro.

A intenção `device.revoke` passa a carregar `exitNodeId` junto do `publicKey`. A
linha já está revogada quando a mensagem é entregue, então nada a jusante
consegue descobrir em qual máquina procurar; a alternativa seria pedir a **toda**
a frota que esquecesse a chave, que é um broadcast para um device.

**Consequências.** Uma mensagem `device.revoke` escrita antes desta versão não
tem `exitNodeId` e é recusada pelo parser — vira job desconhecido e termina na
DLQ, como qualquer mensagem que o consumer não entende. É a saída certa: o
alternativo é adivinhar o nó.

A varredura alcança **só nós da frota**. Apagar uma account não leva nó nenhum
junto — a frota é nossa —, mas aposentar uma máquina leva: sem a linha não há
`control_url` para perguntar, e os peers que estavam nela ficam lá. Inventar um
endereço para alcançá-los é o SSRF que a spec recusa. Há um teste e2e afirmando
exatamente isso, para que a limitação seja lida e não descoberta.

---

### DEC-095 — O diretório do nó sai de cena, e quem vê a chave trocar é a varredura de saúde

**Data:** 2026-08-13 · **Status:** accepted · **Supersedes:** DEC-068

**Contexto.** `ExitNodeDirectory` cacheava **um** `describe()` para a instalação
inteira. Ele nasceu quando havia um nó, e a DEC-068 lhe deu prazo e a detecção de
chave trocada. Com a frota em tabela, o que ele cacheia deixou de existir: não há
"a descrição do nó", há uma por linha.

Ele também já não tinha chamador. A montagem do `.conf` passou a sair da linha
(DEC-090), que é a projeção do nó, e não de uma ida à máquina no caminho de uma
lista que precisa renderizar.

**Decisão.** A classe é removida. A detecção de rotação de chave vai para
`NodeHealth`, que já chama `describe()` em cada nó a cada minuto, e compara o que
o nó respondeu com `public_key` da linha.

**Rationale.** A varredura de saúde é o lugar natural: ela já pergunta a cada nó
"você responde?", e a resposta **é** a chave. Detectar rotação ali sai de graça,
vale para a frota inteira, e acontece num laço de fundo em vez de no caminho de
uma requisição.

O prazo de 60 segundos que a DEC-068 introduziu deixa de ser um TTL de memo e
passa a ser o intervalo do healthcheck — o mesmo número, com a mesma
consequência, mas agora é a janela de uma varredura em vez de um cache no
caminho de `GET /devices`.

A linha **não** é corrigida quando a chave diverge, e isso é a DEC-068 inteira
sobrevivendo: adotar a chave nova em silêncio faria a API servir `.conf` que
concordam com a máquina e discordam de todo arquivo já baixado. Reemitir em massa
é decisão de produto, e a spec a mantém fora desta entrega.

**Consequências.** A memoização some, e com ela a garantia de que dez chamadores
concorrentes produziam uma ida ao nó. Não custa nada porque nenhum caminho de
requisição chama `describe()` — o único que chamava era o registro, que fala com
uma máquina que ainda não tem linha e por isso não teria o que memoizar.

O aviso passa a ter `nodeId`. Sem ele, numa frota de cinco, a linha de log dizia
que "o nó" trocou de chave sem dizer qual.

---

### DEC-096 — A leitura de regiões mora ao lado da store, e o seletor tem padrão

**Data:** 2026-08-13 · **Status:** accepted

**Contexto.** A tela de servidores e o formulário de chaves precisam da **mesma**
lista de regiões, e `features/` não importa `features/` — o lint reprova, e a
razão dele é a que vale: duas features acopladas viram uma.

**Decisão.** `GET /regions` mora em `features/keys/api/`, junto de quem o usa. O
seletor começa na primeira região **disponível**, e uma região que não está
respondendo é oferecida desabilitada em vez de escondida.

**Rationale.** O mesmo movimento que o `logout` fez: o que duas features
precisam desce para junto da store que o cacheia, não sobe para uma delas. E é
só a **leitura** que desce — criar e apagar região é gestão de frota, que é
assunto de uma tela só. A tag `Regions` é registrada no `createApi`, então a
mutação de um arquivo invalida a query do outro sem que os dois se conheçam.

O padrão no seletor existe porque um seletor vazio é a razão invisível de um
formulário não fazer nada: a pessoa preenche tudo, clica, e o schema recusa um
`regionId` que ela não sabia que precisava escolher. Ele é **derivado**, não um
efeito — `region || available[0]?.id` renderiza certo na primeira passada, e um
`useEffect` sincronizando estado com dado carregado roda duas vezes em
StrictMode.

Sem região nenhuma, o botão de gerar é **desabilitado** e a tela diz para pedir
a um administrador. É a exceção consciente ao "nada de botão desabilitado" da
DEC-058: lá o botão desabilitado escondia uma ação que existia; aqui não existe
ação nenhuma a oferecer, e a alternativa é um 400 depois do clique.

**Consequências.** A recusa de remover — região com nó, nó com chave viva — é
traduzida na tela em vez de cair no `errors.CONFLICT` genérico, que não diz o
que fazer. É a única ramificação por código de erro nesta página, e ela existe
porque as duas rotas só conflitam de um jeito.

`stubApi` passa a responder `/regions` por rota, ao lado de permissões e
entitlements, pela mesma razão que já estava escrita lá: um teste sobre baixar um
`.conf` não deveria precisar optar por a frota existir.

O contador de regiões continua **não aplicado** (DEC-043, DEC-078), e a tela não
o exibe. Mostrar um teto que ninguém cobra convida a acreditar que ele é cobrado.

---

### DEC-097 — Cinco nós no devstack, e o canário atrás de exatamente um deles

**Data:** 2026-08-13 · **Status:** accepted

**Contexto.** O devstack tinha **um** nó. Com a frota em tabela e a região
escolhida na criação da chave, um nó só torna a escolha indistinguível de um
rótulo: qualquer região que o tenant nomeasse levaria ao mesmo lugar, e a
demonstração inteira ficaria compatível com um sistema que não decide nada.

**Decisão.** Cinco serviços WireGuard, um por região demonstrada, cada um com
`container_name`, par de portas, par de chaves e faixa de túnel próprios. **Só o
`sa`** entra na rede do canário.

**Rationale.** Os quatro atributos são exatamente os que a frota **não** pode
compartilhar, e cada um por um motivo diferente: chave repetida colide em
`exit_nodes_public_key_key`; faixa repetida faria dois nós entregarem
`10.13.13.4` para redes que não se conhecem, que é a propriedade que a DEC-090
levantou o teto para ter; porta repetida não sobe; nome repetido não existe.

Um anchor YAML e cinco cópias curtas, em vez de um template com substituição no
entrypoint: este arquivo é o que alguém copia na direção de um nó real (DEC-062),
e o que difere entre os cinco tem que ser legível como diferença e não como
consequência de uma variável.

O canário atrás de um só é a decisão que carrega a demonstração. A assimetria
não é uma regra que alguém configure — é **ausência de rota**: os outros quatro
não têm endereço em `172.30.13.0/24`, e por isso uma chave criada na região
deles não alcança o recurso privado nem por engano. É a mesma forma de prova da
DEC-075, agora aplicada à escolha de região em vez de ao túnel.

`check.sh` vira laço, e a asserção nova é **negativa**: cada nó que não é o do
canário prova que não tem pé naquela rede. Ela é escrita sobre a causa e não
sobre um ping que falha, porque um ping falha igual quando o canário não está
rodando — e este arquivo precisa ficar verde numa máquina que nunca ouviu falar
do repositório irmão.

**Consequências.** `make check` passa de 20 para **41** asserções. As três de
canário ficam escopadas ao nó dele; as outras quatro por nó rodam cinco vezes.

O serviço `wireguard` foi renomeado para `wireguard-sa`, então o contêiner
antigo fica órfão segurando a porta 21820 — e a falha cairia em quem faz o pull,
não em quem fez a mudança. Por isso `dev.sh up` passa a usar `--remove-orphans`:
o compose é a verdade inteira sobre este projeto, e não há o que preservar que
ele não descreva.

`tunnel:doctor` descobre a frota pelo `docker compose ps` em vez de ter os cinco
escritos dentro dele, e os peers passam a ser listados **por nó**: o mesmo
endereço em dois nós são dois devices, e uma lista achatada chamaria um deles de
estranho.

`.env` e `.env.example` trocam `WIREGUARD_PORT`/`EXIT_NODE_API_PORT` por um par
por região. `EXIT_NODE_*` no singular continua apontando para o `sa` — ele é o
que o adapter de nó único ainda usa para a checagem de driver no boot, e é o nó
que a suíte de integração dos adapters exercita.

---

### DEC-098 — Cada nó tem a sua credencial, e a linha diz onde ela mora

**Data:** 2026-08-13 · **Status:** accepted · **Supersedes:** DEC-073

**Contexto.** A DEC-073 pôs credencial no plano de controle do nó e escolheu um
**token compartilhado**, com as duas consequências ditas em voz alta: trocá-lo
derruba a frota inteira, e nenhum log diz qual chamador o usou. Com um nó só
isso era hipótese. Com cinco, virou o arranjo.

A investigação achou um terceiro fato, pior que os dois: `exit_nodes.credential_ref`
**não tinha leitor nenhum**. Era escrita pelo formulário, guardada, selecionada de
volta — e descartada em silêncio em toda chamada a `ExitNodeFactory.for()`, porque
`ExitNodeRow` declarava quatro campos e a tipagem estrutural do TypeScript aceita
a propriedade extra sem reclamar. O seam da DEC-090 existia e não ligava em lugar
nenhum. Junto: o localstack **habilitava** `secretsmanager` e não semeava nada,
enquanto a documentação o listava como se fosse usado.

**Decisão.** Uma porta `ISecretStore` com **um método de leitura**, um adapter de
Secrets Manager, e `ExitNodeFactory.for()` resolvendo a credencial de cada nó
pela referência que a linha dele carrega. `credential_ref` vira `NOT NULL`,
`EXIT_NODE_API_TOKEN` sai do sistema, e cada contêiner do devstack sobe com a
sua.

**Rationale.** A porta **não tem `write`**. A aplicação nunca guarda um segredo, e
um método sem chamador de produção é uma superfície que alguém acaba chamando de
dentro de um handler — semear é da suíte de conformidade, fora de banda, como já
é para o nó.

`read()` devolve **`null`** para uma referência inexistente em vez de lançar, e é
isso que torna possível a terceira recusa. O operador tem três lugares para ir, e
até aqui existiam dois códigos: `NODE_CREDENTIAL_NOT_FOUND` é o segredo que
ninguém criou, `NODE_UNAUTHORIZED` é o nó recusando o que existe, e
`NODE_UNREACHABLE` é a máquina calada. Ele é **400**, não 502: o nó nunca entrou
na história, e o que estava errado era um campo do request.

**Sem caminho de fallback**, e essa é a decisão que carrega peso. Nada está
publicado e nenhum nó estava registrado, então não havia linha legada para
acomodar — e um `credential_ref` nulo teria mantido o token da frota vivo como
"modo alternativo", que é como um substituto sobrevive ao que ele substituiu.

O cache é um `Map` **em processo**, com TTL de 300s, e nunca o `ICacheStore`: o
Redis do devstack roda sem `requirepass` e com AOF em disco, então cachear a
credencial ali seria mudá-la de lugar em vez de protegê-la — o oposto exato do
motivo de `credential_ref` ser uma referência. A chave é a **referência** e não o
id do nó, e a ausência **nunca** é cacheada: a correção é o operador criar o
segredo, e isso deve valer na varredura seguinte.

`for()` passou a ser assíncrona, e isso moveu uma fronteira. Em
`PeerReconciler.#sweep` a abertura do nó ficava **fora** do `try`, porque não
podia falhar; agora pode, e fora dali um nó com segredo ausente abortaria a
varredura da frota inteira — a mesma regressão que a DEC-094 fechou, um nível
acima. Provado apagando a fronteira e vendo o teste ficar vermelho.

O esquema continua **HTTP Basic**. A DEC-073 registra que um `Bearer` não
adiantaria caminho para mTLS, porque mTLS não reaproveita esquema de cabeçalho
nenhum; só o **valor** passou a ser por nó. Do lado do contêiner a variável
continua `EXIT_NODE_API_TOKEN`: `entrypoint.sh` e `healthcheck.sh` não mudaram um
byte, porque um nó real toma um token do próprio ambiente e não sabe o que é uma
frota.

`IExitNode` e `describeExitNodeContract` **não mudaram**. Era o teste que o
`libs/adapters/CLAUDE.md` já tinha escrito: se a suíte precisasse mudar, a
credencial teria vazado para a porta.

**Consequências.** Quem cobra que a referência de um nó resolve é o `make check`,
por nó, a cada rodada — não uma rota de registro, que não existe. Uma referência
que não nomeia nada aparece como nó inalcançável na varredura de saúde, e o log
diz qual das duas coisas falhou.

Rotacionar passa a ser um nó de cada vez: escrever o segredo novo, recarregar
aquele nó, apagar o antigo. **No devstack isso é recriar o contêiner**, porque o
`entrypoint.sh` escreve o `httpd.conf` no boot. Uma janela em que o nó aceita os
dois valores exigiria descobrir se o `busybox httpd` casa duas linhas para o
mesmo caminho, e isso não foi verificado — fica como spike, não como promessa.

`make check` passa de 41 para **47**. A asserção que ganha o dia é **negativa e
cíclica**: cada nó recusa o token do vizinho (`sa←na←eu←as←af←sa`). Sem ela,
cinco valores idênticos passariam por todo o resto do arquivo, inclusive pela
positiva. A positiva, por sua vez, passou a ler o token do **Secrets Manager**,
o que a transforma de "o `.env` e o nó concordam" em "o segredo, o compose, o
`httpd.conf` e a porta publicada concordam".

O adapter único no token `EXIT_NODE` foi **removido do registry**: ele não tinha
consumidor desde a DEC-090 e deixou de ter um token para usar. `EXIT_NODE_DRIVER`
continua validado pelo enum do zod, então nada se perdeu no boot.

O que **não** mudou: mTLS continua sendo o teto e continua sendo trabalho de nó
real — o `busybox httpd` é 1.37.0 e não fala TLS. E a rotação da **chave
WireGuard** do nó continua fora de escopo: ela invalida todo `.conf` já baixado,
a DEC-095 só a detecta, e reemitir em massa é decisão de produto.

---

### DEC-099 — O entitlement de região sai; quando voltar, volta como lista

**Data:** 2026-08-14 · **Status:** accepted · **Supersedes:** DEC-078

**Contexto.** A DEC-078 trocou "quais regiões" por "quantas" com um argumento de
uma linha: se o nome é do cliente, o tier não tem como entitular quais.

**Decisão.** `regions` sai de `Entitlements`.

**Rationale.** A premissa inverteu. Nós nomeamos as regiões (DEC-090), então um
tier **pode** dizer quais — e a forma honesta é a lista de slugs que a DEC-036
sempre quis, agora legitimamente nossa.

Publicar o mesmo número com um terceiro significado — "quantas você alcança" —
seria o único que nenhuma restrição sabe cobrar. "Quantas" precisa de um "quais"
para cobrar contra: ou as N primeiras por alguma ordem, que é arbitrário e muda
sozinho quando uma região entra, ou um teto de espalhamento sobre as regiões em
que a account tem device vivo. O teto de espalhamento é a única leitura coerente,
e a DEC-043 proíbe cobrá-lo com `count()` antes do `INSERT` — o que exige tabela
própria, ciclo de devolução e um caminho de `QUOTA_EXCEEDED`, para cobrar
`pro = 5` contra uma frota de exatamente cinco regiões, onde nunca pegaria.

**Consequências.** Com um tier só não há o que decidir de qualquer forma
(DEC-043). Quando existir um segundo, `regions` volta como
`readonly RegionSlug[]`, cobrado na criação do device contra `request.regionId`.
A tela de plano perde uma linha, e nenhum teste de entitlement além dela muda:
os do e2e comparam o objeto inteiro contra `ENTITLEMENTS.pro`.

---

### DEC-100 — A frota é semeada por migration, e a custódia da chave vira portão

**Data:** 2026-08-14 · **Status:** accepted

**Contexto.** Se a frota é nossa (DEC-090), ela precisa existir como linha em todo
ambiente sem passo manual — e a DEC-090 apagou a única rota que criava essas
linhas. Um `pnpm db:migrate` numa base vazia tem que deixar o produto usável.

**Decisão.** Um descritor congelado em `libs/database/src/platform-fleet.ts` é a
fonte única — slug, nome, rótulo, endpoint, url de controle, faixa, referência de
credencial, chave pública e **UUID fixo** —, transcrito para
`0008_seed_platform_fleet.sql`.

**Rationale.** SQL não sabe chamar `describe()`, então a custódia da DEC-063 não
pode ser cumprida do jeito que a DEC-077 cumpria. Ela **se move** em vez de sumir.

A regra existia contra uma ameaça precisa: alguém digita uma chave num formulário,
o erro de digitação entra em todo `.conf`, e a falha aparece longe, num cliente
que nunca fecha handshake. Todo elemento dessa ameaça é sobre um valor não
revisado vindo de fora — e o formulário deixou de existir. A chave semeada está
versionada ao lado da chave privada que a produz, e é revisada em diff. No lugar
da checagem em runtime entra uma **asserção por nó** no `check.sh`, comparando o
`publicKey=` que a máquina responde com o que a linha dela carrega. É mais forte
do que o registro era: o registro provava uma vez, no insert; isto prova a cada
`make check`.

O UUID fixo não é conveniência. É o que faz o helper de frota do e2e virar uma
constante em vez de duas requisições por teste, e o que transforma um seed que
divergiu em erro de compilação em vez de violação de chave estrangeira no
quadragésimo teste.

`last_seen_at` é semeado com `now()`. Com `NULL`, `pickNodeInRegion` não devolve
nada e toda criação de chave responde 409 até a primeira varredura — que nunca
chega para quem sobe api e web sem o worker, nem depois de um `db:migrate` seco.
`now()` é uma afirmação que ninguém verificou, mas é limitada: passados
`STALE_AFTER_SECONDS` um nó que nunca respondeu sai de circulação sozinho, o que
é o mesmo desfecho de um nó que morreu um segundo depois de responder.

**Consequências.** `make check` passa de 47 para 53 asserções.

`DELETE FROM accounts` deixa de levar a frota junto, que é o ponto — e cobra duas
coisas do `beforeEach` do e2e. `last_seen_at` precisa ser restaurado, porque o
teste que envelhece um nó agora contamina todos os seguintes. E os peers do
`MemoryExitNode` precisam ser limpos: o fake é cacheado por **id** de nó, o id
agora é fixo, e o mapa de peers passa a acumular pelo arquivo inteiro. Um e2e
rodado duas vezes seguidas sem resetar o banco é o que prova as duas.

---

### DEC-101 — O segredo sai do ambiente, e a porta passa a nomear a janela de rotação

**Data:** 2026-08-14 · **Status:** accepted · **Supersedes:** DEC-098 (parcial)

**Contexto.** A DEC-098 criou `ISecretStore` com **um método de leitura** e um
consumidor: a credencial de cada nó. Dois segredos ficaram de fora, e ficaram no
**ambiente** — `AUTH_JWT_SECRET` e `STRIPE_WEBHOOK_SECRET`. Um segredo no
ambiente aparece em `docker inspect`, no `ps` de quem tiver o PID e em todo dump
de configuração colado num chamado.

O primeiro tinha um problema pior que o lugar. `AccessTokenService` o capturava
no **construtor** (`this.#secret = new TextEncoder().encode(...)`), então trocá-lo
invalidava todo access token em circulação de uma vez — e o access token não é
revogável (`CONTEXT.md`), então não havia nem o consolo de a sessão sobreviver:
todo mundo caía junto, no meio do que estava fazendo.

Os dois itens do roadmap eram **um desenho**. `ISecretStore` mora no submodule
publicado; tirar os segredos do ambiente contra o `read()` de então e só depois
descobrir que a rotação precisa de dois valores custaria dois bumps quebrados,
dois ciclos de publicação e dois `consumer-check`.

**Decisão.** `read(ref)` devolve `{ current, previous } | null`. Um método,
um bump. `AUTH_JWT_SECRET` e `STRIPE_WEBHOOK_SECRET` viram
`AUTH_JWT_SECRET_REF` e `STRIPE_WEBHOOK_SECRET_REF`. `AccessTokenService` assina
com o corrente e verifica contra os dois. `SECRETS_DRIVER` perde `memory`.

**Rationale.** Um método e não um `read()` ao lado de um `readAll()`. Um `read`
que devolve calado só o valor corrente, ao lado de um irmão que sabe da janela, é
**exatamente a forma que produziu o problema**: um valor capturado, e ninguém
reparando por meses. Com a janela no tipo de retorno, nenhum chamador pode
ignorar que ela existe — quem quer só o corrente escreve `.current` e diz isso.

`{ current, previous }` corresponde a `AWSCURRENT`/`AWSPREVIOUS` sem nomear a
AWS, e é o que o provider **garante**. Uma lista prometeria mais do que ele
entrega, e um número de versões configurável seria uma escolha que nada no
sistema saberia fazer.

A janela tem fim, e é isso que a suíte de conformidade cobra: um terceiro valor
aposenta o primeiro. Sem essa asserção, "aceita dois" e "aceita todos os que já
existiram" passam pelos mesmos testes — e um segredo que alguém rotacionou
justamente por suspeitar dele continuaria valendo para sempre.

**A verificação com o valor anterior passa pelo mesmo `jwtVerify`**, issuer e
audience incluídos. Um fallback que só reconfere a assinatura aceitaria um token
emitido por qualquer sistema que compartilhasse o segredo aposentado, e nada
ficaria vermelho. Três testes negativos fixam isso, e um quarto fixa que a
expiração **não** cai no fallback: `ERR_JWT_EXPIRED` não depende de qual chave
assinou, e tentar a próxima troca "sua sessão acabou" por "seu token não é
válido" — a única mensagem que manda o usuário para o suporte.

**Sem caminho de fallback**, na mesma leitura que a DEC-098 fez para o nó.
`SECRETS_DRIVER` perde `memory` porque um driver de memória semeado do ambiente
manteria o ambiente como fonte de segredo — o oposto exato do que esta decisão
faz. O e2e passa a apontar para o localstack que o devstack já sobe; ele já
dependia dele para todo o resto.

O cache saiu da `ExitNodeFactory` e virou `CachingSecretStore`, um decorator no
token. As invariantes da DEC-098 vão junto, palavra por palavra: chaveado pela
**referência** e não pelo consumidor, em processo e **nunca** no `ICacheStore`, e
a ausência nunca cacheada. O que mudou é que agora há dois consumidores, e
escrever o mesmo `Map` duas vezes é o que uma revisão pega.

**O segredo do webhook é resolvido na construção do provider, nunca por
requisição.** A assinatura cobre os bytes exatos recebidos, e qualquer coisa que
releia ou reserialize o corpo para buscar um segredo de outro jeito falha só
contra o provider real — nunca contra uma fixture.
`verifyWebhookSignature(rawBody, sig)` continua **síncrona** e continua recebendo
a mesma string; o que ela ganhou foi tentar os dois valores, porque o Stripe
entrega dois enquanto um endpoint secret está sendo trocado.

**Consequências.** `AdapterFactory` passa a aceitar `T | Promise<T>`. É uma linha
no `registry.ts` e o Nest já aguarda um `useFactory`, mas é o que permite um
adapter que precisa de um segredo antes de existir.

Rotacionar o segredo do webhook **pede um restart da API**. É mais do que havia
e menos do que o JWT ganhou, e o roadmap só pedia rotação do JWT.

`ExitNodeFactory` lê `.current` e nunca `.previous`. O nó aceita os dois durante
a janela (DEC-102), e alcançar a metade aposentada aqui a manteria viva depois do
ponto em que alguém deliberadamente parou de publicá-la.

O devstack passa a semear `poc-vpn/auth/jwt-secret` **duas vezes**, com o valor
aposentado primeiro. Uma janela que precisa ser arranjada antes de poder ser
conferida é uma janela que nada confere; assim o `check.sh` a afirma a cada
rodada, e "um token assinado antes da rotação" é um estado em que esta stack está
sempre, em vez de um parágrafo num log de decisões.

`make check` passa de 53 para **56**. `@vpn/ports` vai a 0.16.0 e `@vpn/testing`
a 0.17.0.

O que **não** mudou: `IBillingProvider` e `IExitNode`. Se a rotação tivesse
chegado a qualquer uma das duas, o segredo teria vazado para a porta — o mesmo
teste que a DEC-098 já tinha escrito para a credencial do nó.

---

### DEC-102 — A credencial de um nó rotaciona sem reiniciar, porque o `httpd` relê no SIGHUP

**Data:** 2026-08-14 · **Status:** accepted · **Supersedes:** DEC-098 (parcial)

**Contexto.** A DEC-098 fechou a rotação por nó e deixou uma pergunta em aberto,
como spike e não como promessa: _"uma janela em que o nó aceite os dois valores
exigiria descobrir se o `busybox httpd` casa duas linhas para o mesmo caminho, e
isso não foi verificado"_. Sem essa janela, rotacionar um nó no devstack era
recriar o contêiner — o que derruba o túnel e todo peer nele, para trocar uma
senha.

**Decisão.** O `httpd.conf` do nó carrega **duas** linhas para `/` enquanto uma
janela está aberta, e um `/rotate.sh` no imagem as reescreve e manda `SIGHUP`.
Rotacionar são duas chamadas: `rotate.sh NOVO VELHO` abre, `rotate.sh NOVO`
fecha. Nada reinicia em nenhuma das duas.

**Rationale.** O spike foi feito, e a resposta é sim — duas vezes sim, e a
segunda não estava na pergunta.

Lendo `networking/httpd.c` (o código de autenticação é byte a byte o mesmo entre
`1_36_1` e `master`, então o 1.37.0 do `busybox-extras` é esse código):

1. `parse_conf` insere **cada** linha `/path:user:pass` em `g_auth`, ordenada por
   comprimento decrescente de caminho, **sem deduplicar nem substituir**. Duas
   linhas com o mesmo caminho sobrevivem as duas.
2. `check_user_passwd` percorre a lista inteira. A guarda `prev` só pula entradas
   cujo prefixo **difere** de um que já casou; prefixos idênticos passam. Senha
   errada cai no fim do laço e continua. A recusa só acontece com a lista
   esgotada (`return (prev == NULL)`).
3. E o que a pergunta não previa: `signal(SIGHUP, sighup_handler)` chama
   `parse_conf(…, SIGNALED_PARSE)`, que **libera `g_auth` e relê o arquivo**.

Medido no contêiner, não só lido: `busybox-extras-1.37.0-r14`, e o `httpd` do nó
reporta `SigCgt: 0000000000000001` — SIGHUP capturado. Com as duas linhas no
lugar, os dois valores respondem 200 e o do vizinho continua respondendo 401.

**O entrypoint chama o mesmo script.** Bootar com uma janela aberta e rotacionar
para dentro de uma produzem config idêntica byte a byte, e um nó que sobe no meio
de uma rotação é o caso normal — quem escreveu o segredo novo no cofre pode não
ter alcançado a máquina ainda.

**Dois formatos de valor são recusados pelo script**, e vêm do mesmo código-fonte:
um valor começando com `$` seguido de dígito é lido como hash de `crypt` e
comparado contra uma cifra do que o chamador mandou; um `:` parte o campo, e tudo
depois dele silenciosamente deixa de ser o segredo. Nos dois casos o nó sobe e
recusa todo mundo com um 401 que não aponta para nada.

**Consequências.** O devstack fica **permanentemente com as janelas abertas** —
cinco nós, cada um com o corrente e o anterior. Uma janela que alguém precisa
arranjar antes de poder ser conferida é uma janela que nada confere; assim o
`check.sh` afirma uma por nó a cada rodada. Foi essa asserção que teria pegado o
busybox guardando só uma das duas linhas, se ele guardasse.

E o `check.sh` fecha e reabre uma janela **de verdade**, num nó, ao vivo: o valor
aposentado passa a dar 401, o corrente segue dando 200, e reabrir o traz de volta.
A quarta asserção do bloco é a que carrega a decisão — o **PID do `httpd` é o
mesmo** antes e depois. "Sem reiniciar" é a afirmação inteira, e um contêiner que
voltou calado satisfaria todas as outras. O bloco termina onde começou, então o
arquivo continua idempotente.

`ExitNodeFactory` continua lendo só `.current`. A janela existe para que os dois
lados se movam em ordens diferentes, não para manter viva a metade aposentada:
alcançá-la do lado da aplicação a manteria funcionando depois do ponto em que
alguém deliberadamente parou de publicá-la.

`make check` passa de 56 para **65**.

O que **não** mudou: a comparação do busybox é `strcmp`, que não é de tempo
constante. É pré-existente, não é introduzido aqui, e continua valendo — o que a
protege é a credencial não ser adivinhável, não o comparador. E `IExitNode`,
`describeExitNodeContract` e `HttpExitNode` não mudaram uma linha: a rotação é do
nó, e a porta nunca soube o que é uma credencial.

---

### DEC-103 — mTLS espera um nó de verdade, e isso fica escrito

**Data:** 2026-08-14 · **Status:** accepted · **Supersedes:** DEC-073 (o parágrafo de mTLS)

**Contexto.** O plano de controle fala **HTTP puro**. A credencial é por nó desde
a DEC-098 e rotaciona sem reiniciar desde a DEC-102, mas ela viaja em Basic sobre
HTTP. O alvo sempre foi mTLS, e o `busybox httpd` não fala TLS — então não há
como escrever o dispatcher de `fetch` contra um nó que não sabe responder a ele.

Três caminhos existiam, e escolher **nenhum** também é uma decisão. Ela precisa
estar escrita, senão o item volta para a mesa a cada leitura do roadmap.

**Decisão.** mTLS é adiado, explicitamente, para quando existir um nó real e a
stack `network`. O item continua **aberto** no roadmap, apontando para aqui.

**Rationale.** Os dois caminhos que trariam mTLS para o devstack hoje custam mais
do que entregam, e cada um destrói uma coisa que já foi decidida.

**Um proxy de terminação TLS na frente de cada nó** tira o TLS do artefato. A
DEC-062 diz que `devstack/wireguard/` é _"o arquivo que alguém copia em direção a
um nó real"_, e o que se aprenderia com cinco sidecars é como configurar um proxy
que o nó real não vai ter. O dispatcher do lado da aplicação ficaria exercitado
contra uma topologia que não é a de destino.

**Trocar a imagem do nó** por uma que termine TLS reescreve o plano de controle
inteiro: os três CGI, o `-h`, e o mecanismo de cópia no boot que a DEC-089 acabou
de assentar por uma razão que continua valendo (o bit de execução viaja com o
host). Seria refazer duas decisões recentes para chegar a um nó que ainda não é o
de produção.

E a stack `network` **está vazia** — é um item não iniciado do próprio roadmap.
mTLS é certificado de cliente mais terminação no nó mais uma autoridade que emite
e rotaciona os dois lados; a parte difícil é a autoridade, e ela não existe em
lugar nenhum ainda. Construí-la contra contêineres seria construí-la duas vezes.

A DEC-073 já registrava por que nada disso ganha caminho de graça: **mTLS não
reaproveita esquema de cabeçalho nenhum.** Nem o `Basic` de hoje nem um `Bearer`
adiantam um passo. Por isso o custo de adiar é exatamente o custo de fazer depois,
e não cresce enquanto se espera — o que é a condição para adiar honestamente.

**Consequências.** A credencial continua viajando em Basic sobre HTTP entre a
aplicação e o nó. No devstack isso é loopback; num deploy, é a stack `network` que
decide se esse tráfego atravessa alguma coisa — e é lá que a pergunta pertence.

Este parágrafo supera o de mTLS da DEC-073, que a DEC-098 carregou adiante. As
três dizem a mesma coisa sobre o esquema de cabeçalho; o que esta acrescenta é a
recusa dos dois atalhos, para que ela não precise ser redescoberta.

O roadmap continua com a linha **aberta**. Adiar não é entregar, e um `[x]` aqui
seria a única mentira que este arquivo já teria contado.

---

### DEC-104 — A suíte de billing é partida pelo que um provider consegue responder

**Data:** 2026-08-14 · **Status:** accepted · **Supersedes:** DEC-060 (o parágrafo final), DEC-009 (a consequência)

**Contexto.** `describeBillingProviderContract` nunca rodou contra o
`StripeBillingProvider`. A razão está escrita desde a DEC-009 e repetida na
DEC-060: a suíte **começa** por `createCheckout`, e o localstripe não implementa
`/v1/checkout/sessions`. Registrar o adapter real faria o bloco de checkout
falhar por limitação do mock, não do adapter — então cancelar e retomar ficaram
pinados à mão, e o contrato inteiro do provider real ficou por conferir.

O roadmap pedia partir em **dois**: checkout e ciclo de vida. Medido, dois não
bastam. O localstripe responde `/v1/invoices`, mas nada que ele serve carrega
`invoice_pdf` — então `fetchInvoicePdf` também não passa, e ele estava no mesmo
bloco que a normalização de fatura, que é pura e passa.

**Decisão.** Quatro suítes, cada uma com **a sua harness**: `checkout`,
`lifecycle`, `webhook` e `invoice archive`. O Stripe registra **lifecycle** e
**webhook**.

**Rationale.** A linha do corte não é temática, é **o que o provider consegue ser
perguntado**. Normalizar uma fatura paga é _parsing_: precisa de um corpo assinado
e de mais nada. Buscar o PDF precisa de um provider que guarde documento. Estavam
no mesmo bloco por assunto, e é essa vizinhança que fazia o Stripe perder as seis
asserções de normalização junto com as duas de download.

**As harnesses são estreitas de propósito.** `BillingWebhookHarness` não tem
`invoicedExternalId`, então um registro que não sabe produzir uma fatura não
compila contra a suíte de arquivo. "Quais destas este adapter enfrenta" vira erro
de compilação em vez de um parágrafo que alguém precisa manter — e um `skip`
dentro de uma suíte que depois se declara verde é precisamente o que a DEC-009
recusou ao dizer que **uma passagem parcial não é uma**.

Os dois ausentes ficam nomeados e medidos, aqui e no `libs/adapters/CLAUDE.md`.
Isso é o oposto do que havia: antes, "a suíte não roda contra o Stripe" era uma
frase; agora são duas suítes de quatro, com a razão de cada uma.

O Stripe não emite webhook nenhum contra o localstripe, então as fixtures da
suíte de webhook são construídas e assinadas à mão com
`Stripe.webhooks.generateTestHeaderString`. Não é uma lacuna: verificação e
parsing são **puros**, então uma fixture assinada pelo SDK de verdade exercita
exatamente o código que uma entrega exercitaria.

**Consequências.** `stripe.integration.spec.ts` perde os testes que a suíte
passou a cobrir — cancelar no fim do período e retomar estavam pinados à mão só
porque a suíte não podia ser registrada, e a DEC-060 dizia isso em voz alta.
Sobrou o que a suíte **não** afirma: a leitura de volta contra um payload real
(com o `currentPeriodEnd` revivido), a subscription inexistente, o período
preservado ao retomar — que o contrato não tem como pedir, porque o fake é livre
para inventar um período e um provider real não — e o cancelamento imediato, que
é de suporte e exclusão e por isso fica fora do contrato de propósito.

`@vpn/testing` vai a 0.18.0. A suíte de adapters passa de 103 para **123**.

Quando existir um mock com Checkout, ou quando a suíte rodar contra a conta em
test mode, as outras duas entram sem nada mudar de forma: elas já existem, com
harness própria, e o que falta é um provider que as saiba alimentar.
