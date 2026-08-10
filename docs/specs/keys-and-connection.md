# Chaves e conexão

**Status:** entregue
**Decisões relacionadas:** DEC-035, DEC-036, DEC-043, DEC-045, DEC-052, DEC-055,
DEC-062, DEC-063, DEC-064, DEC-068, DEC-069, DEC-070, DEC-071

## Problema

Assinar concede `vpn_access` e nada consome. O `CapabilityGuard` está de pé,
coberto por unitário e **sem nenhum chamador de produção** — o roadmap registra
isso, e nomeia esta rota como a primeira a guardar. Enquanto ela não existe, a
cadeia inteira de entitlements é teoria com teste.

O spike anterior provou que esta máquina carrega um túnel e deixou escrito, na
§Banco de `docs/specs/data-plane.md`, que a tabela de chaves era do item
seguinte. Este é o item seguinte: a primeira superfície de produto, e o que faz
**Device** e **Peer** deixarem de ser vocabulário.

## Escopo

**Entra:** a porta do nó de saída com suíte de conformidade e dois adapters; um
agente de controle no nó do devstack; a tabela `devices` sob RLS; a rota que
provisiona, atrás de `@RequiresCapability('vpn_access')`; a reconciliação do peer
pelo outbox; e a página que gera o par, envia só a metade pública, monta o
`.conf` e o baixa.

**Não entra:**

- **Aplicação de `devicesPerUser`.** Com um tier só não há o que aplicar, e a
  DEC-043 é explícita sobre o mecanismo quando houver: restrição de banco ou
  linha travada, nunca `count()` seguido de `INSERT`. **Não há contador de
  fachada** — meio-aplicado parece aplicado, e é pior que ausente. Hoje uma
  account cria devices até a faixa `/24` acabar.
- **Regiões e metering.** Dependem de mais de um nó. `regions` continua
  anunciado no tier e aplicado em lugar nenhum.
- **Apps nativos.** DEC-041/042: compra é web, e o refresh nativo é outro
  caminho.
- **Rotação da chave do próprio nó.** Trocar a chave do nó invalidaria todo
  `.conf` já baixado, e não há como reemiti-los — é decisão de produto, não de
  schema. **Detectá-la** entrou depois: a descrição do nó é cacheada por 60s e
  uma chave que mudou sai em log de erro. DEC-068.
- **Túnel completo (`0.0.0.0/0`).** Ver §Segurança.

## Vocabulário

**Device**, **Peer**, **Exit node** e **Region** já estavam em `CONTEXT.md`. O
que este trabalho muda lá é a frase de fecho, e **só pela metade**: Device e Peer
passam a existir; Exit node e Region continuam não construídos, porque um nó
vindo de variável de ambiente não é uma frota.

Acrescentados: **Endereço no túnel** e **Revogado**.

## Comportamento

### O portão

```
Dado    uma account sem assinatura que dê tier
Quando  ela pede POST /devices
Então   a resposta é 402 com código PAYMENT_REQUIRED
E       nenhuma linha é criada
```

```
Dado    a mesma account depois do webhook de ativação
Quando  ela pede POST /devices
Então   a resposta é 201
```

Este par é o item inteiro do lado do servidor: é a primeira vez que
`@RequiresCapability` recusa alguém de verdade. Removê-lo tem que deixar os dois
casos de 402 vermelhos — foi assim que foram conferidos, e o `GET` está guardado
pelo mesmo motivo que o `POST`: listar devices de um plano que não existe
descreveria o que a pessoa não pode ter.

### Criar

```
Dado    um device sendo criado
Quando  a chave pública chega ao servidor
Então   ela é validada contra a forma que o wireguard produz
E       um corpo que traga qualquer campo além de name e publicKey perde o resto
```

```
Dado    dois devices criados ao mesmo tempo
Quando  os dois pedem endereço
Então   cada um recebe o seu, porque o índice único recusa o segundo
E       o perdedor tenta o próximo em vez de falhar
```

