# Ambiente local

## 1. Do zero

```bash
git clone --recurse-submodules <url> poc-vpn
cd poc-vpn
cp .env.example .env.local

make up                      # sobe os 8 contêineres e espera ficarem saudáveis
make check                   # 53 asserções; tem que dar 53/53

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
| localstack 4 | 24566         | S3, SQS, SNS, Secrets Manager — a credencial de cada nó   |
| localstripe  | 28420         | API do Stripe (sem Checkout, DEC-009)                     |
| mailpit      | 21025 / 28025 | SMTP + caixa de entrada — <http://localhost:28025>        |
| caddy        | 20080 / 20443 | TLS e roteamento por Host — `https://app.localhost:20443` |
| wireguard-sa | 21820/udp     | nó de saída — o túnel, `docs/specs/data-plane.md`         |
| wireguard-sa | 21821         | agente de controle do nó — exige credencial (DEC-073)     |
| wireguard-na | 21830 / 21831 | mesma dupla, para a região seguinte                       |
| wireguard-eu | 21840 / 21841 | idem                                                      |
| wireguard-as | 21850 / 21851 | idem                                                      |
| wireguard-af | 21860 / 21861 | idem                                                      |

Portas no intervalo 2xxxx de propósito (DEC-010): três projetos irmãos dividem
esta máquina e todos queriam a 5432.

São **cinco** nós, um por região demonstrada, e só o `sa` entra na rede do
canário. É essa assimetria que faz a região significar alguma coisa: uma chave
criada nela alcança o recurso privado e uma criada em qualquer outra não. Cada
nó tem par de chaves e faixa de túnel próprios — chave repetida colide no índice
`(account_id, public_key)`, e faixa repetida faria dois nós entregarem o mesmo
endereço para redes que não se conhecem.

As portas UDP são as únicas da lista cujo publish atravessa a VM do WSL2 por um
caminho diferente do de TCP. Se o contêiner sobe e o handshake não acontece, é aí
que se olha primeiro — ver §8.

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
5. **Dispositivos e chaves** → gere um device; o `.conf` baixa na hora e o peer
   aparece no nó em segundos. O plano de controle pede credencial, então a consulta
   à mão leva a do `.env`:

   ```bash
   TOKEN=$(docker compose exec -T localstack awslocal secretsmanager get-secret-value \n     --secret-id poc-vpn/exit-node/sa --query SecretString --output text)
   curl -s -u "worker:${TOKEN}" http://127.0.0.1:21821/cgi-bin/peers
   ```

