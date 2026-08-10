# apps/web

**Status:** partial · **Tag:** `type:app`

Vite 6 + React 19 + RTK Query + Tailwind v4 + shadcn/ui. Cadastro, verificação,
login, reset e cobrança.

Os primitivos são **copiados** para `components/ui/`, não instalados: o
componente copiado é editável, e a regra de "nenhum literal voltado ao usuário"
é impossível de cumprir dentro de um `node_modules`. Ver DEC-019.

## Sessão

`auth-slice` é uma máquina de três estados — `unknown | authenticated |
unauthenticated`. O terceiro é o que quase sempre falta: com booleano, "ainda
não verifiquei" e "verifiquei, não está logado" são o mesmo valor, e o app
pisca a tela de login a cada reload. `RequireAuth` checa `unknown` **primeiro**.

O access token vive em memória e **não** é persistido. O refresh é um cookie
httpOnly; no boot, `use-bootstrap-auth` troca o cookie por um access token novo.
Guardar o token em localStorage entregaria ele a qualquer script da página e
desfaria a razão de o cookie ser httpOnly.

`refreshInFlight` em `base-query.ts` é compartilhado: dez componentes
renderizando juntos produzem um refresh, não dez. Os outros nove falhariam de
qualquer forma, porque o refresh rotaciona e só o primeiro token continua
válido. Isso resolve concorrência **dentro de um tick**; a sequência é o latch
ao lado dele — um 401 só tenta reautenticar se `auth.status` for
`authenticated`. Sem isso, cada 401 é um convite novo e o `sessionCleared` que
derruba o cache produz o refetch que produz o 401 seguinte. Ver DEC-032.

## Cancelar e retomar

`PlanActions` ramifica em três, e a ordem importa: sem assinatura oferece os
planos; **agendada para cancelar** oferece retomar; ativa oferece o diálogo de
cancelamento. Não existe mais botão desabilitado — um controle que a pessoa vê e
não pode usar não é um estado, é um beco.

O diálogo é `AlertDialog` do Radix, e cancelar só acontece no `onClick` do
`AlertDialogAction`. Ele já vem com `role="alertdialog"`, foco preso e Esc; por
isso o teste consulta por papel (`findByRole('alertdialog')`) e não por texto.

## Retorno do checkout

`/billing/success` e `/billing/cancel` são rotas de verdade e vêm **antes** do
catch-all `/billing/*`, que fica para subpath desconhecido — inclusive `/billing`,
que é o link dos e-mails de cobrança.

A de sucesso faz polling: quem ativa a assinatura é o webhook, e o redirect ganha
essa corrida. Ela consulta a projeção até o tier aparecer ou até o limite, e o
limite é **estado neutro** — "sendo processada", com um botão de verificar de
novo. Nunca "o pagamento falhou": não existe redirect de falha, um cartão
recusado não sai da página do provider. Ver DEC-058.

O outro polling do app é a lista de dispositivos, e ele **não** tem prazo — a
diferença está na DEC-072.

O que decide "ativada" é `resolveTier` de `@vpn/contracts`, a mesma função da API.
Duplicar a regra aqui faria a tela e o servidor discordarem sobre `trialing`.

## i18n

`LocaleProvider` + `useTranslator()`. As traduções vêm de `@vpn/i18n` como
objeto tipado, então uma chave inexistente é erro de compilação.

O locale é lido de `localStorage`, com `navigator.language` negociado como
fallback, e vai em `Accept-Language` em toda requisição (`prepareHeaders`).

`error-messages.ts` não existe mais: a copy de erro é `errors.<CODE>` no
catálogo compartilhado.

`documentElement.lang` acompanha o locale (efeito no `LocaleProvider`).
`index.html` fixa `pt-BR`, então sem isso o leitor de tela lê a página inteira
com a pronúncia errada pelo resto da sessão.

Acrescentar uma chave é operação entre repositórios: editar `pt-BR.ts` e
`en.ts` no submodule, publicar no Verdaccio, rodar `consumer-check`, subir o
ponteiro. Junte todas as chaves numa release só.

## Store

`createApi` guarda só transporte e `tagTypes`; cada feature injeta os seus
endpoints com `injectEndpoints`. Isso muta o mesmo objeto `api`, então **não há
wiring novo**: o reducer já está montado e não existe lista de registro. O outro
lado do acordo é que um endpoint cujo arquivo ninguém importa silenciosamente
não existe.

`logout` mora em `app/store/session.api.ts`, não em `features/auth`: a página de
cobrança precisa dele, e feature não importa feature. Ele fica ao lado do estado
que ele limpa.

## Cobertura

`components/ui/**` fica fora da conta: é código de registry cujo comportamento é
do Radix e é coberto lá em cima — `select.tsx` sozinho são ~150 linhas de
subcomponentes que nunca renderizamos. `components/form/**` e
`components/layout/**` **não** ficam: é onde mora comportamento nosso.

`app.tsx`, `router.tsx` e `providers.tsx` também contam, mesmo puxando o número
para baixo. Excluir o que é inconveniente é exatamente como o número do
`apps/api` chegou a parecer 90% valendo 40%.

## Cast documentado

`stateSyncMiddleware` em `app/store/index.ts` tem um `as unknown as Middleware`.
`@types/redux-state-sync` é escrito contra o `Middleware` do redux 4 e o RTK 2
traz o redux 5, cujo `Middleware` é genérico sobre o próximo dispatch. As duas
formas são estruturalmente incompatíveis e nenhuma configuração reconcilia. O
cast está nessa expressão só, não afrouxado no store.

## Don't

- Não persista o access token.
- Não sincronize o cache do RTK Query entre abas — a allowlist em
  `AUTH_SYNCED_ACTIONS` é deliberada.
- Não escreva string literal voltada ao usuário — **inclusive dentro de um
  componente copiado do registry**, que é código nosso a partir do momento em
  que aterrissa. Exceção: o error boundary, que monta acima do provider e por
  construção não tem tradutor.
- Não use classe que não seja utilitário do Tailwind; `no-unknown-classes`
  reprova. Foi essa regra que pegou as animações mortas do `Select`.
- Não rode `eslint --fix` fora de `apps/web`. Ver DEC-017.
- Não branche na união de erro do RTKQ; use `normalizeError` e o `code`.
- Não valide formulário com schema local — importe de `@vpn/contracts`.
