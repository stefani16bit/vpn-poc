# Servidores e regiões

**Status:** rascunho
**Decisões relacionadas:** DEC-035, DEC-036, DEC-043, DEC-062, DEC-063, DEC-064,
DEC-068, DEC-069, DEC-071, DEC-073, DEC-074, DEC-075, DEC-077, DEC-078

## Problema

Existe **um** nó de saída, ele vem de variável de ambiente e é um contêiner do
devstack. `regions` está anunciado em todo tier e aplicado em lugar nenhum. Não há
tela, não há tabela, e o `.conf` que o produto entrega aponta sempre para o mesmo
lugar.

O brief pede gerenciamento de servidores e regiões como escopo **obrigatório**, e
o roadmap adiava isso para a Fase 3 — _"quando o produto exigir"_, com a aplicação
chamada de _"explicitamente adiada"_. O produto exigiu. Reordenar isso é decisão
registrada, não edição silenciosa: o item foi **atropelado pelo brief**, e o
roadmap passa a dizer isso.

É também a maior peça do que falta, e a que o brief realmente avalia — é aqui que
mora a comparação entre construir, integrar e usar open source.

## Escopo

**Entra:** `regions` e `exit_nodes` como tabelas do tenant sob RLS; registrar um
nó chamando `describe()` e guardando o que ele responde; a página de servidores e
regiões; a escolha de região na criação de um device; a atribuição do nó pelo
servidor; a faixa de endereços por nó; a varredura por nó; e um segundo contêiner
WireGuard no devstack, como segunda região.

**Não entra:**

- **Rotação da chave de um nó.** Trocar a chave invalida todo `.conf` já baixado.
  Detectá-la já existe (DEC-068); reemitir em massa é decisão de produto.
- **Failover automático entre nós de uma região.** Um device fica preso ao nó que
  lhe foi atribuído. Ver §Limitações, onde isso é dito em voz alta.
- **Aplicação do contador de regiões.** Com um tier só não há o que aplicar
  (DEC-043, DEC-078). O contador entra no tipo agora; a aplicação, quando houver
  um segundo tier.
- **Metering de tráfego.** `monthlyTrafficGb` continua anunciado e não aplicado.
- **Provisionar a máquina.** Registrar um nó pressupõe que alguém já subiu o
  agente de controle lá. Instalar o nó é operação, não produto.

## Vocabulário

**Exit node** e **Region**, os dois **redefinidos** em `CONTEXT.md` §Rede antes
deste schema: o nó passa a ser linha do tenant e a região passa a ser nomeada pelo
cliente. Ver DEC-077 e DEC-078.

O par que este documento existe para não deixar colapsar: **região** é a escolha
da pessoa, **exit node** é a atribuição nossa. Duas colunas em `devices`, nunca
uma.

## Comportamento

### Registrar um nó

```
Dado    um admin e um agente de controle no ar
Quando  ele registra um nó com rótulo, região, endpoint, URL de controle e faixa
Então   o servidor chama describe() naquela URL
E       guarda a chave pública que o nó respondeu
E       a resposta é 201
```

```
Dado    um corpo que informe uma chave pública
Quando  o registro acontece
Então   o valor informado é ignorado
```

**O nó reporta a chave e mais nada.** O CGI `describe` imprime uma linha,
`publicKey=`, e o `HttpExitNode` completa `endpoint` e `allowedIps` a partir das
opções do construtor — hoje variáveis de ambiente. Então o endpoint **precisa**
vir do formulário: não existe outra fonte. Só a chave é reportada, e só ela é
ignorada quando informada.

A distinção importa porque a chave é a identidade do nó nas duas pontas e vai
para dentro de todo `.conf`: aceitar a digitada é aceitar que um erro de
digitação vire um `.conf` que nunca fecha handshake, e a falha aparece longe, no
cliente, sem nada apontando para cá. O endpoint erra de um jeito mais barato — o
handshake não sai, e o `tunnel:doctor` mostra isso na primeira execução.

Fazer o nó reportar o próprio endpoint é possível e não é de graça: ele não sabe
por qual endereço público alguém o alcança, então isso seria configuração no nó
em vez de configuração aqui. Fica no roadmap, não nesta entrega.

```
Dado    uma URL de controle que não responde
Quando  o admin registra
Então   a resposta é 502 e nenhuma linha é criada
```

