# Landing pública

**Status:** em implementação
**Decisões relacionadas:** DEC-106 (`/account`), DEC-107 (preço em contracts),
DEC-108 (a landing), DEC-109 (cadência pretendida)

## Problema

O produto não tem porta de entrada. Quem abre a raiz do site cai no `/login`,
porque `/` é a página de conta atrás de `RequireAuth` e as únicas rotas públicas
são as cinco de autenticação. Não existe tela que diga o que o produto faz nem
quanto custa, e o app nunca exibiu um preço em lugar nenhum: os únicos valores
vivem num script manual que semeia o Stripe.

## Escopo

**Entra.** Uma página pública em `/` com banner, três cartões de valor e um
cartão de plano com os dois preços. A conta se muda para `/account`. O preço vira
um fato compartilhado em `@vpn/contracts`, e o script de seed passa a lê-lo em vez
de repeti-lo. A cadência escolhida no clique atravessa o cadastro e reaparece
nomeada em `/account`.

**Não entra.** SEO e `<meta name="description">`. Carregar a cadência entre
navegadores diferentes. Disparar checkout sozinho depois do login. `?cadence=` na
URL. Segundo tier, trial, ou preço em outra moeda. Nada muda na API.

## Vocabulário

**Preço do plano** e **cadência pretendida**, ambos já em `CONTEXT.md`.

## Comportamento

```
Dado    um visitante sem sessão
Quando  ele abre /
Então   vê o banner, os três cartões e os dois preços formatados
E       vê "Entrar" e "Criar conta" com o mesmo peso
```

O "Entrar" tem o mesmo peso do CTA de propósito: pela inegociável nº 4, um
cliente que já tem conta e cai no `/signup` recebe "confira seu e-mail" e nenhum
link utilizável.

```
Dado    um visitante cuja sessão ainda não resolveu (status unknown)
Quando  a landing renderiza
Então   ela mostra o cabeçalho deslogado, não um spinner
```

```
Dado    um visitante com sessão
Quando  ele abre /
Então   o cabeçalho oferece "Sua conta" apontando para /account
```

```
Dado    um visitante sem sessão na landing
Quando  ele clica "Começar anual"
Então   a cadência anual fica guardada no navegador
E       ele vai para /signup
```

```
Dado    um visitante com a cadência anual guardada há menos de 24h
Quando  ele entra e chega em /account sem assinatura
Então   a tela diz que ele escolheu o plano anual antes de criar a conta
E       o botão anual vem antes do mensal
```

```
Dado    uma cadência guardada há mais de 24h, ilegível, ou ausente
Quando  /account renderiza
Então   nada é dito e os botões ficam na ordem padrão
```

```
Dado    um visitante que verifica o e-mail em outro navegador
Quando  ele entra e chega em /account
Então   nada é dito — a preferência não atravessa navegadores, e não faz falta
```

```
Dado    uma pessoa sem billing.manage
Quando  ela chega em /account com uma cadência guardada
Então   nada é dito, porque a seção de assinatura inteira não é dela
```

```
Dado    um caminho desconhecido, ou /billing/qualquer-coisa
Quando  alguém o abre
Então   vai para /account — e, sem sessão, o RequireAuth o leva ao /login
```

Isso preserva exatamente o comportamento de hoje: o catch-all nunca aponta para
a landing.

```
Dado    um PLAN_PRICES que discorda do preço já semeado no provider
Quando  pnpm billing:prices roda
Então   ele falha mostrando os dois valores, em vez de imprimir "reused"
```

## Portas afetadas

Nenhuma. A landing não faz chamada de rede, e o preço é constante compartilhada,
não dependência externa nova.

## Banco

Nada. A cadência pretendida é do navegador, não do servidor — é o que a mantém
uma preferência em vez de uma reserva que alguém teria de expirar.

## Idempotência

Não se aplica: nenhum handler novo. O clique na landing só escreve em
`localStorage`, e escrever duas vezes o mesmo valor é o mesmo valor.

Vale registrar o que **não** fazemos: nada dispara checkout automaticamente. É um
redirect para fora da origem saindo de um efeito, e o StrictMode roda efeito duas
vezes (CLAUDE.md §7).

## Segurança

- **Vaza a existência de uma conta?** Não. A landing é estática, não chama a API e
  não recebe e-mail. Os caminhos de cadastro e login não mudam.
- **Token?** Nenhum. A cadência pretendida não é credencial, não autoriza nada e é
  validada com `cadenceSchema` na leitura — um valor adulterado no `localStorage`
  vira `null`, não um erro.
- **Sessões a matar?** Nenhuma.

Um detalhe de layering: `/account` mostra os preços a quem tem `billing.manage`,
e a landing mostra a mesma coisa a qualquer um. Não há vazamento — o preço é
público por definição.

## Como validar

```bash
cd packages && pnpm verify
pnpm packages:publish:local
cd packages && pnpm consumer-check
pnpm install
pnpm verify
```

Com `make up` e `pnpm dev`:

1. Anônimo em `/` → banner, três cartões, `R$ 29,90/mês` e `R$ 299,00/ano`.
2. `/keys` → `/login`. Uma URL inexistente → `/account` → `/login`.
3. Clicar **Começar anual** → `/signup`. Cadastrar, abrir o link no Mailpit,
   entrar.
4. Cai em `/account`, com "Você escolheu o plano anual antes de criar a conta" e o
   botão anual primeiro.
5. Logado, abrir `/` → cabeçalho com "Sua conta".
6. Trocar um valor em `PLAN_PRICES` e rodar `pnpm billing:prices`: deve falhar
   mostrando o valor do contracts e o do provider.
