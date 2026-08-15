# Rotação de segredos

**Status:** entregue
**Decisões relacionadas:** DEC-101, DEC-102, DEC-103, DEC-098, DEC-073

## Problema

Trocar um segredo derruba quem o estava usando.

São três segredos e a mesma forma nos três. O `AUTH_JWT_SECRET` é capturado no
construtor do `AccessTokenService` e vira um `Uint8Array` que vive enquanto o
processo viver: trocá-lo invalida **todo access token em circulação de uma vez**,
e como o access token não é revogável (`CONTEXT.md`, "Access token") não existe
nem o consolo de a sessão sobreviver — todo mundo cai junto, no meio do que
estava fazendo. O `STRIPE_WEBHOOK_SECRET` é lido do ambiente na construção do
provider, então trocá-lo é um deploy em que algum evento cai no vão. E a
credencial de um nó é escrita no `httpd.conf` no boot, então trocá-la é recriar
o contêiner — o nó fica fora do ar entre um valor e o outro, e é durante essa
janela que a varredura de saúde o marca inalcançável.

Os dois primeiros ainda têm um problema anterior a esse: eles **são variáveis de
ambiente**. O cofre existe desde a DEC-098, roda contra o localstack e tem um
consumidor só. Um segredo no ambiente aparece em `docker inspect`, no `ps` de
quem tiver o PID e em todo dump de configuração que alguém colar num chamado.

## Escopo

Entra:

- `AUTH_JWT_SECRET` e `STRIPE_WEBHOOK_SECRET` saem do ambiente e passam a ser
  lidos do cofre por **referência**, como a credencial de nó já é.
- A porta `ISecretStore` passa a expressar a janela de rotação, **uma vez** — ela
  mora no submodule publicado, e desenhá-la para o item de hoje custaria dois
  bumps quebrados.
- `AccessTokenService` aceita dois segredos: assina com o corrente, verifica
  contra o corrente e o anterior.
- O plano de controle do nó aceita dois valores, e passa a recarregar sem
  reiniciar.

Não entra, explicitamente:

- **mTLS no plano de controle.** DEC-103 o adia com o motivo escrito. Nada aqui
  se aproxima dele: a DEC-073 já registrava que mTLS não reaproveita esquema de
  cabeçalho nenhum, então uma credencial melhor não adianta caminho.
- **Rotação da chave WireGuard do nó.** Ela invalida todo `.conf` já baixado; a
  DEC-095 só a detecta. Fora de escopo desde a DEC-098 e continua.
- **Rotação automática.** Quem escreve no cofre é uma pessoa ou o Secrets
  Manager configurado por fora. O sistema lê; ele nunca decide que é hora.
- **Rotação do `STRIPE_WEBHOOK_SECRET` sem reiniciar.** Ele é resolvido na
  construção do provider, de propósito — ver "Segurança".
- **Um cofre para o `DATABASE_URL` e o resto do ambiente.** Segredo é o que
  autentica alguém; uma URL de banco num ambiente que já é privado é outra
  conversa, e não é esta.

## Vocabulário

**Janela de rotação**, **valor corrente**, **valor anterior**, **segredo** — já
em `CONTEXT.md`, § Infraestrutura, escritos antes deste arquivo.

Nenhum termo novo alcança o schema: esta entrega não cria tabela nem coluna.
`exit_nodes.credential_ref` já existe e não muda.

## Comportamento

### A porta

```
Dado    uma referência que nunca foi escrita
Quando  alguém a lê
Então   a resposta é null
E       não é um valor vazio, que um chamador trataria como segredo
```

```
Dado    uma referência escrita uma vez
Quando  alguém a lê
Então   o valor corrente é o que foi escrito
E       o anterior é null — não houve rotação, e isso é dizível
```

```
Dado    uma referência escrita duas vezes
Quando  alguém a lê
Então   o corrente é o segundo valor
E       o anterior é o primeiro
```

```
Dado    uma referência escrita três vezes
Quando  alguém a lê
Então   o primeiro valor não é o corrente nem o anterior
E       quem ainda o apresenta é recusado
```

O último é a asserção que fecha a janela. Sem ele, "aceita dois" e "aceita todos
os que já existiram" passam pelos mesmos testes.

### O access token

```
Dado    o segredo de assinatura rotacionado uma vez
Quando  um token emitido antes da rotação é apresentado
Então   ele é aceito, pelo valor anterior
```