Um nó que nunca respondeu não é um nó; é um endereço. Criar a linha assim mesmo
deixaria a lista dizendo que existe capacidade que não existe.

```
Dado    uma credencial errada
Quando  o admin registra
Então   o nó responde 401 e a resposta diz isso, não "indisponível"
```

DEC-073 tornou o 401 possível, e ele é a falha mais provável de um registro
manual. Confundi-lo com indisponibilidade manda o admin depurar a rede quando o
problema é um token.

### Regiões

```
Dado    um admin
Quando  ele cria uma região chamada "São Paulo"
Então   ela é criada com esse nome
```

```
Dado    uma região com nós dentro
Quando  o admin tenta apagá-la
Então   a resposta é 409
```

```
Dado    uma região sem nó nenhum
Quando  um device é criado escolhendo-a
Então   a resposta diz que não há servidor disponível naquela região
```

### Escolher e atribuir

```
Dado    um usuário criando um device
Quando  ele escolhe uma região
Então   o servidor escolhe o nó dentro dela
E       o device grava as duas coisas: a região e o nó
```

```
Dado    uma região cujos nós não respondem há tempo demais
Quando  um device é criado nela
Então   nenhum desses nós é atribuído
```

`last_seen_at` existe para esta regra e não para um gráfico. Sem ela, o primeiro
sintoma de um nó morto é um cliente com um `.conf` que não conecta.

```
Dado    um device já criado
Quando  o nó dele é consultado
Então   o .conf mostra o endpoint e a chave daquele nó, não de outro
```

### O endereço, agora por nó

```
Dado    dois nós e dois devices, um em cada
Quando  os dois pedem endereço
Então   os dois podem receber 10.13.13.4
```

Dois nós são redes independentes, e é isso que levanta o teto: hoje o índice único
parcial distribui de um `/24` global — 251 endereços contra 125 devices vivos por
account totalmente assinante, ou seja **duas** accounts. O índice passa a ser
`(exit_node_id, tunnel_address) where revoked_at is null`.

```
Dado    uma faixa /25
Quando  o alocador distribui
Então   ele não entrega endereço fora dela
```

Defeito conhecido e agora carregando peso: `assignableAddresses` e `isAssignable`
comparam só os três primeiros octetos, então `/25` é tratado como `/24`. Inofensivo
com uma faixa fixa, não com faixas que o tenant registra.

### A varredura, agora por nó

```
Dado    dois nós
Quando  a varredura roda
Então   cada nó é comparado com os devices vivos atribuídos a ele
```

```
Dado    um nó que recusa um peer
Quando  a varredura roda
Então   os outros nós convergem mesmo assim
```

Defeito que o roadmap já registra: hoje um peer recusado aborta a varredura
inteira e nada é carimbado. O isolamento por nó é a fronteira natural para
consertá-lo.

```
Dado    um nó fora do ar
Quando  a varredura roda
Então   ela não conclui que os peers dele sumiram
```

O caminho mais caro de errar: tratar silêncio como lista vazia faria a varredura
"repor" tudo, ou pior, concluir que nada é reivindicado.

## O que já está no contrato, e o que não está

`@vpn/contracts` **0.10.0** já traz `regions.ts` e `exit-nodes.ts` inteiros, mais
`deviceWithNode` — que mata a suposição de um nó por lista, porque dois devices
do mesmo usuário podem ficar em nós diferentes assim que existir frota.

Três campos ficaram **de fora de propósito**, e chegam com a implementação:
`createDeviceRequestSchema.regionId`, `deviceSchema.regionId` e
`deviceSchema.exitNodeId`. Eles são obrigatórios num fluxo que já funciona, então
publicá-los antes das tabelas que os produzem obrigaria o servidor a inventar um
`region_id` e um `exit_node_id` — que é exatamente o meio-aplicado que a DEC-043
chama de pior que ausente. Um contrato que exige um dado que ninguém sabe
produzir não é um contrato adiantado, é um contrato falso.

## Portas afetadas

`IExitNode` **não muda de forma**, e isso é o teste do desenho. O que muda é
**quantas** instâncias existem e de onde vêm os parâmetros: hoje uma, montada do
`.env` pelo `adapters.module.ts`; depois uma por linha de `exit_nodes`.

- [ ] Uma fábrica que produz um `IExitNode` a partir de uma linha, em vez de um
      único adapter registrado no container
