# Servidores e regiões

**Status:** entregue
**Decisões relacionadas:** DEC-035, DEC-036, DEC-043, DEC-062, DEC-063, DEC-064,
DEC-069, DEC-071, DEC-074, DEC-075, DEC-080, DEC-085, DEC-088, DEC-089,
DEC-090 a DEC-100

## Problema

Existe **um** nó de saída, ele vem de variável de ambiente e é um contêiner do
devstack. `regions` está anunciado em todo tier e aplicado em lugar nenhum. Não há
tabela, e o `.conf` que o produto entrega aponta sempre para o mesmo lugar.

O brief pede gerenciamento de servidores e regiões como escopo **obrigatório**, e
o roadmap adiava isso para a Fase 3 — _"quando o produto exigir"_, com a aplicação
chamada de _"explicitamente adiada"_. O produto exigiu. Reordenar isso é decisão
registrada, não edição silenciosa: o item foi **atropelado pelo brief**, e o
roadmap passa a dizer isso.

É também a maior peça do que falta, e a que o brief realmente avalia — é aqui que
mora a comparação entre construir, integrar e usar open source.

## Escopo

**Entra:** `regions` e `exit_nodes` como tabelas **da plataforma**, fora do RLS e
sem escrita para o papel do tenant; a frota semeada por migration; o
**healthcheck** que carimba `last_seen_at` e decide se uma região está
`available`; a escolha de região na criação de um device; a atribuição do nó pelo
servidor; a faixa de endereços por nó; a varredura por nó; e **cinco** contêineres
WireGuard no devstack, um por região demonstrada.

**Não entra:**

- **Rotação da chave de um nó.** Trocar a chave invalida todo `.conf` já baixado.
  Detectá-la já existe (DEC-068); reemitir em massa é decisão de produto.
- **Failover automático entre nós de uma região.** Um device fica preso ao nó que
  lhe foi atribuído. Ver §Limitações, onde isso é dito em voz alta.
- **Entitlement de região.** Saiu do tier inteiro: contar só fazia sentido
  enquanto o nome era do cliente. Volta como lista de slugs nossos quando houver
  um segundo tier (DEC-099).
- **Qualquer CRUD de servidor ou região.** Não há rota, não há tela e não há
  permissão. A frota é nossa; mudá-la é uma migration mais um deploy, que é
  exatamente o que operar uma frota deveria custar (DEC-090).
- **Metering de tráfego.** Saiu desta lista e ganhou spec própria —
  `docs/specs/traffic-metering.md` —, porque o produto pediu franquia aplicada e
  estatística por credencial. Continua **fora daqui**: esta spec entrega a frota,
  e é preciso ter frota antes de ter o que medir.
- **Provisionar a máquina.** Semear um nó pressupõe que alguém já subiu o agente
  de controle lá. Instalar o nó é operação, não produto.
- **Latência real entre regiões.** Os cinco nós rodam na mesma máquina. A região
  é um rótulo que decide **por onde o pacote sai**, não quanto ele demora. Ver
  §Limitações.

## Vocabulário

**Exit node** e **Region**, os dois **redefinidos** em `CONTEXT.md` §Rede antes
deste schema: o nó passa a ser linha nossa e a região passa a ser nomeada por nós.
Ver DEC-090.

O par que este documento existe para não deixar colapsar: **região** é a escolha
da pessoa, **exit node** é a atribuição nossa. Duas colunas em `devices`, nunca
uma.

## Comportamento

### Semear a frota

```
Dado    uma base vazia
Quando  as migrations rodam
Então   as cinco regiões e os cinco nós existem
E       cada nó já conta como visto, para que o produto sirva sem esperar varredura
```

O descritor em `libs/database/src/platform-fleet.ts` é a fonte única — slug,
nome, rótulo, endpoint, url de controle, faixa, referência de credencial, chave
pública e id fixo —, e a `0008` é a transcrição dele. Os ids são fixos porque um
teste precisa nomear um nó sem lê-lo antes, e porque um seed que divergiu vira
erro de compilação em vez de violação de chave estrangeira no meio da suíte.

**A chave pública é semeada literal, e a custódia vira portão.** SQL não chama
`describe()`. A regra da DEC-063 existia contra uma ameaça precisa: alguém digita
uma chave num formulário, o erro entra em todo `.conf`, e a falha aparece longe,
num cliente que nunca fecha handshake. Todo elemento disso é sobre valor não
revisado vindo de fora, e o formulário não existe mais — a chave está versionada
ao lado da privada que a produz. No lugar da checagem em runtime há uma asserção
por nó no `make check`, comparando a linha com o que a máquina responde. O
registro provava uma vez, no insert; isto prova a cada rodada.

