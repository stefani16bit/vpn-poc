# Ambiente local

## 1. Do zero

```bash
git clone --recurse-submodules <url> poc-vpn
cd poc-vpn
cp .env.example .env.local

make up                      # sobe os 7 contêineres e espera ficarem saudáveis
make check                   # 14 asserções; tem que dar 14/14

pnpm install
pnpm packages:publish:local  # publica @vpn/* no Verdaccio local
pnpm db:migrate              # só aqui: sem node_modules, o `make up` acima pulou
pnpm dev                     # api :3000, web :5173
```

Se clonou sem `--recurse-submodules`: `git submodule update --init`.

Depois desta primeira vez, `make up` e `make reset` migram sozinhos. `make reset`
apaga o volume do postgres, e um banco sem schema derruba toda requisição no
mesmo erro — `relation "accounts" does not exist`.

## 2. Os contêineres

| Serviço      | Porta         | Para quê                                                  |
| ------------ | ------------- | --------------------------------------------------------- |
| postgres 17  | 25432         | banco                                                     |
| redis 7.4    | 26379         | `ICacheStore`                                             |
| verdaccio 6  | 24873         | registry de `@vpn/*` — <http://localhost:24873>           |
| localstack 4 | 24566         | S3, SQS, SNS, Secrets Manager                             |
| localstripe  | 28420         | API do Stripe (sem Checkout, DEC-009)                     |
| mailpit      | 21025 / 28025 | SMTP + caixa de entrada — <http://localhost:28025>        |
| caddy        | 20080 / 20443 | TLS e roteamento por Host — `https://app.localhost:20443` |

Portas no intervalo 2xxxx de propósito (DEC-010): três projetos irmãos dividem
esta máquina e todos queriam a 5432.

## 3. Comandos do devstack

```bash
make up               # sobe e espera
make down             # para
make reset            # apaga volumes e sobe de novo — os pacotes publicados
                      # sobrevivem (o storage do Verdaccio é bind mount)
make reset-registry   # o opt-in explícito para apagar os pacotes também
make reload s=caddy   # depois de editar um config montado
make logs s=postgres
make check
```

`make reload` existe porque editar um arquivo montado não recria o contêiner:
`up` continua servindo o arquivo anterior e a edição parece não ter efeito.

## 4. Rodando os testes

```bash
pnpm test                                          # unitários; Docker parado tudo bem
pnpm --filter @vpn-poc/adapters test:integration   # adapters reais contra o devstack
pnpm --filter @vpn-poc/api test:e2e                # o fluxo inteiro
pnpm verify                                        # lint + typecheck + unitários
```

Os suítes de integração compartilham um banco e um Redis, então rodam num worker
só. Limpam com `DELETE` porque o papel da aplicação não tem TRUNCATE (DEC-005).

**Pare o `worker` antes de rodar o e2e:** `pm2 stop worker`. O relay dele varre o
**mesmo** `outbox` que o e2e escreve, com `for update skip locked`, então ele
reivindica linhas que o teste ia reivindicar — e o sintoma não é um erro claro, é
um e-mail que não chega ou uma contagem de linhas que não bate, num teste
diferente a cada corrida. O e2e fixa `QUEUE_DRIVER=memory` para não dividir fila
com ninguém, mas a tabela é do banco e continua compartilhada.

## 5. Mexendo em `packages/`

`packages/` é um submodule com workspace próprio, consumido do Verdaccio e não
por caminho (DEC-002). Depois de mudar algo lá:

```bash
cd packages
# suba a version do pacote alterado
pnpm build && pnpm test
pnpm publish:local
pnpm consumer-check          # instala os tarballs FORA do workspace e importa

cd ..
pnpm install                 # o repo principal pega a versão nova
```

`consumer-check` é o que pega `files` errado, subpath faltando em `exports` e
dependência declarada como dev — coisas que funcionam dentro do workspace e só
quebram para quem consome.

## 6. Fluxo manual completo

1. <http://127.0.0.1:5173/signup> → cadastre um e-mail qualquer
2. <http://localhost:28025> → abra a mensagem, clique no link
3. Entre com a senha
4. Assine — ver a seção 7, que tem dois modos
5. "Esqueci minha senha" → mailpit → redefinir → entrar com a senha nova

## 7. Cobrança: os dois modos