- [ ] A suíte de conformidade continua valendo sem edição — se precisar mudar, é
      a porta que está errada
- [ ] `MemoryExitNode` continua sendo o driver `memory` e a fábrica respeita
      `EXIT_NODE_DRIVER`

## Banco

`regions` — `id`, `account_id`, `name`, `slug`, `created_at`. Escreve: a rota.
Lê: a rota e a criação de device. Apaga: a rota, e só quando não há nó dentro.

`exit_nodes` — `id`, `account_id`, `region_id`, `label`, `endpoint`,
`control_url`, `public_key`, `tunnel_cidr`, `credential_ref`, `last_seen_at`,
`created_at`. Escreve: a rota e a varredura (`last_seen_at`). Lê: a criação de
device, a varredura, a montagem do `.conf`. Apaga: a rota, e só quando não há
device vivo atribuído — mesma forma do guard que devices já tem.

`devices` ganha `region_id` e `exit_node_id`. **Duas** colunas: a escolha e a
atribuição são fatos diferentes.

As duas tabelas nascem sob RLS com policy por tabela e **um teste negativo por
tabela**, como a DEC-035 exige. `live_tunnel_addresses` passa a ser por nó, e o
`GRANT SELECT` dela continua escrito à mão em `0002_tunnel_allocation`, porque o
drizzle-kit não modela privilégio (DEC-069).

**A credencial do nó não é uma coluna de texto.** `credential_ref` aponta para
onde o segredo vive; no devstack é o `.env`, e em produção é o Secrets Manager que
o roadmap já prevê. Guardar o token na linha o colocaria em todo backup e em todo
`SELECT *`.

## Idempotência

Registrar o mesmo nó duas vezes: o índice único é `(account_id, public_key)` — a
identidade do nó é a chave que **ele** reporta, não o rótulo que alguém digitou.
O segundo registro perde para a restrição e vira 409.

A varredura já é idempotente por construção e continua: `wg set` converge, e repor
um peer que já existe é no-op. Por nó, isso não muda — só deixa de ser uma
transação de tudo-ou-nada sobre a frota inteira.

## Segurança

- **Vaza a existência de uma conta?** Não se aplica: rotas autenticadas e
  restritas a `admin`.
- **Isolamento entre tenants.** É a razão de as tabelas nascerem sob RLS. Um nó de
  outra account não pode ser lido, atribuído nem apagado, e o teste negativo por
  tabela é o que faz isso ser verificado.
- **A URL de controle é fornecida pelo cliente**, e o servidor faz uma requisição
  para ela. Isso é SSRF por construção e vai dito em voz alta: no PoC a mitigação
  é que a rota é `admin` da própria account e o corpo da resposta não é devolvido
  cru. Num produto, a lista de destinos permitidos é obrigatória.
- **Que sessões precisam morrer?** Nenhuma. Nada aqui muda quem alguém é.

## Limitações, ditas em voz alta

No registro que `data-plane.md` usa, porque isto é o que **não** sobrevive a um
produto:

- **Um device fica preso ao nó que lhe foi atribuído.** Se o nó sair do ar, o
  `.conf` é **reemitido**, não reapontado. Em troca não existe par de chaves
  compartilhado por região nem DNS para reapontar, e a custódia da DEC-063
  sobrevive inteira. Failover de verdade é chave por região e um plano para
  reemissão, e é maior que este item.
- **Uma região sem nó vivo é um beco.** A criação de device falha ali, e a tela
  precisa dizer isso antes do clique, não depois.
- **O contador de regiões não é aplicado.** DEC-043 e DEC-078.

## Como validar

```bash
make up && make check                    # a segunda região entra aqui
pnpm verify
pnpm --filter @vpn-poc/adapters test:integration
pm2 stop worker && pnpm --filter @vpn-poc/api test:e2e && pm2 start worker
```

Depois, o que prova que a região carrega peso — e é para isto que o canário
existe:

1. O devstack sobe **dois** nós, e o canário está atrás de **um** deles.
2. Crie uma chave escolhendo a região do canário, conecte, abra
   <http://172.30.13.10>: "Hello".
3. Crie outra escolhendo a outra região, conecte: **nada**.

Um `.conf` que funciona e outro que não, pela única diferença de qual região foi
escolhida. É a diferença entre "regiões existem na tela" e "regiões decidem por
onde o pacote sai".
