# Plano de dados: o primeiro túnel

**Status:** entregue
**Decisões relacionadas:** DEC-010, DEC-011, DEC-045, DEC-062

## Problema

Tudo que o produto vende aponta para um túnel que não existe. A assinatura
existe, o tier existe, a capability `vpn_access` existe — e não há nada do outro
lado dela: `@RequiresCapability` não tem chamador de produção porque não há rota
de produto para guardar. `CONTEXT.md` §Rede define **Device**, **Peer**, **Exit
node** e **Region**, e termina admitindo que os quatro termos "descrevem um
sistema ainda não construído".

A pergunta que este trabalho responde não é como modelar peers. É anterior:
**esta máquina consegue carregar um túnel WireGuard?** WireGuard é UDP, o Docker
Desktop roda contêineres Linux dentro de uma VM do WSL2, e publicar UDP através
dessa VM é o tipo de coisa que ou funciona ou falha inteira — e falha de um jeito
em que o contêiner sobe saudável e nenhum pacote atravessa.

Escrever a spec antes de um pacote ter se movido seria descrever a documentação
do WireGuard, não este ambiente. Por isso o spike vem primeiro e este documento é
o **registro do que foi medido**, não o plano do que será feito.

## Escopo

**Entra:** um serviço `wireguard` no `devstack/`, com `NET_ADMIN`, `/dev/net/tun`
e os sysctls de forwarding; um par de chaves de servidor e um peer, gerados à
mão; a prova de que o handshake atravessa a VM do WSL2 a partir do cliente
WireGuard for Windows; a prova de que o tráfego sai pelo contêiner via NAT; e uma
asserção no `check.sh` para que um contêiner quebrado falhe no `check` em vez de
falhar no spike da próxima pessoa.

**Não entra:**

- **Qualquer código de aplicação.** Nenhuma tabela, porta, adapter, endpoint ou
  página. O spike não constrói o plano de dados do produto — constrói um fixture
  do devstack que torna o próximo item construível. DEC-062.
- **A página de chaves e o provisionamento de peer.** É o próximo item do
  roadmap, depende deste, e é onde a DEC-045 finalmente ganha implementação.
- **CDK.** A DEC-011 deixa as stacks vazias de propósito, e um nó de saída real é
  recurso da stack `network` — decidir isso agora seria decidir sem dado.
- **Regiões e metering.** `monthlyTrafficGb` e `regions` continuam anunciados e
  não aplicados, exatamente como a spec de entitlements os deixou.
- **Roteamento total (`0.0.0.0/0`).** Fora de propósito, não por acidente — ver
  §Segurança.

## Vocabulário

**Device**, **Peer**, **Exit node** e **Region** já estão em `CONTEXT.md`, e este
trabalho **não acrescenta nenhum termo**. Isso é a coisa mais importante desta
seção: o spike não construiu o plano de dados do produto, então a frase que
fecha §Rede — "estes quatro termos descrevem um sistema ainda não construído" —
continua verdadeira e **não foi alterada**. Quem a torna falsa é o item seguinte,
o que provisiona um peer a partir de uma chave que nasceu no navegador.

O contêiner deste spike é um **fixture**, não um exit node no sentido do
glossário. Ele tem a forma de um, e é só o que se pode afirmar.

## Comportamento

Todos os blocos abaixo foram observados, nesta máquina, contra o
`WireGuard for Windows 1.1` instalado pelo `winget`. Os números são copiados de
saída real.

```
Dado    o contêiner no ar e o peer semeado em wg0.conf
Quando  o cliente do Windows importa o .conf pela GUI e ativa
Então   o nó registra latest handshake em segundos
E       transfer cresce nos dois sentidos
```

Esta é a asserção inteira do spike, e é a que não podia ser presumida. O publish
de UDP através da VM do WSL2 funciona: `0.0.0.0:21820->51820/udp`, e o handshake
atravessa. `.wslconfig` tem `localhostForwarding=false` nesta máquina e isso não
importa — aquilo governa o loopback das distros do WSL, não as portas publicadas
pelo Docker Desktop, que passam pelo proxy dele.

```
Dado    o túnel ativo com AllowedIPs = 10.13.13.0/24
Quando  o host pinga 10.13.13.1
Então   respondem 4 de 4, entre 1 ms e 5 ms
```

```
Dado    o túnel ativo
Quando  o nó descreve o endpoint do peer
Então   ele diz 172.18.0.1:<porta>, o gateway da bridge do Docker
E       nunca o endereço real do host
```

O NAT do Docker Desktop reescreve a origem antes de o pacote chegar ao
contêiner. A consequência não é cosmética: **todo peer é indistinguível pelo
endpoint neste ambiente**, então qualquer coisa que o produto venha a chavear por
IP de origem — rate limit por endpoint, geolocalização, detecção de peer
duplicado — é intestável localmente por construção.

```
Dado    o túnel ativo por alguns minutos
Quando  o nó descreve o endpoint de novo
Então   a porta de origem mudou (48603, depois 57061, depois 35867)
```

