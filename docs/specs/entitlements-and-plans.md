# Entitlements e planos

**Status:** em implementação
**Decisões relacionadas:** DEC-036, DEC-037, DEC-043, DEC-054, DEC-055

## Problema

Assinar não desbloqueia nada. A autorização de hoje tem uma dimensão só — a
`role`, que diz o que **esta pessoa** pode fazer — e nenhuma que diga o que **a
empresa contratou**. Não há onde ler isso, e por isso não há onde aplicá-lo.

O que torna a segunda dimensão diferente da primeira é quem muda o dado. A role
muda por ação nossa, e a rotação de família já a propaga. O entitlement muda por
ação do provider: um pagamento falha e a account precisa perder acesso **agora**,
não em até quinze minutos — que é o que custaria colocá-lo no access token, que
vive 15 minutos e não é revogável (DEC-037).

## Escopo

**Entra:** o mapa de entitlements em `@vpn/contracts` com **um** tier pago
(`pro`); o par tier × cadence virando os tipos que já deveriam existir; a leitura
por requisição a partir da subscription, com cache via `ICacheStore`; a
invalidação dessa entrada pelo webhook; um guard de capability no kernel; e
`GET /entitlements`, para o cliente saber o que pedir e o que esconder.

**Não entra:**

- **Seats e `devicesPerUser`.** Com um tier só não há o que aplicar, e a DEC-043
  já registra o mecanismo para quando houver: restrição de banco ou linha
  travada, nunca `count()` seguido de `INSERT`. Meio-aplicar um contador é pior
  que não aplicá-lo, porque parece aplicado.
- **Região e tráfego.** Aplicados no provisionamento de peer e na medição
  contínua; dependem de um data plane que não existe. Estão no **tipo** para os
  tiers anunciarem, e em lugar nenhum além dele.
- **Coluna `tier` na `subscriptions`.** Com um tier só ela seria uma constante, e
  nenhum evento do provider carrega tier para escrevê-la. DEC-054.
- **Override por account.** DEC-036 já decidiu: quando um cliente exigir, é uma
  tabela estreita de exceções lida por cima do mapa, não a inversão do mecanismo.
- **Reconciliação com o provider.** Se um webhook se perder, a projeção fica
  parada e a account continua entitulada. É dívida, está no roadmap, e o
  mecanismo é um job que pergunta ao provider — não um TTL menor.
- **Rota de produto atrás do guard.** Não existe nenhuma ainda: a primeira será a
  de chaves e conexão, e é lá que `@RequiresCapability('vpn_access')` ganha
  chamador. O guard entra agora porque é o momento de aplicação que a próxima
  feature pressupõe, não porque já tenha o que guardar.

## Vocabulário

**Entitlement**, **Capability**, **Seat**, **Tier**, **Cadence** — todos já em
`CONTEXT.md`. O que este trabalho acrescenta lá:

- o nome do tier que existe (`pro`) e o da capability que existe (`vpn_access`);
- **account sem tier** — a que não tem subscription em estado que dê acesso. O
  mapa não a cobre; `UNSUBSCRIBED_ENTITLEMENTS` é o conjunto explícito dela;
- o cache guarda o **tier**, não os entitlements.

## Comportamento

```
Dado    uma account sem assinatura
Quando  o cliente pede GET /entitlements
Então   a resposta é 200 com tier null e nenhuma capability
```

```
Dado    uma account cujo GET /entitlements já foi lido (cache quente, tier null)
Quando  chega o webhook subscription_activated
Então   a leitura seguinte devolve tier "pro"
```

```
Dado    uma account "pro" cujo GET /entitlements já foi lido (cache quente)
Quando  chega subscription_updated com status past_due
Então   a leitura seguinte devolve tier null e nenhuma capability
```

Estes dois são o item inteiro: sem a invalidação, os dois continuam devolvendo o
valor anterior por até o TTL. Removê-la tem que deixar os dois vermelhos.

```
Dado    uma account "pro"
Quando  chega payment_failed e nada mais
Então   a leitura seguinte continua devolvendo tier "pro"
```

Porque `payment_failed` não carrega subscription — carrega
`externalCustomerId` — e por isso não escreve estado nenhum. Quem revoga é a
mudança de status, que o provider manda em seguida. A entrada do cache é
invalidada de todo jeito: a invalidação segue o evento aplicado, não o palpite
sobre qual evento importa.

