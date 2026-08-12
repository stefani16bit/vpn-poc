# Permissões por account e por pessoa

**Status:** entregue
**Decisões relacionadas:** DEC-080, DEC-081, supera DEC-079 · compõe com DEC-070, DEC-036, DEC-055

## Problema

O produto é whitelabel, e empresas diferentes discordam sobre quem pode o quê. Uma
quer que qualquer funcionário gere a própria chave de VPN; a outra quer que só o
suporte gere, porque cada chave é um dispositivo a mais para auditar. Hoje a
resposta é a mesma para as duas: está escrita em `hasAtLeastRole`, e mudá-la é
deploy.

`hasAtLeastRole` responde **"quem é mais forte"**. A pergunta que o produto faz é
**"esta empresa deixa esta pessoa fazer isto"**. Rank não expressa isso: não há
ordenação em que "member gera chave, admin não gere cobrança" caiba, e toda role
nova obriga a reabrir o mapa de ranks e reavaliar cada `>=` já escrito.

A DEC-079 fechou um furo real — um member cancelava a assinatura da empresa — com
a ferramenta que existia. Ela deixou dois portões (`admin` em `/users`, `owner` em
cobrança) cuja diferença é o **assunto**, não a força. Rank é a formulação errada
dos dois.

## Escopo

**Entra:**

- Conjunto fechado de permissões em `@vpn/contracts`, com o mapa de padrões por role.
- `role_permissions` e `user_permissions`, sob RLS.
- `PermissionService` no kernel, com cache, e `@RequiresPermission` + `PermissionGuard`.
- Migração dos portões que existem: `/users`, cobrança e `POST /devices`.
- `GET /permissions`, o hook `useHasPermission`, e a tela que edita as concessões.

**Não entra, explicitamente:**

- **Roles criadas pelo cliente.** `owner|admin|member` seguem sendo um enum. O que
  vira dado é a permissão. O schema fica aditivo: `role` vira FK para uma tabela
  depois, sem tocar em `role_permissions`.
- **Permissão como escopo.** `GET /devices` e `DELETE /devices/:id` continuam
  resolvidos por posse (DEC-070). Um portão ali destruiria a distinção.
- **Herança entre roles.** Não há "admin herda member". Cada role tem o seu
  conjunto, e o mapa de padrões escreve os três por extenso.
- **Permissão por recurso.** `devices.create` é "pode criar dispositivo", nunca
  "pode criar _este_ dispositivo". Sobre quais linhas é escopo.

## Vocabulário

Já em `CONTEXT.md` §Autorização — **Permission**, **Role permission**,
**User permission** —, e **Role** reescrito: ela deixa de ser "o que a pessoa pode
fazer" e passa a ser "o endereço onde essa resposta é procurada".

O conjunto fechado:

| Permissão            | Rota                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| `billing.manage`     | `POST /billing/checkout`, `DELETE /billing/subscription`, `POST .../resume` |
| `users.read`         | `GET /users`                                                                |
| `users.create`       | `POST /users`                                                               |
| `users.update`       | `PATCH /users/:id`                                                          |
| `users.delete`       | `DELETE /users/:id`                                                         |
| `devices.create`     | `POST /devices`                                                             |
| `permissions.manage` | as rotas que editam concessões                                              |

Padrões (`DEFAULT_ROLE_PERMISSIONS`):

| Role     | Padrão                                                         |
| -------- | -------------------------------------------------------------- |
| `owner`  | todas                                                          |
| `admin`  | `users.*` e `devices.create` — gere pessoas, não gere dinheiro |
| `member` | `devices.create`                                               |

## Comportamento

```
Dado    uma account sem nenhuma linha em role_permissions
Quando  um member chama POST /devices
Então   a resposta é 201
E       o que decidiu foi DEFAULT_ROLE_PERMISSIONS, não uma linha
```

```
Dado    uma account com role_permissions (member, devices.create, granted = false)
Quando  um member dessa account chama POST /devices
Então   a resposta é 403 com código FORBIDDEN
E       um member de outra account, sem linhas, continua recebendo 201
```

```
Dado    uma account com role_permissions (member, users.read, granted = true)
Quando  o admin lê as permissões efetivas desse member
Então   o conjunto é devices.create mais users.read
E       a camada de role somou ao padrão em vez de substituí-lo
```

```
Dado    uma permissão nova acrescentada a DEFAULT_ROLE_PERMISSIONS.admin
Quando  uma account que já customizou a role admin é resolvida
Então   a permissão nova está no conjunto efetivo dela
E       customizar uma vez não congela o tenant fora do produto
```

```
Dado    Ana e Bruno, ambos member na mesma account
E       uma linha user_permissions (Ana, devices.create, granted = true)
Quando  os dois chamam POST /devices
Então   a da Ana é 201 e a do Bruno é 403
```

```
Dado    Ana member com user_permissions (Ana, devices.create, granted = false)
E       a role member concedendo devices.create
Quando  Ana chama POST /devices
Então   a resposta é 403
E       tirar por pessoa vence conceder por role
```

```
Dado    uma account com linhas escritas contra a role owner
Quando  o conjunto efetivo do dono é resolvido
Então   ele tem todas as permissões
E       as duas camadas de delta não o alcançam
```