O mapeamento UDP do Docker Desktop **roda**. É por isso que
`PersistentKeepalive = 25` no cliente não é enfeite aqui: sem ele o mapeamento
expira, o nó fica sem caminho de volta, e o túnel só volta quando o cliente
resolver falar de novo.

```
Dado    o peer com AllowedIPs incluindo 172.16.0.0/12
Quando  o host pede http://172.18.0.7:4873/-/ping
Então   o verdaccio responde 200
```

O endereço é o da **bridge** e a porta é a **do contêiner** (4873), não a
publicada (24873). O host não tem rota para `172.18.0.0/16`: antes de ativar o
túnel a mesma requisição expira com `curl` saindo 28, e depois de ativar ela
responde `200`. Não existe outro caminho por onde ela possa ter ido.

```
Dado    o egress funcionando
Quando  a regra de MASQUERADE é removida do nó
Então   a mesma requisição para de responder
E       repor a regra faz voltar a responder
```

Medido, em sequência: `200`, `000`, `200`. É a prova de que o NAT carrega peso, e
o mecanismo é claro — o verdaccio responderia para `10.13.13.2` pelo gateway da
bridge, que não tem rota nenhuma de volta para dentro do túnel. Sem MASQUERADE o
pacote de ida chega e o de volta se perde, que é o modo de falha mais caro de
diagnosticar sem esta sonda.

```
Dado    um túnel estabelecido
Quando  o contêiner do nó é reiniciado
Então   a interface nasce vazia, sem handshake e com contadores zerados
E       o keepalive do cliente restabelece o túnel sozinho, sem tocar na GUI
```

```
Dado    um túnel estabelecido
Quando  o devstack inteiro é recriado com reset (down -v)
Então   o keepalive sozinho demora a reconectar
E       o primeiro pacote real do host restabelece o handshake na hora
```

A diferença entre `restart` e `reset` é medida, não teórica. Depois do `restart`
o keepalive bastou; depois do `reset` o túnel ainda estava mudo passados 30
segundos, e um `ping` o trouxe de volta em menos de um. O motivo é que o cliente
mantém a sessão que ele acha viva e só manda keepalive cifrado com ela — que o nó
novo descarta sem responder, porque não tem sessão nenhuma. Quem força um
handshake novo é tráfego de verdade. **Não é sintoma de nada quebrado**, e é o
que alguém vai investigar por meia hora se não estiver escrito.

```
Dado    um contêiner alcançável pelo túnel em 172.18.0.7
Quando  o devstack passa por um reset
Então   ele pode reaparecer em outro endereço da bridge
```

Medido: o verdaccio saiu de `172.18.0.7` para `172.18.0.8` e o próprio nó de
`172.18.0.9` para `172.18.0.6`. O compose não declara `networks:`, então o
endereço é atribuído na ordem em que os contêineres sobem. Todo endereço
`172.18.x.x` citado neste documento é ilustrativo — o comando que descobre o
atual está em §Como validar, e é ele que deve ser usado, nunca o número.

```
Dado    o contêiner recebendo TERM
Quando  o entrypoint derruba a interface
Então   `wg-quick down` remove wg0 e a regra de MASQUERADE junto
```

O `PostDown` desfaz o que o `PostUp` fez. Sem isso, um `restart` acumularia uma
regra de NAT por ciclo de vida do contêiner.

```
Dado    o túnel ativo com AllowedIPs = 10.13.13.0/24, 172.16.0.0/12
Quando  o host acessa a internet
Então   o tráfego continua saindo pela rota do host, não pelo túnel
```

Deliberado. Ver §Segurança.

## Portas afetadas

Nenhuma. Não há dependência externa nova, porque não há código de aplicação: o
inegociável nº 1 fala de um serviço chamado por um service nosso, e aqui não há
service. Quando o provisionamento de peer existir, a pergunta "isto vira uma
porta?" se aplica ao que quer que fale com o nó — e ela não é respondida aqui.

## Banco

Nada. Nenhuma tabela, nenhuma coluna. A tabela de chaves que a DEC-045 antecipa
("a chave pública é o identificador do peer, e por isso a tabela fica sob RLS")
é do próximo item.

## Idempotência

Nada reentregável neste trabalho — não há handler, fila nem webhook. Vale
registrar a propriedade que o `wg-quick` tem e que o próximo item vai querer:
`wg setconf` é declarativo, então aplicar a mesma configuração de peers duas
vezes converge para o mesmo estado. É a forma que um reconciliador de peers deve
ter, e é diferente de `wg addconf`, que soma.

## Segurança

- **As chaves são fixtures descartáveis.** O par do servidor e o do peer estão
  **commitados**, incluindo a privada do peer, na mesma categoria de
  `vpn_app_dev` em `01-roles.sql` e dos segredos de `.env.example`: valem
  exclusivamente contra um contêiner local. Isso é indefensável para o produto, e
  é exatamente o que a DEC-045 já decidiu diferente — lá a privada nasce no
  navegador e o servidor nunca a vê. Um `.conf` deste diretório nunca deve virar
  base de nada que saia daqui.