O mecanismo é o mesmo da colisão de slug (DEC-052): `on conflict do nothing
returning`, e conjunto vazio significa tomado. Um `SELECT count(*)` seguido de
`INSERT` é o `if (jáVimos)` que o inegociável nº 3 proíbe, e aqui os dois
processos concorrentes pediriam `10.13.13.4` juntos.

```
Dado    um device criado
Quando  a transação fecha
Então   a linha e a intenção device.provision estão nela, ou nenhuma das duas
```

```
Dado    a intenção publicada
Quando  o worker a consome
Então   o nó passa a listar a chave pública
E       provisioned_at deixa de ser nulo
```

Medido de ponta a ponta contra o nó real: `POST /devices` respondeu 201 com
`provisionedAt: null`, e cerca de três segundos depois a chave estava em
`wg show wg0 peers` com `allowed-ips 10.13.13.4/32`. **Nulo é "ainda não", nunca
"falhou"** — e é por isso que a tela diz que está liberando o acesso em vez de
dizer que está pronto.

```
Dado    um nó fora do ar
Quando  o worker tenta provisionar
Então   o job não é reconhecido e volta para a fila
```

### Revogar

```
Dado    um device ativo
Quando  a pessoa revoga e confirma
Então   a linha ganha revoked_at
E       o nó para de listar a chave
```

Medido: o peer sumiu do nó cerca de três segundos depois do `204`.

```
Dado    um device revogado
Quando  a mesma chave pública é registrada de novo
Então   ela é aceita, porque o índice único é parcial
```

```
Dado    um device já revogado
Quando  a revogação chega de novo
Então   a resposta é 404, e o nó não é chamado
```

### O navegador

```
Dado    a página de chaves
Quando  a pessoa gera um device
Então   o corpo enviado tem exatamente name e publicKey
E       a chave privada não aparece em requisição nenhuma
```

A segunda linha é asserção, não intenção: o teste extrai a privada do arquivo
baixado e verifica que ela não está em nada que o `fetch` registrou.

```
Dado    um navegador com X25519 em crypto.subtle
Quando  o par é gerado
Então   o caminho usado é o do navegador
```

```
Dado    um navegador cujo generateKey recusa o algoritmo
Quando  o par é gerado
Então   o caminho usado é o do @noble/curves
E       a chave pública tem a mesma forma
```

A sonda é `try/catch` em volta do `generateKey`, **não** `if (crypto.subtle)`.
Um navegador sem X25519 continua tendo `subtle`; ele recusa com
`NotSupportedError` na chamada. A checagem barata teria escolhido o caminho
errado e o `else` nunca rodaria.

```
Dado    a mesma chave privada
Quando  os dois caminhos derivam a pública
Então   elas são iguais
```

Sem isso, o fallback é uma segunda implementação e não um substituto.

```
Dado    um navegador em que nem o fallback funciona
Quando  a pessoa tenta gerar
Então   a tela diz que este navegador não serve
E       nada é enviado ao servidor
```

## Portas afetadas

- [x] `IExitNode` em `@vpn/ports`, com token `Symbol.for('vpn.exit-node')`
- [x] `describeExitNodeContract` em `@vpn/testing/contracts`, escrita **antes**
      dos dois adapters
- [x] `MemoryExitNode` em `@vpn/testing/fakes`, que é o driver `memory`
- [x] `HttpExitNode` em `libs/adapters`
- [x] Wiring em `adapters.module.ts` com `EXIT_NODE_DRIVER`

A porta é de domínio, não de transporte — DEC-063, pelo argumento da DEC-046.

## Banco

`devices` — `id`, `account_id`, `user_id`, `name`, `public_key`,
`tunnel_address`, `provisioned_at`, `revoked_at`, `created_at`.

Escreve: a rota, na transação da requisição. Escreve também o worker, para marcar
`provisioned_at`. Lê: a rota, sob a policy. Apaga: ninguém — revogar é
timestamp, e a exclusão de account leva os devices por cascade.