```
Dado    um nó cuja chave foi trocada na máquina
Quando  make check roda
Então   a asserção daquele nó falha nomeando a divergência
```

**Mudar a frota é migration mais deploy.** Não há rota, tela nem permissão que
acrescente ou remova um nó, e isso é a decisão, não uma lacuna: a frota é nossa,
e a URL de controle deixa de ser um campo que um cliente preenche — o que apaga
a superfície de SSRF que a versão anterior desta spec tinha que mitigar.

### Saúde do nó

```
Dado    um nó da frota e no ar
Quando  o healthcheck roda
Então   describe() responde e last_seen_at é carimbado
```

```
Dado    um nó que parou de responder
Quando  o healthcheck roda
Então   last_seen_at não avança
E       a região dele deixa de ser available quando nenhum outro responde
E       a região continua existindo, e o nó continua na frota
```

Deixar de estar `available` e sumir da lista são coisas diferentes, e confundi-las
é o erro caro: um nó que não responde continua na frota, com devices atribuídos a
ele e um `.conf` já baixado em cada um. Apagá-lo porque ele piscou
transformaria uma queda de rede em perda de configuração.

```
Dado    cinco nós, um deles fora do ar
Quando  o healthcheck roda
Então   os outros quatro são carimbados mesmo assim
```

A mesma fronteira da DEC-085: falha de um nó é isolada, e o relatório diz quantos
falharam. Uma varredura que aborta no primeiro nó morto deixa os outros quatro
parecendo mortos também.

**Quem carimba é o healthcheck, não o tráfego.** Um nó pode estar servindo
handshake e ter o plano de controle fora do ar, e é o plano de controle que
precisamos alcançar para provisionar o próximo peer. `last_seen_at` responde
"consigo mandar trabalho para lá?", não "há pacote passando?".

### Regiões

```
Dado    um assinante
Quando  ele lê /regions
Então   vê as cinco que operamos, cada uma com nome e se está disponível
E       não vê endereço, url de controle nem quantas máquinas há em cada uma
```

```
Dado    uma região cujos nós pararam de responder
Quando  ele lê /regions
Então   aquela região vem available: false
E       criar uma chave nela responde 409
```

As duas asserções andam juntas de propósito: `available` é decidido pela **mesma**
janela que a consulta de atribuição usa. Se divergissem, o seletor ofereceria uma
região que a chamada seguinte recusa, e o usuário levaria o erro depois do clique
em vez de antes.

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

O alocador **já** lê a máscara: ele trabalha em inteiros de 32 bits e a faixa vai
de `rede + 4` até `broadcast − 1`, então um `/25` para em `.126`. Era defeito
quando esta spec foi escrita — `assignableAddresses` e `isAssignable` comparavam
só os três primeiros octetos — e foi fechado antes desta entrega, justamente
porque ele deixaria de ser inofensivo no instante em que o tenant registrasse a
primeira faixa. O que falta aqui é só a **origem** do CIDR: a linha do nó, não
`EXIT_NODE_TUNNEL_CIDR`.

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

O isolamento por chamada **já** existe: a DEC-085 fechou o defeito que esta spec
registrava, e o relatório da varredura ganhou `failed`. Ninguém é carimbado como
provisionado sem que o `wg set` dele tenha acontecido. O que muda aqui é a
fronteira externa — a varredura passa a rodar **por nó**, e um nó inteiro fora do
ar não contamina a convergência dos outros.

```
Dado    um nó fora do ar
Quando  a varredura roda
Então   ela não conclui que os peers dele sumiram
```

O caminho mais caro de errar: tratar silêncio como lista vazia faria a varredura
"repor" tudo, ou pior, concluir que nada é reivindicado.

## O que já está no contrato, e o que não está

`@vpn/contracts` **0.17.0** já traz `regions.ts` e `exit-nodes.ts` inteiros, mais
`deviceWithNode` — que mata a suposição de um nó por lista, porque dois devices
do mesmo usuário podem ficar em nós diferentes assim que existir frota.

O healthcheck também já está no contrato, e isso não é coincidência:
`exitNodeSchema` carrega `lastSeenAt`, e `regionSchema` responde `available`. A
distinção entre "a região existe" e "a região atende agora" foi decidida quando o
contrato foi escrito; o que falta é quem a preenche. O que **não** atravessa mais
é a contagem de máquinas: ela era para a tela de frota, e numa frota nossa é
inventário.