- **`AllowedIPs = 0.0.0.0/0` é proibido neste spike**, e não por prudência
  genérica. Esta máquina já tem o Radmin VPN com rota default própria via
  `26.0.0.1`; um túnel full-tunnel disputaria a default e poderia levar o Docker,
  o devstack e a internet do host junto. As faixas usadas foram escolhidas contra
  a tabela de rotas real: `10.13.13.0/24` e `172.16.0.0/12` não colidem com
  `192.168.15.0/24` (LAN), `192.168.48.0/20` (vEthernet WSL) nem `26.0.0.0/8`.
- **`cap_add: [NET_ADMIN]` mais o device, nunca `--privileged`.** É a única
  diferença que importa entre este compose e um que alguém copie em direção a
  produção. `--privileged` funcionaria e desligaria toda a separação junto.
- **Vaza a existência de uma conta?** Não se aplica: não há endpoint.

## O que não sobrevive a um nó de saída de verdade

A parte deste documento com prazo de validade, dita em voz alta para que ninguém
a leia como projeto.

- **O endpoint de todo peer é `172.18.0.1`.** É o gateway da bridge, não o
  cliente. Nada que dependa de distinguir peers por origem é testável aqui.
- **`PersistentKeepalive = 25` compensa o NAT do Docker Desktop.** Num nó real
  quem precisa dele é o cliente atrás do NAT **dele**, por outro motivo. O valor
  coincide; a razão não.
- **`172.18.0.0/16` é o pool default do Docker nesta máquina**, não um valor
  fixado. O compose não declara `networks:`, então outra máquina pega outra
  faixa. É por isso que o `.conf` do peer usa `172.16.0.0/12`, que cobre qualquer
  escolha do pool — e é uma faixa larga demais para um produto.
- **`Endpoint = 127.0.0.1:21820` só vale para um cliente no mesmo host.** O
  fallback medido, caso o publish de UDP falhe, é o IP da VM do WSL2
  (`192.168.61.187` no momento em que isto foi escrito, alcançável pelo adaptador
  `vEthernet (WSL)` em `192.168.48.1`). **Esse endereço muda a cada reboot** —
  esta linha é documentação com prazo, e está aqui como pista de diagnóstico, não
  como configuração.
- **O NAT mora no próprio nó.** Correto para um contêiner; na AWS ele compõe com
  o roteamento da VPC que a stack `network` da DEC-011 vai possuir. DEC-062.
- **MTU 1420 atravessa intacto.** Medido: payload ICMP de 1392 bytes (+28 de
  cabeçalho = 1420) passa sem fragmentar, 1393 já não passa. O proxy UDP do
  Docker Desktop não custa nada de MTU, então o default do WireGuard serve. Num
  caminho real com PPPoE ou outro encapsulamento essa margem some, e o número
  volta a ser coisa a medir.
- **Um `.conf` por peer, escrito à mão.** Não há reconciliação, nem revogação,
  nem contagem de devices. O nó não sabe o que é uma account.

## Como validar

```bash
sh devstack/dev.sh up && sh devstack/check.sh    # 16/16, inclui o peer semeado
```

Depois, o que nenhum comando faz sozinho — e que é o item inteiro:

1. **Conectar de verdade.** Importar
   `devstack/wireguard/peers/poc-vpn-spike.conf` pela GUI do WireGuard for
   Windows (Import tunnel(s) from file → Activate) e confirmar do lado do nó:

   ```bash
   docker compose exec wireguard wg show wg0
   ```

   Sucesso é `latest handshake: N seconds ago` **mais** `transfer:` diferente de
   zero nos dois sentidos. "O contêiner subiu" não é sucesso — o contêiner sobe
   saudável mesmo quando nenhum pacote atravessa, e é precisamente essa a falha
   que o spike existia para descartar.

   `wg-quick up` **não** é o caminho no Windows: o cliente é gráfico e importa um
   arquivo. Uma instrução escrita como `wg-quick up` é conselho não testado.

2. **Provar o túnel.** `ping 10.13.13.1` do host.

3. **Provar o NAT.** Com `172.16.0.0/12` no `AllowedIPs`, pedir um contêiner pelo
   endereço da bridge e pela porta **interna**. O endereço se descobre, nunca se
   copia — ele muda a cada `reset`:

   ```bash
   IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' poc-vpn-verdaccio)
   curl -s "http://${IP}:4873/-/ping"        # verdaccio, porta do contêiner
   ```

   Então remover a regra e ver a mesma requisição morrer:

   ```bash
   docker compose exec wireguard \
     iptables -t nat -D POSTROUTING -s 10.13.13.0/24 -o eth0 -j MASQUERADE
   ```

   `200`, depois `000`, depois `200` ao repor. Sem esta sonda, um egress que
   funciona por acidente lê como um egress que funciona.

Se o `curl` falhar logo depois de um `reset`, mande um `ping 10.13.13.1` antes de
concluir qualquer coisa: o cliente pode ainda estar mandando keepalive de uma
sessão que só ele acha viva, e é tráfego real que força o handshake novo.