Dois índices únicos **parciais**, ambos `where revoked_at is null`: um em
`public_key` e um em `tunnel_address`. Parciais porque uma chave revogada não
pode bloquear o registro da mesma chave depois, e um endereço liberado tem de
voltar para a faixa.

A FK é composta — `(user_id, account_id) → users (id, account_id)` — pelo mesmo
motivo que em `session_families`: um device cuja account discorde da do seu user
passa a ser recusado pelo banco em vez de por disciplina. `unique()` e não
`uniqueIndex()` no alvo, senão o drizzle emite a FK antes do índice e falha com
`42830`.

Policies: `devices_tenant` e `devices_system`, pelo mesmo helper das outras.
`rls.integration.spec.ts` ganha uma entrada e o conjunto de policies passa de
dezesseis para dezoito.

Migração: `0001_devices`, incremental. `0000_init` **não** foi regenerada — não
havia razão para pedir um `reset` a quem já tem banco.

## Idempotência

O `POST` **não** é idempotente e não deve ser: duas submissões são dois devices,
com chaves diferentes, e é isso que a pessoa pediu ao clicar duas vezes.

O que precisa ser reentregável é o trabalho do worker, e é. `device.provision`
resolve para `wg set`, que converge; `device.revoke` para `wg set ... remove`,
que trata ausente como sucesso — as duas coisas são asserções da suíte de
conformidade, não promessas. Por isso at-least-once basta e o job só é
reconhecido depois de aplicado.

`markProvisioned` é `where provisioned_at is null`, então a segunda entrega não
move o carimbo.

## Segurança

- **A chave privada nasce e morre no navegador.** Ela existe numa variável local
  o tempo de montar o `.conf` e não é alcançável depois: não vai para o store,
  nem para `localStorage`, nem para log, nem para requisição. É a disciplina que
  o `apps/web` já aplica ao access token, com consequência pior. O teste que a
  fixa procura a privada em tudo que foi enviado.
- **O servidor guarda só a pública**, que é o identificador do peer. DEC-045.
- **Um `.conf` perdido não se rebaixa.** Gera-se outro e o anterior é revogado, e
  isso está na interface — a DEC-045 diz em voz alta que, se não estiver, vira
  chamado de suporte.
- **O que o `.conf` roteia é configuração.** Localmente fica na faixa do túnel;
  um deployment real manda `0.0.0.0/0`. Full tunnel nesta máquina disputaria a
  rota default que já existe (o `docs/specs/data-plane.md` §Segurança registra
  qual), então **o PoC nunca exercitou roteamento total** — está dito aqui para
  não ser descoberto em produção.
- **O agente do nó não tem autenticação.** DEC-062 e DEC-063: aquele contêiner é
  fixture. É a primeira coisa que um nó real precisa.
- **Vaza a existência de uma conta?** Não se aplica: toda rota exige token e
  responde sobre a account dele.

## Como validar

```bash
sh devstack/dev.sh up && sh devstack/check.sh    # 17/17
pnpm verify
pnpm --filter @vpn-poc/adapters test:integration # inclui HttpExitNode
pnpm --filter @vpn-poc/api test:integration      # inclui devices sob RLS
pm2 stop worker && pnpm --filter @vpn-poc/api test:e2e && pm2 start worker
cd packages && MSYS_NO_PATHCONV=1 pnpm consumer-check
```

Três provas que nenhum comando faz sozinho:

1. **O portão carrega peso.** Apague `@RequiresCapability('vpn_access')` do
   controller e rode o e2e: os dois casos de 402 têm que ficar vermelhos com
   `201` e `200`. Reponha.
2. **O fallback é código de verdade.** Force `crypto.subtle.generateKey` a
   recusar e confira que a pública derivada pelo `@noble/curves` é idêntica à que
   o `crypto.subtle` derivaria da mesma privada. O `vitest` roda sobre o `crypto`
   do Node, que **tem** X25519 — sem forçar, o `else` nunca executa e a cobertura
   mente.