Três campos ficaram **de fora de propósito**, e chegam com a implementação:
`createDeviceRequestSchema.regionId`, `deviceSchema.regionId` e
`deviceSchema.exitNodeId`. Eles são obrigatórios num fluxo que já funciona, então
publicá-los antes das tabelas que os produzem obrigaria o servidor a inventar um
`region_id` e um `exit_node_id` — que é exatamente o meio-aplicado que a DEC-043
chama de pior que ausente. Um contrato que exige um dado que ninguém sabe
produzir não é um contrato adiantado, é um contrato falso.

Um quarto campo **falta e não foi deliberado**: `registerExitNodeRequestSchema`
não tem `endpoint`. Ver §Registrar um nó — é o laço circular que impede o
registro de descobrir o endereço do próprio nó, e o conserto é o campo entrar.

## Portas afetadas

`IExitNode` **não muda de forma**, e isso é o teste do desenho. O que muda é
**quantas** instâncias existem e de onde vêm os parâmetros: hoje uma, montada do
`.env` pelo `adapters.module.ts`; depois uma por linha de `exit_nodes`.

- [x] Uma fábrica que produz um `IExitNode` a partir de uma linha, em vez de um
      único adapter registrado no container
- [x] A suíte de conformidade continua valendo sem edição — se precisar mudar, é
      a porta que está errada. Não precisou.
- [x] `MemoryExitNode` continua sendo o driver `memory` e a fábrica respeita
      `EXIT_NODE_DRIVER`, com uma instância por id de nó

## Banco

`regions` — `id`, `slug`, `name`, `created_at`. Escreve: a migration de seed.
Lê: `/regions` e a criação de device. **Nada apaga.**

`exit_nodes` — `id`, `region_id`, `label`, `endpoint`, `control_url`,
`public_key`, `tunnel_cidr`, `credential_ref`, `last_seen_at`, `created_at`.
Escreve: a migration de seed, e a varredura em `last_seen_at`. Lê: a criação de
device, a varredura, a montagem do `.conf`. Apaga: uma migration futura, e só
quando não há device vivo atribuído — o trigger recusa o resto.

`devices` ganha `region_id` e `exit_node_id`. **Duas** colunas: a escolha e a
atribuição são fatos diferentes, e a FK do par é o que recusa uma linha em que
elas discordam.

**Nenhuma das duas tem `account_id` nem policy**, e são as únicas assim. Não ter
policy não as deixa escrevíveis: o `ALTER DEFAULT PRIVILEGES` daria
INSERT/UPDATE/DELETE a `vpn_app`, e um `REVOKE` no fim da `0007` é o que segura.
Os dois portões que cobravam "toda tabela sob RLS" afirmam agora o conjunto
exato, então uma terceira tabela sem RLS reprova e ligar RLS numa destas também
(DEC-090).

`live_tunnel_addresses` **deixou de existir**, e com ela a armadilha de `GRANT`
da DEC-069. No lugar entrou `live_addresses_on(uuid)`, `SECURITY DEFINER`, que
devolve os endereços vivos de **um** nó e nada sobre quem os possui: um nó atende
várias accounts, e a dica lida sob a policy de `devices` subcontaria todo
endereço que outra account já ocupa (DEC-092).

**A credencial do nó não é uma coluna de texto.** `credential_ref` aponta para
onde o segredo vive, e isso é o Secrets Manager nos dois lados — o localstack do
devstack e a conta de verdade. Guardar o token na linha o colocaria em todo backup
e em todo `SELECT *`. DEC-098.

## Idempotência

Rodar o seed duas vezes: os dois `INSERT` são `ON CONFLICT DO NOTHING`, sobre
`slug` e sobre `public_key`. O índice único é `public_key` sozinho — a identidade
do nó é a chave, ela viaja em todo `.conf`, e duas linhas com a mesma chave são
dois nomes para uma máquina que nenhuma configuração distingue.

A varredura já é idempotente por construção e continua: `wg set` converge, e repor
um peer que já existe é no-op. Por nó, isso não muda — só deixa de ser uma
transação de tudo-ou-nada sobre a frota inteira.

## Segurança

- **Vaza a existência de uma conta?** Não se aplica: a única rota é autenticada e
  exige assinatura. Nenhuma permissão nomeia servidor, porque não há servidor a
  gerir — a tela de concessões perde duas linhas sem código novo, já que é
  derivada do catálogo.
- **O que um tenant enxerga da frota.** Nome e disponibilidade, mais nada.
  Endereço, url de controle, referência de credencial e contagem de máquinas não
  atravessam nenhuma rota. Não é isolamento entre tenants — a frota é a mesma para
  todos —, é o recorte da projeção.