```
Dado    uma account "pro" e um evento subscription_updated atrasado
Quando  o evento chega depois de um mais novo
Então   a guarda monotônica do upsert não move a linha
E       a leitura seguinte continua devolvendo o tier do evento mais novo
```

```
Dado    duas accounts, uma "pro" e uma sem assinatura
Quando  as duas leem GET /entitlements
Então   cada uma vê o seu, porque a chave do cache tem a account como owner
```

```
Dado    uma rota anotada com @RequiresCapability('vpn_access')
Quando  uma account sem tier a chama
Então   a resposta é 402 com código PAYMENT_REQUIRED
```

```
Dado    uma rota anotada com @RequiresCapability sem AccessTokenGuard
Quando  ela é chamada
Então   o erro é INTERNAL, porque não há account de quem ler entitlement
```

## Portas afetadas

Nenhuma porta nova. `ICacheStore` já tem `get`, `set` e `delete`, já tem suíte de
conformidade, e é a porta que a DEC-037 nomeia. Duas observações sobre ela:

- `delete` de chave única é o **único** primitivo de remoção — não há varredura
  por prefixo. Por isso quem invalida precisa remontar o triplo
  `{ owner, namespace, id }` idêntico, e por isso ele é construído por uma função
  só, exportada.
- `owner` finalmente carrega tenant. Até aqui todo chamador passava `null`, e o
  campo existia como promessa; a entrada de entitlement é a primeira cujo dono
  faz parte do tipo da chave.

## Banco

Nenhuma tabela nova e nenhuma coluna nova. A `subscriptions` já tem tudo de que a
leitura precisa: `status` é o que resolve o tier (DEC-054), e `account_id` é a PK,
então "uma subscription por account" já é restrição.

Quem escreve continua sendo o webhook, como sistema. Quem lê passa a ser também o
kernel, sob a policy de tenant — a linha da própria account, que a policy já
deixa visível.

## Idempotência

A leitura não escreve nada além do cache, e escrever a mesma entrada duas vezes é
o mesmo que escrevê-la uma.

A invalidação é idempotente por natureza: apagar uma chave ausente é um no-op. Ela
roda **depois** do commit, e a ordem importa nos dois sentidos. Antes do commit,
uma requisição concorrente leria a linha pré-commit e reescreveria o cache com o
valor velho — invalidação perdida. Depois do commit, uma queda entre o commit e o
`delete` deixa a entrada velha de pé até o TTL: é o pior caso, ele é limitado, e é
o preço de não ter transação distribuída sobre o Redis.

O webhook em si já era idempotente pelo índice único `(source, external_event_id)`
— uma reentrega não é aplicada e portanto não invalida, o que é correto: não há o
que invalidar quando nada mudou.

## Segurança

- **Vaza a existência de uma conta?** Não: `GET /entitlements` exige access token
  válido, e responde sobre a account do token. Não há parâmetro de account, então
  não há o que enumerar.
- **Que token é gerado?** Nenhum. E deliberadamente **nenhuma claim nova**: pôr
  entitlement no JWT é escolher uma janela de quinze minutos de acesso pago não
  pago (DEC-037).
- **Que sessões precisam morrer?** Nenhuma. Perder um entitlement não é perder a
  sessão: a pessoa continua autenticada, só não pode mais fazer aquilo. É
  exatamente por isso que o dado não mora no token.
- O gate é **servidor**. A UI esconder o que a account não tem é cortesia; o
  cliente que pede é código do usuário.

## Como validar

```bash
sh devstack/dev.sh up && sh devstack/check.sh
pnpm verify
pnpm --filter @vpn-poc/api test:integration
pnpm --filter @vpn-poc/api test:e2e                 # inclui "entitlements"
```

Depois, para provar que a invalidação é a peça que segura tudo: apague a chamada
`entitlements.invalidate(...)` de `BillingService.handleWebhook`, rode o e2e e
confira que os dois cenários de cache quente ficam vermelhos servindo o tier
anterior. Reponha.

No navegador, com `pnpm dev`: entrar, ver a página de cobrança listando o que o
`pro` inclui — o mapa é `@vpn/contracts`, o mesmo que a API usa — e assinar.