3. **O peer chega ao nó.** Com `EXIT_NODE_DRIVER=http`, crie um device pela API e
   observe a chave aparecer:

   ```bash
   curl -s http://127.0.0.1:21821/cgi-bin/peers
   ```

   Depois revogue e veja-a sumir. É o único teste que atravessa API, outbox,
   relay, fila, worker e `wg`.

### O que foi medido no navegador

A DEC-045 pede verificação, não suposição. Medido em **Edge 151** (Chromium),
headless, contra a mesma página:

```
crypto.subtle present: true
X25519 generateKey: OK
raw public key bytes: 32
jwk private scalar present: true
RESULT: webcrypto
```

Ou seja: neste navegador o fallback **não roda**. Ele continua necessário porque
X25519 em `crypto.subtle` é recente, e a única prova de que ele funciona é o
teste que o força. O `vite build` o emite como chunk separado
(`assets/ed25519-*.js`, ~26 kB), então quem tem X25519 nunca o baixa — e o
`import()` dinâmico resolve, que era o risco real: um especificador errado só
falharia no caminho que quase ninguém percorre.

Nenhum outro navegador foi medido. Firefox e Safari continuam **não verificados**.

## Emenda — 2026-08-10: as arestas que a entrega deixou

O que estava certo continua certo. O que se aprendeu ao fechar as pontas:

**A faixa de endereços é global e a leitura é por tenant.** O laço de alocação
partia de `.4` e fazia um `INSERT` por candidato — ~197 idas ao banco para o 201º
device, dentro da transação da requisição. Consertar exigiu uma view do dono do
schema, porque `runAsSystem` recusa aninhar e a policy prende a leitura a uma
account. O índice parcial continua sendo a autoridade. DEC-069.

**O `on conflict do nothing` sem alvo mentia sobre a causa.** Ele absorvia
também o índice de chave pública, e a desambiguação por `SELECT` era cega entre
accounts: uma chave viva de outra empresa esgotava a faixa e o erro dizia "sem
endereço livre". Com o alvo no índice de endereço, o de chave pública levanta
`23505` e a restrição nomeia a falha.

**`DELETE /devices/:id` não era do dono.** Filtrava só pelo id; só a policy
segurava, e ela para na account. Um `member` podia revogar o device de um colega
que o `GET` nunca lhe mostrou. Hoje posse é o escopo e a role alarga. DEC-070.

**Apagar uma account deixava peers órfãos.** `devices` e `outbox` cascateiam da
mesma linha, então a intenção de revogar morria junto com o que a causou. Duas
metades: o banco recusa apagar device vivo, e o worker reconcilia o nó. DEC-071.

**A tela não dizia o que acontece do lado do cliente.** Revogar não derruba o
túnel na máquina de ninguém — ele fica **ativo** e descarta tudo em silêncio. O
diálogo diz isso agora, e repete depois de revogar, porque o diálogo já não está
lá quando a pessoa vai procurar o problema.

**A tela dizia "liberando o acesso" até alguém recarregar.** O `invalidatesTags`
da mutation dispara um refetch só, e ele cai dentro da janela em que o worker
ainda não escreveu o peer: a resposta volta pendente e nada mais pergunta. O
túnel já funcionava nesse meio tempo — a única coisa errada era a frase na tela.
A lista agora pesquisa enquanto houver device sem `provisioned_at` e para quando
não houver. Sem prazo, ao contrário da tela de checkout, porque aqui não existe
estado neutro para oferecer no fim de um limite. DEC-072.

### O que continua fora

`devicesPerUser` segue sem aplicação e **sem contador de fachada** — a DEC-043
não mudou. Regiões e metering seguem dependendo de mais de um nó. Autenticar o
agente do nó continua sendo a primeira coisa que um nó real precisa (DEC-062,
DEC-063), e reconciliar `provisioned_at` de devices pendentes é do reconciler
apenas no sentido de repor o peer: quem carimba a coluna continua sendo o job.
