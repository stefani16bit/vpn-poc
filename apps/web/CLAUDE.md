# apps/web

**Status:** partial · **Tag:** `type:app`

Vite 6 + React 19 + RTK Query. Cadastro, verificação, login, reset e cobrança.
Sem biblioteca de componentes: seis telas não pagam uma.

## Sessão

`auth-slice` é uma máquina de três estados — `unknown | authenticated |
unauthenticated`. O terceiro é o que quase sempre falta: com booleano, "ainda
não verifiquei" e "verifiquei, não está logado" são o mesmo valor, e o app
pisca a tela de login a cada reload. `RequireAuth` checa `unknown` **primeiro**.

O access token vive em memória e **não** é persistido. O refresh é um cookie
httpOnly; no boot, `use-bootstrap-auth` troca o cookie por um access token novo.
Guardar o token em localStorage entregaria ele a qualquer script da página e
desfaria a razão de o cookie ser httpOnly.

`refreshInFlight` em `api.ts` é compartilhado: dez componentes renderizando
juntos produzem um refresh, não dez. Os outros nove falhariam de qualquer forma,
porque o refresh rotaciona e só o primeiro token continua válido.

## i18n

`LocaleProvider` + `useTranslator()`. As traduções vêm de `@vpn/i18n` como
objeto tipado, então uma chave inexistente é erro de compilação.

O locale é lido de `localStorage`, com `navigator.language` negociado como
fallback, e vai em `Accept-Language` em toda requisição (`prepareHeaders`).

`error-messages.ts` não existe mais: a copy de erro é `errors.<CODE>` no
catálogo compartilhado.

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
- Não escreva string literal voltada ao usuário. Exceção: o error boundary, que
  monta acima do provider e não tem tradutor.
- Não branche na união de erro do RTKQ; use `normalizeError` e o `code`.
- Não valide formulário com schema local — importe de `@vpn/contracts`.