6. "Esqueci minha senha" → mailpit → redefinir → entrar com a senha nova

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
stripe listen --forward-to 127.0.0.1:3000/billing/webhook
```

**`127.0.0.1` e não `localhost`, e aqui isso não é estilo.** A CLI do Stripe
resolve `localhost` e tenta `::1` primeiro, exatamente como o Node faz (DEC-032).
A API sobe em `0.0.0.0:3000` **só em IPv4**, então qualquer outro dev server desta
máquina que suba dual-stack fica dono do `[::]:3000` — e o Windows deixa os dois
coexistirem, porque as famílias de socket são diferentes e nenhum vê "porta em
uso". O sintoma é a CLI reportando **404 em todo evento**, encaminhado para um
processo que não é este, com a assinatura nunca ativando e nada aparecendo no log
da API. `netstat -ano | grep :3000` mostra os dois donos.

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
- **O túnel não conecta e não está claro por quê:** `pnpm tunnel:doctor`. Ele
  compara os quatro lados — os peers que o nó conhece, os devices no banco, os
  túneis ativos nesta máquina e o canário — e diz qual não bate. O caso mais
  comum é um
  túnel importado no cliente cujo device foi revogado ou perdido num `reset` do
  banco: o cliente continua **Up**, o nó não conhece mais a chave, e todo pacote
  é descartado em silêncio. A saída nomeia o túnel e manda apagá-lo.
- **A CLI do Stripe responde 404 em todo evento e a assinatura nunca ativa:**
  ela está encaminhando para outro processo. Aconteceu de verdade: um dev server
  de outro projeto desta máquina segurava `[::]:3000` enquanto a API segurava
  `0.0.0.0:3000` em IPv4, e `--forward-to localhost:3000` foi para o vizinho.
  Encaminhe para `127.0.0.1:3000` e confira com `netstat -ano | grep :3000` — dois
  PIDs ali é o diagnóstico. Um `POST` à mão distingue os dois em um segundo: a
  API responde **403** (assinatura inválida), o vizinho responde **404**.
  Depois de consertar, `stripe events resend <evt_...>` recupera o que se perdeu;
  nada aqui reconcilia com o provider sozinho.
- **`@vpn/...` não encontrado:** o Verdaccio está no ar mas os pacotes não foram
  publicados. `pnpm packages:publish:local`.
- **O device fica "liberando o acesso" para sempre:** o job de provisionamento
  não chegou ao nó. `pnpm tunnel:doctor` distingue os dois casos que parecem
  iguais na tela — worker parado (`pm2 start worker`) e job morto na DLQ com o
  peer já no nó. O segundo é reparado pela varredura sozinha, passados 120s desde
  a criação da linha: ela repõe o peer se faltar e carimba `provisioned_at`. O
  worker varre a cada 5 min, então o pior caso é ~7 min. DEC-074.
- **Toda chamada ao nó responde 401:** o segredo em `poc-vpn/exit-node/<nó>` não
  é o token com que aquele contêiner subiu. Os dois lados vêm de lugares diferentes de
  propósito — o compose lê o `.env` de `devstack/`, que não existe, e usa o default
  dele — então uma divergência é possível. `sh devstack/check.sh` tem uma asserção
  exatamente para isso, e `sh devstack/dev.sh up` recria o nó com o valor atual.
  DEC-073.
- **O contêiner do wireguard está saudável e o handshake não acontece:** o
  healthcheck afirma que `wg0` existe e que o plano de controle cobra credencial,
  e as duas coisas ficam verdes sem nenhum pacote atravessando o túnel. Confirme
  o mapeamento com
  `docker compose port --protocol udp wireguard-sa 51820` e olhe o nó com
  `docker compose exec wireguard-sa wg show wg0` — sucesso é `latest handshake` mais
  `transfer` diferente de zero **nos dois sentidos**. Se o mapeamento existe e
  nada atravessa, tente o `Endpoint` pelo IP da VM do WSL2
  (`wsl -d docker-desktop -e ip -4 -o addr show eth0`), que muda a cada reboot.
  `docs/specs/data-plane.md`.
- **`pnpm build` dentro de `packages/` compila o repo principal:** um shell que já
  rodou nx na raiz exporta `NX_WORKSPACE_ROOT_PATH`, e o nx do submodule obedece a
  variável em vez do `nx.json` ao lado dele. Ele tenta construir `@vpn-poc/api` e
  erra em `rootDir`, deixando `.js` e `.d.ts` emitidos dentro de `libs/*/src` — que
  o `format:check` depois reprova. `unset NX_WORKSPACE_ROOT_PATH` antes, e
  `git clean -f libs/*/src` para limpar o que já saiu.
- **Login funciona e refresh não:** `credentials: 'include'` no cliente e
  `WEB_ORIGIN` no CORS do servidor precisam bater — e o **host** também.
  O cookie de refresh é `SameSite=Lax`, então `WEB_ORIGIN`, `VITE_API_URL` e o
  `server.host` do Vite precisam usar o mesmo: `localhost` e `127.0.0.1` são
  sites diferentes para o navegador, e o cookie é gravado no login e nunca mais
  enviado. Tudo aqui é `127.0.0.1` (DEC-032).

## 9. A prova do túnel

O `make check` afirma que o nó está de pé e que o plano de controle cobra
credencial. As duas coisas ficam verdes com zero pacote atravessando. O que
responde **"o túnel carrega tráfego?"** é o canário: uma página e um
`GET /api/hello` numa sub-rede sem porta publicada, alcançável só pelo túnel.
`docs/specs/tunnel-proof.md`, DEC-075.

Ele mora num repositório irmão, `poc-vpn-canary`, clonado ao lado deste. A rede é
declarada aqui — então `make up` funciona sem ele, e `make reset` destrói a rede
e obriga a subir o canário de novo.

```bash
cd ../poc-vpn-canary
docker compose up -d --build
```

### 9.1 O caminho automatizado

```bash
make up                    # a rede é deste repo; o canário a consome
pnpm dev                   # o provador precisa da API E do worker
pnpm billing:activate      # sem vpn_access, POST /devices responde 402

cd ../poc-vpn-canary && docker compose run --rm prover
```

O provador faz o ciclo inteiro num contêiner Linux — isolamento, login, criar a
chave como o navegador cria, esperar o peer no nó, conectar, alcançar o canário,
revogar, deixar de alcançar — e sai diferente de zero em qualquer passo.

É o **inverso** do e2e quanto ao worker: o e2e pede `pm2 stop worker` porque
disputa o `outbox` (§4), e o provador precisa do worker rodando, porque é ele
quem leva o peer até o nó. Os dois não rodam juntos.

### 9.2 O caminho do navegador, que nenhum comando faz

1. Crie uma chave em <http://127.0.0.1:5173> e importe o `.conf` pela **GUI do
   WireGuard for Windows**. `wg-quick up` não é o caminho do cliente nesta
   máquina, e `data-plane.md` é explícito que escrevê-lo como conselho é
   conselho não testado.
2. Abra <http://172.30.13.10>: "Hello", e o **seu próprio endereço de túnel** na
   tela. Desative o túnel, recarregue: nada.
3. Com o túnel ainda ativo, revogue o device na web e recarregue. Tem que morrer
   em poucos segundos — é o que prova que o portão é a lista de peers do nó, e
   não o cliente sendo educado.

Se a página mostrar `seenFrom: 10.13.13.1`, o canário está vendo o **nó** e não o
device:

```bash
docker compose exec wireguard-sa iptables -t nat -S POSTROUTING
```

`RETURN` tem que aparecer antes do `MASQUERADE`. O `make check` tem uma asserção
para exatamente essa ordem, e o `tunnel:doctor` diagnostica o mesmo caso.