```
Dado    um owner autenticado
Quando  ele chama PUT /permissions/roles/owner
Então   a resposta é 403
E       GET /permissions/grants descreve admin e member, nunca owner
```

```
Dado    uma account sem assinatura
Quando  alguém chama GET /users ou GET /permissions/grants
Então   a resposta é 402, não 403 — o problema é o plano, não a pessoa
E       GET /permissions e GET /billing/subscription continuam 200
```

```
Dado    uma account que perde o tier por past_due
Quando  o mesmo admin repete a chamada que respondia 200
Então   a resposta passa a 402
E       o nav some com dispositivos, usuários e permissões
```

```
Dado    um member cuja account concede devices.create
Quando  a account perde o tier por payment_failed
Então   POST /devices responde 402, não 403
E       o entitlement é checado antes da permissão: 402 antes de 403
```

```
Dado    um admin sem billing.manage
Quando  ele chama DELETE /billing/subscription
Então   a resposta é 403 com código FORBIDDEN
E       GET /billing/subscription continua respondendo 200 para ele
```

```
Dado    duas accounts, A e B, cada uma com linhas em role_permissions
Quando  uma conexão com app.account_id = A consulta a tabela
Então   ela lê zero linhas de B
```

```
Dado    uma linha em role_permissions com uma permissão que já não existe no código
Quando  o resolver monta o conjunto efetivo
Então   o valor desconhecido é ignorado
E       renomear uma permissão não derruba a account que a tinha
```

## Portas afetadas

Nenhuma dependência externa nova. `ICacheStore` já existe e já é usado pelo
`EntitlementsService`; a entrada nova é mais um `CacheKey`, não mais uma porta.

## Banco

As duas tabelas têm a **mesma forma**, porque são a mesma ideia em alturas
diferentes: uma linha é um desvio, e `granted` diz para que lado.

**`role_permissions`** — `account_id`, `role` (o enum `user_role`), `permission`
(`text`), `granted` (`boolean not null`). `unique (account_id, role, permission)`.
Escreve a tela de permissões; lê o `PermissionService`; `ON DELETE cascade` de
`accounts` a apaga.

**`user_permissions`** — `account_id`, `user_id`, `permission` (`text`), `granted`
(`boolean not null`). `unique (account_id, user_id, permission)`, FK composta
`(user_id, account_id) → users (id, account_id)`, que já existe como `unique()` e
não como `uniqueIndex()` — sem isso o drizzle-kit emite a FK antes do índice e
falha com `42830`. Escreve a tela; lê o serviço; cascade de `users` e de `accounts`.

As duas com `ENABLE ROW LEVEL SECURITY` e o par `_tenant`/`_system` gerado por
`scopedPolicies`, declaradas em `schema.ts` com `pgPolicy` e nunca em SQL à mão —
`0000_init` é regenerada e apaga SQL manual sem avisar (DEC-053).

`permission` é `text` e não `pgEnum`: o conjunto fechado mora em `@vpn/contracts`
(DEC-036), e um enum no banco custaria uma migração por permissão nova. A
integridade vem de `permissionSchema` na escrita e do resolver ignorando o
desconhecido na leitura.

## Idempotência

Conceder duas vezes é a mesma concessão: o `unique` é o mecanismo, e a escrita é um
`INSERT ... ON CONFLICT DO UPDATE SET granted = excluded.granted`. Não há `SELECT`
prévio — dois admins salvando a mesma tela ao mesmo tempo passariam juntos por ele
(inegociável nº 3).

Voltar uma permissão ao padrão **apaga a linha**, não grava uma terceira. É por
isso que a tela pode mostrar um booleano e não um tri-estado: o desvio existe
enquanto diverge, e some quando converge.

## Segurança

- **Não vaza existência de conta**: todas as rotas aqui são autenticadas.
- **Nenhum token novo.** As permissões não entram no JWT: um admin que tira uma
  concessão precisa que ela pare de valer agora, e não em até quinze minutos —
  tirar permissão não dispara rotação de família (DEC-037).
- **Nenhuma sessão precisa morrer**, pela mesma razão: a leitura é por requisição.
- **Bootstrap**: `owner` sempre tem `permissions.manage`, no resolver. Uma account
  não pode se trancar para fora, e a garantia não pode ser uma checagem na escrita
  — duas edições concorrentes a furam.
- **O guard é a fronteira; a tela é conveniência.** Esconder um botão não é
  autorização, e `authorization.guard.spec.ts` é o que impede a próxima rota de
  nascer confiando na tela.

## Como validar

```bash
pnpm verify
pnpm --filter @vpn-poc/api test:integration     # as duas policies novas
pm2 stop worker && pnpm --filter @vpn-poc/api test:e2e && pm2 start worker
cd packages && pnpm verify && pnpm consumer-check
```

E as três sondas que nenhum comando faz:

1. **O portão carrega peso.** Apague `@RequiresPermission` de `POST /devices` e
   rode o e2e: os 403 têm que virar 201. Mesma sonda da DEC-070.
2. **A permissão é do tenant.** Tire `devices.create` da role member numa account e
   deixe na outra. Mesma role, mesmo código, respostas diferentes.
3. **A permissão desce até a pessoa.** Ana e Bruno, ambos member na mesma account:
   devolva `devices.create` só à Ana. O formulário de chave aparece para ela e não
   para ele, e o `POST /devices` do Bruno responde 403.