O localstripe **não** implementa `/v1/checkout/sessions` (nem `/v1/prices`; só
`/v1/plans`). Medido: as duas rotas respondem `404 text/plain`, e um corpo que
não é JSON é o que o SDK do Stripe relata como _"Invalid JSON received from the
Stripe API"_. Por isso `BILLING_DRIVER=stripe` apontado para o mock é **recusado
no boot**, com a mensagem dizendo o que fazer. DEC-009.

### 7.1 Offline (`BILLING_DRIVER=memory`) — o padrão

Assinar redireciona para a própria app, e a ativação chega por um script que
assina o envelope e faz `POST /billing/webhook` — a rota real, com verificação de
assinatura, deduplicação e invalidação de cache de verdade.

```bash
pnpm billing:activate                              # a única account que existe
pnpm billing:activate activate --email ada@ex.com   # com mais de uma
pnpm billing:activate past-due --email ada@ex.com   # perde o tier na requisição seguinte
pnpm billing:activate renew    --email ada@ex.com
pnpm billing:activate cancel   --email ada@ex.com
pnpm billing:activate payment-failed --email ada@ex.com
```

Depois de `activate`: a página mostra **Ativa** e `GET /entitlements` responde
`tier: "pro"`. Depois de `past-due`, tier nenhum — é o cache invalidado pelo
webhook, e é o que a DEC-037 existe para garantir.

**O botão Cancelar da tela falha neste modo**, e isso é correto: ele chama
`cancelSubscription` no fake que a API montou, que nunca criou essa assinatura, e
um provider a quem se pede o cancelamento de um id que ele não conhece deve
recusar — um fake tolerante divergiria do adapter do Stripe, que é exatamente o
que a suíte de conformidade impede. Use `pnpm billing:activate cancel`.

### 7.2 Stripe de verdade, em test mode — o fluxo de produção

Não existe página de checkout local: em test mode o Stripe devolve uma URL
`checkout.stripe.com` de verdade, e a CLI entrega os webhooks assinados no
localhost. Isto exercita cada linha que roda em produção — sessão, página
hospedada, assinatura do webhook, normalização do evento.

```bash
stripe login                       # uma vez, contra sua conta em test mode
pnpm billing:prices                # cria produto e os dois preços, imprime os ids
stripe listen --forward-to localhost:3000/billing/webhook
```

No `.env`, com o `whsec_...` que o `listen` imprimiu:

```bash
BILLING_DRIVER=stripe
STRIPE_API_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...          # do billing:prices
STRIPE_PRICE_ID_YEARLY=price_...
# STRIPE_API_BASE fica fora: ele só existe para o mock
```

Reinicie a API (ela lê o `.env` no boot) e assine com o cartão `4242 4242 4242
4242`, qualquer validade futura, qualquer CVC. A CLI mostra
`customer.subscription.created` sendo encaminhado, e a página passa a **Ativa**.

Para a dunning, sem tocar em nada à mão:

```bash
stripe trigger invoice.payment_failed
stripe trigger customer.subscription.updated
```

`STRIPE_API_BASE` continua existindo para a suíte de integração dos adapters, que
lê `process.env` com o default do localstripe e não passa pela validação de env —
então tirá-lo do `.env` não muda nada nos testes.

## 8. Quando algo não sobe

- **`make check` falha em postgres:** o volume pode ter ficado de uma versão
  anterior do `01-roles.sql`. `make reset`.
- **`permission denied for table X`:** o papel `vpn_app` não tem TRUNCATE e não
  vai ter (DEC-005). Use `DELETE`.
- **Erro de caminho no docker, no Git Bash:** `MSYS_NO_PATHCONV=1` antes do
  comando. `dev.sh` e `check.sh` já fazem isso.
- **`@vpn/...` não encontrado:** o Verdaccio está no ar mas os pacotes não foram
  publicados. `pnpm packages:publish:local`.
- **Login funciona e refresh não:** `credentials: 'include'` no cliente e
  `WEB_ORIGIN` no CORS do servidor precisam bater — e o **host** também.
  O cookie de refresh é `SameSite=Lax`, então `WEB_ORIGIN`, `VITE_API_URL` e o
  `server.host` do Vite precisam usar o mesmo: `localhost` e `127.0.0.1` são
  sites diferentes para o navegador, e o cookie é gravado no login e nunca mais
  enviado. Tudo aqui é `127.0.0.1` (DEC-032).