- **O que um tenant pode escrever na frota.** Nada, e é `REVOKE` quem diz, não
  ausência de rota. Uma rota pode ser acrescentada por engano; o privilégio tem
  que ser reconcedido de propósito.
- **Sem SSRF.** A url de controle deixou de ser campo de formulário: ela vem do
  seed, revisada em diff. A superfície que a versão anterior desta spec tinha que
  mitigar deixou de existir.
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
- **Um nó comporta 251 devices vivos somando todas as accounts.** A faixa é por
  nó e o nó agora é compartilhado, então `seats 25 × devicesPerUser 5 = 125` faz
  duas accounts cheias encherem uma região. A saída é mais de um nó por região —
  que o schema comporta e o devstack ainda não demonstra. DEC-092.
- **As cinco regiões não têm geografia.** Os cinco nós rodam nesta máquina, no
  mesmo Docker, a zero de latência entre si — `sa`, `na`, `eu`, `as` e `af`, com
  faixas de `10.13.13.0/24` a `10.13.17.0/24`. O nome da região é um rótulo que o
  nomeamos, e o que a demonstração prova é que a escolha decide **por onde o
  pacote sai**, não quanto ele demora. Um nó em São Paulo e outro em Frankfurt mudariam o RTT e nada mais
  do que esta spec descreve.
- **O healthcheck só sabe do plano de controle.** Um nó com o `httpd` no ar e o
  WireGuard derrubado é carimbado como alcançável. Separar as duas coisas é
  sonda no plano de dados, e ela precisa de tráfego de verdade para existir —
  o provador da DEC-075 é essa sonda, e ele não roda em laço.
- **A varredura só alcança nós que ainda estão na frota.** Apagar uma account não
  leva nó nenhum junto, mas aposentar uma máquina sim: os peers que estavam nela
  ficam lá, porque não sobrou `control_url` para perguntar e inventar um é o SSRF
  que a seção acima recusa. Há um teste e2e afirmando exatamente isso, para que a
  limitação seja lida e não descoberta. DEC-094.
- **Remover um nó apaga a memória de onde as chaves revogadas estavam.** A FK é
  `ON DELETE SET NULL (exit_node_id)`, então `region_id` sobrevive e o nó não. É
  a resposta certa para a pergunta que a remoção faz, e o preço é uma auditoria
  posterior não conseguir dizer qual máquina atendeu uma chave cuja máquina foi
  desregistrada. DEC-091.
- **O plano de controle fala HTTP puro.** Cada nó tem a sua credencial desde a
  DEC-098 — `credential_ref` é lida, não só escrita —, mas ela viaja em Basic
  sobre HTTP. mTLS continua sendo o teto e continua sendo trabalho de nó real: o
  `busybox httpd` do contêiner não fala TLS.
- **Rotacionar a credencial de um nó não o derruba.** Ele aceita o corrente e o
  anterior enquanto a janela está aberta, e o `busybox httpd` relê o `httpd.conf`
  no `SIGHUP` — então trocar o segredo de um nó deixou de ser recriá-lo, e nenhum
  peer se perde no caminho. DEC-102.

## Como validar

```bash
make up && make check                    # 65/65, e as cinco regiões entram aqui
pnpm verify
pnpm --filter @vpn-poc/adapters test:integration
pm2 stop worker && pnpm --filter @vpn-poc/api test:e2e && pm2 start worker
```

O `make check` já prova a metade estrutural: cada nó responde no plano de
controle dele, e os quatro que não são o do canário **não têm pé** na rede
`172.30.13.0/24`. É a ausência de rota, não uma regra configurável, que faz o
passo 3 abaixo dar o resultado que dá.

Depois, o que prova que a região carrega peso — e é para isto que o canário
existe:

1. O devstack sobe **cinco** nós, e o canário está atrás de **um** deles.
2. Crie uma chave escolhendo a região do canário, conecte, abra
   <http://172.30.13.10>: "Hello".
3. Crie outra escolhendo qualquer outra região, conecte: **nada**.

Um `.conf` que funciona e outro que não, pela única diferença de qual região foi
escolhida. É a diferença entre "regiões existem na tela" e "regiões decidem por
onde o pacote sai".

E o que prova o healthcheck, que é a outra metade:

1. `docker compose stop wireguard-<região>` e espere o intervalo do healthcheck.
2. A região continua na lista e passa a `available: false` — e criar uma chave
   nela passa a recusar **antes** do clique, não depois.
3. `docker compose start` no mesmo nó, e ela volta a `available: true`.

Um nó que pisca não pode virar configuração perdida: os devices atribuídos a ele
continuam lá, e o `.conf` que já foi baixado continua válido quando ele volta.