```
Dado    o segredo rotacionado duas vezes
Quando  um token assinado com o valor de duas rotações atrás é apresentado
Então   a resposta é TOKEN_INVALID
```

```
Dado    um token assinado com o valor anterior, mas com outro issuer
Quando  ele é apresentado
Então   a resposta é TOKEN_INVALID
E       o mesmo vale para outra audience
```

Este é o caso de borda que vira teste em vez de comentário: um caminho de
fallback que só reconfere a assinatura larga o issuer e a audience sem que nada
fique vermelho.

```
Dado    um token expirado, assinado com o valor corrente
Quando  ele é apresentado
Então   a resposta é TOKEN_EXPIRED, não TOKEN_INVALID
```

A expiração não depende da chave. Tentar o valor anterior depois de um
`ERR_JWT_EXPIRED` troca a resposta certa por uma errada, e o usuário lê "seu
token não é válido" quando o que aconteceu foi ele ter ficado velho.

```
Dado    AUTH_JWT_SECRET presente no ambiente com um valor diferente
Quando  a API emite e verifica um token
Então   o que vale é o valor do cofre
```

```
Dado    AUTH_JWT_SECRET_REF apontando para uma referência que não existe
Quando  a API sobe
Então   ela falha no boot, nomeando a referência
E       não sobe para falhar no primeiro login
```

### O plano de controle do nó

```
Dado    um nó com o valor corrente e o anterior configurados
Quando  um chamador apresenta qualquer um dos dois
Então   a resposta é 200
```

```
Dado    a janela fechada — só o corrente configurado
Quando  um chamador apresenta o valor aposentado
Então   a resposta é 401
E       o nó não foi reiniciado em nenhum dos dois passos
```

```
Dado    a frota inteira
Quando  um nó recebe a credencial do vizinho
Então   a resposta é 401
```

Esta última já existe (`check.sh`, cíclica `sa←na←eu←as←af←sa`) e é a que impede
cinco valores iguais de passarem por todo o resto do arquivo.

## Portas afetadas

`ISecretStore` muda de forma. `IExitNode` e `IBillingProvider` **não** —
se a rotação tivesse chegado a qualquer uma das duas, o segredo teria vazado
para a porta, que é o teste que o `libs/adapters/CLAUDE.md` já tinha escrito.

- [x] Interface em `@vpn/ports` — sem bloco de comentário (DEC-013)
- [x] Suíte de conformidade em `@vpn/testing/contracts`, escrita **antes** do adapter
- [x] Adapter in-memory (`MemorySecretStore`, que é também o fake da suíte)
- [x] Adapter real (`SecretsManagerSecretStore`, contra o localstack)
- [x] Wiring em `adapters.module.ts` com a variável de ambiente que escolhe

`read(ref)` devolve `{ current, previous } | null` em vez de `string | null`.
Um método só, e não um `read` ao lado de um `readAll`: um `read` que devolve
calado só o corrente, ao lado de um irmão que sabe da janela, é exatamente a
forma que produziu o problema — um valor capturado, e ninguém reparando. Com a
janela no tipo de retorno, nenhum chamador pode ignorar que ela existe.

`{ current, previous }` corresponde a `AWSCURRENT`/`AWSPREVIOUS` sem nomear a
AWS, e é o que o provider real garante — uma lista prometeria mais do que ele
entrega.

## Banco

Nada. Nenhuma tabela, nenhuma coluna, nenhuma migration.
`exit_nodes.credential_ref` já existe desde a DEC-090 e é lida desde a DEC-098.

## Idempotência

Ler um segredo não muda nada, então não há reentrega a tornar segura.

O que **é** reentregável é a rotação de um nó, que no devstack é um script:
escrever o mesmo par de valores duas vezes produz o mesmo `httpd.conf` e um
segundo `SIGHUP` que recarrega o mesmo conteúdo. E o `put-secret-value` do
Secrets Manager com o valor que já é corrente cria uma versão nova e empurra a
anterior — então rodar o script duas vezes com o mesmo valor **fecha a janela**.
Isso é correto e é o único jeito de fechá-la, mas é a razão de o script pedir os
dois valores explicitamente em vez de descobri-los.

## Segurança

- **Vaza a existência de uma conta?** Não se aplica. Nada aqui atende requisição
  não autenticada, e a única resposta que muda de forma é 401 contra 200 no
  plano de controle, que não tem conta nenhuma do outro lado.
- **Que token é gerado?** Nenhum novo. O access token continua HS256, 15 min,
  não revogável — o que muda é contra quantas chaves ele é conferido.
- **Que sessões precisam morrer?** **Nenhuma, e esse é o ponto.** Hoje trocar o
  segredo mata todas; a janela existe para que não mate.
- **O segredo sai do ambiente.** É o item 1 inteiro. `AUTH_JWT_SECRET` e
  `STRIPE_WEBHOOK_SECRET` deixam de existir como variáveis; o que fica é o
  **nome** de onde o valor mora. Um teste negativo cobra isso: com o valor antigo
  presente no ambiente, o que vale é o cofre.
- **Sem caminho de fallback**, na mesma leitura da DEC-098. `SECRETS_DRIVER`
  perde `memory`, e a API recusa subir sem alcançar o cofre. Um driver de memória
  semeado do ambiente teria mantido o ambiente como fonte de segredo, que é
  precisamente o que esta entrega remove.
- **O segredo do webhook é resolvido na construção do provider, nunca por
  requisição.** A assinatura cobre os **bytes exatos** recebidos, e qualquer
  coisa que releia ou reserialize o corpo para buscar um segredo de outro jeito
  falha só contra o provider real — nunca contra uma fixture.
  `verifyWebhookSignature(rawBody, sig)` continua síncrona e continua recebendo a
  mesma string. O preço é que rotacionar esse segredo pede um restart da API, e
  ele está dito em voz alta aqui e na DEC-101.
- **O cache do segredo é um `Map` em processo, com TTL de 300s, e nunca o
  `ICacheStore`.** Invariante da DEC-098, preservada palavra por palavra ao mover
  o cache para um decorator: o Redis do devstack roda sem `requirepass` e com AOF
  em disco, então cachear ali seria mudar o segredo de lugar em vez de protegê-lo.
  A ausência **nunca** é cacheada — a correção é alguém criar o segredo, e isso
  deve valer na leitura seguinte.
- **A rotação não estreita nada no nó.** O `busybox httpd` compara com `strcmp`,
  que não é de tempo constante. É pré-existente, não é introduzido aqui, e está
  registrado na DEC-102 como o que continua valendo.
- **Dois formatos de valor são proibidos** e um teste os recusa: um valor que
  começa com `$` seguido de dígito é lido pelo busybox como hash de `crypt`, e um
  que contenha `:` parte o campo do `httpd.conf` ao meio. Nos dois casos o nó
  sobe e recusa todo mundo, e o sintoma é um 401 que não aponta para a causa.

## Como validar

```bash
pnpm verify
cd packages && pnpm verify && pnpm consumer-check
pnpm packages:publish:local

pnpm --filter @vpn-poc/adapters test:integration
pnpm --filter @vpn-poc/api test:integration
pm2 stop worker && pnpm --filter @vpn-poc/api test:e2e
make check
```

A janela do nó, à mão, que é o passo que transforma leitura de código em medida:

```bash
cd devstack
NEW=$(openssl rand -hex 24); OLD=$(docker compose exec -T localstack \
  awslocal secretsmanager get-secret-value --secret-id poc-vpn/exit-node/eu \
  --query SecretString --output text --region us-east-1 | tr -d '\r\n')

# abre a janela
docker compose exec -T wireguard-eu /rotate.sh "$NEW" "$OLD"
curl -so /dev/null -w '%{http_code}\n' -u "worker:$OLD" http://127.0.0.1:21841/cgi-bin/describe  # 200
curl -so /dev/null -w '%{http_code}\n' -u "worker:$NEW" http://127.0.0.1:21841/cgi-bin/describe  # 200

# fecha a janela, sem reiniciar
docker compose exec -T wireguard-eu /rotate.sh "$NEW"
curl -so /dev/null -w '%{http_code}\n' -u "worker:$OLD" http://127.0.0.1:21841/cgi-bin/describe  # 401
docker compose ps wireguard-eu   # o uptime não zerou
```

A janela do access token, à mão:

```bash
# entre pela web, guarde o access token, e então:
cd devstack && docker compose exec -T localstack awslocal secretsmanager put-secret-value \
  --secret-id poc-vpn/auth/jwt-secret --secret-string "$(openssl rand -hex 32)" --region us-east-1
# espere o TTL de 300s (ou reinicie a API) e recarregue a tela: continua dentro.
# rotacione de novo, espere de novo: agora o token original é recusado.
```
