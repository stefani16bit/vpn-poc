# Prova do túnel

**Status:** entregue
**Decisões relacionadas:** DEC-062, DEC-063, DEC-064, DEC-069, DEC-073, DEC-074,
DEC-075

## Problema

Nada aqui responde **"o túnel carrega tráfego?"**.

O `check.sh` afirma que o peer semeado está na interface e que o plano de
controle responde. As duas asserções são estáticas: ficam verdes com zero pacote
atravessando o túnel. O e2e fixa `EXIT_NODE_DRIVER=memory`, então a suíte que
mais parece cobrir o caminho é justamente a que não toca `wg`. O que existe de
prova real é prosa em `data-plane.md`, medida uma vez à mão, contra um endereço
que o próprio documento declara ilustrativo.

O efeito prático é que a pergunta que um avaliador faz primeiro — _funciona?_ —
só tem resposta lida em saída de `wg show`, por alguém que sabe o que procurar. E
a pergunta que importa mais que ela, _o portão é o nó ou é a boa vontade do
cliente?_, não tem resposta nenhuma.

## Escopo

**Entra:** um recurso privado no devstack, alcançável **só** pelo túnel; a
regra que preserva o endereço de origem do device até ele; asserções em
`check.sh` e uma seção no `tunnel:doctor`; e um provador que roda o ciclo
inteiro — login, criar chave, conectar, alcançar, revogar, deixar de alcançar —
saindo diferente de zero em qualquer passo.

**Não entra:**

- **Código de aplicação.** Nem `apps/api`, nem `apps/web`, nem `packages/`. Se
  esta spec exigisse uma linha de qualquer um dos três, a generalidade que a
  DEC-063 e a DEC-064 já entregaram não seria real. Ver §Portas afetadas.
- **Seleção de região.** O canário fica atrás do único nó que existe. Provar
  _escolha_ de região depende do segundo nó, e é do item de regiões.
- **Medição de banda.** `monthlyTrafficGb` continua anunciado e não aplicado.
- **Cliente Windows automatizado.** O provador usa `wg-quick` dentro de um
  contêiner Linux. O caminho do cliente Windows é a GUI do WireGuard for Windows
  importando um arquivo, é manual, e `data-plane.md` é explícito que escrever
  `wg-quick up` como conselho ao usuário é conselho não testado.
- **Qualquer recurso privado de produto.** O produto não tem nenhum, e o canário
  não é o primeiro — ele faz o papel do serviço de um cliente. DEC-075.

## Vocabulário

**Recurso privado** e **canário**, ambos já em `CONTEXT.md` §Rede. Nenhum termo
novo além desses dois.

## Comportamento

### O isolamento, antes de tudo

```
Dado    o canário no ar e o túnel fora
Quando  o host pede http://172.30.13.10/api/hello
Então   a conexão falha por ausência de rota
```

Esta é a primeira asserção do provador e não a última, porque se ela passar todas
as outras não querem dizer nada. Na Docker Desktop a bridge não é roteável a
partir do Windows, então com o túnel fora **não existe caminho** — é rota
ausente, não regra que alguém possa ter configurado errado.

```
Dado    o canário
Quando  qualquer um pede a porta publicada dele
Então   não há porta publicada
```

A ausência de `ports:` é a asserção. Uma porta publicada que aparecesse por
descuido tornaria toda a prova vazia, e o `tunnel:doctor` a procura de fora
justamente por isso.

### O caminho completo

```
Dado    uma account com vpn_access
Quando  ela cria um device e importa o .conf
Então   o handshake acontece
E       GET /api/hello responde 200
```

```
Dado    o túnel ativo
Quando  o canário responde
Então   seenFrom é o tunnelAddress que a API alocou
```

A segunda é a que tem conteúdo. `200` prova que um servidor respondeu;
`seenFrom` prova que ele viu **este device**, e é o que separa um túnel de um
proxy. É também o que quebraria em silêncio se o MASQUERADE do nó pegasse o
tráfego para a rede do canário: a resposta continuaria `200`, com `seenFrom` no
endereço do nó, e nada indicaria a perda.

```
Dado    o peer ainda ausente do nó
Quando  o provador espera
Então   ele consulta /cgi-bin/peers com credencial, que é a verdade do nó
E       separadamente afirma que GET /devices reporta provisionedAt
```

Duas afirmações e não uma, com nomes próprios: a primeira é o nó, a segunda é a
projeção no banco. Juntá-las faria o prazo de 120s da DEC-074 aparecer como um
travamento em vez de como um resultado.

### A revogação

```
Dado    um device conectado e alcançando o canário
Quando  a chave é revogada
Então   o peer sai do nó
E       a mesma requisição para de responder, com o túnel ainda de pé
```

Esta é a metade que prova que o portão é a **lista de peers do nó**, e não o
cliente sendo educado. Sem ela, tudo que foi medido acima é compatível com um
sistema que não controla nada. O cliente continua marcando a interface como
ativa — a interface diz isso, e `CONTEXT.md` §Revogado também.

### Os caminhos infelizes

```
Dado    o provador rodando sem o worker
Quando  o peer nunca aparece no nó
Então   o passo falha por prazo esgotado, nomeando o worker
```

```
Dado    uma account sem assinatura
Quando  o provador pede POST /devices
Então   a resposta é 402 e o provador para ali, dizendo o que fazer
```

## Portas afetadas

**Nenhuma.** Nenhuma dependência externa nova, nenhuma interface em
`@vpn/ports`, nenhuma suíte de conformidade, nenhum adapter — e nenhuma
republicação de `packages/`.

Isso é resultado, não sorte, e é conferível:

- `EXIT_NODE_CLIENT_ALLOWED_IPS` já é dividido por vírgula em
  `adapters.module.ts`;
- `exitNodeSchema.allowedIps` é `z.array(z.string()).min(1)`, sem forma por
  entrada;
- `wireguard-config.spec.ts` já afirma o caso de duas faixas.

Uma segunda faixa em `AllowedIPs` atravessa `HttpExitNode.describe()` →
`ExitNodeDirectory` → `DevicesService` → `buildWireguardConfig` sem que nada no
caminho precise saber que ela existe. Se algum desses três pontos tivesse
precisado de edição, a conclusão seria sobre o desenho e não sobre o canário.

## Banco

**Nenhuma tabela nova, nenhuma coluna nova.** O provador usa `devices` pelas
rotas existentes e não escreve no banco por fora delas.

## Idempotência

O provador é um script de ponta a ponta, não um handler reentregável. Rodar duas
vezes é seguro e deixa o mundo como encontrou: cada execução cria o próprio
device e o revoga no fim, inclusive quando um passo falha. Um device deixado para
trás por uma execução interrompida é visível no `tunnel:doctor` como peer que
nenhum device vivo reivindica, e a varredura da DEC-074 o remove.

Do lado do nó, `wg set` converge — repor um peer que já existe é no-op —, e é o
que torna a espera do provador segura contra a varredura rodando ao mesmo tempo.

## Segurança

- **Vaza a existência de uma conta?** Não se aplica: nenhum endpoint novo.
- **Token gerado?** Nenhum. O provador reutiliza o login e o
  `EXIT_NODE_API_TOKEN` que a DEC-073 já exige, lido do `.env`.
- **Sessões que precisam morrer?** Nenhuma.
- **A chave privada do device** nasce no provador, vive no `.conf` dentro do
  contêiner dele e morre com ele. Nunca é enviada — `POST /devices` leva
  `{ name, publicKey }` e mais nada, que é a mesma asserção que
  `keys-and-connection.md` já faz do lado do navegador.
- **`cap_add: [NET_ADMIN]`** no canário compra exatamente uma rota de volta, e no
  provador o necessário para subir uma interface. Nem um nem outro é
  `--privileged`, pela mesma razão da DEC-062.
- O canário **não tem porta publicada**, então ele não amplia a superfície da
  máquina — ele a reduz em relação a usar um serviço que já está publicado.

## Como validar

```bash
make up && make check                    # 19/19
pnpm dev                                 # o provador precisa da API e do worker
pnpm billing:activate                    # POST /devices responde 402 sem isto

cd ../poc-vpn-canary
docker compose up -d --build
docker compose run --rm prover           # sai != 0 em qualquer passo que falhe
```

Depois, o que nenhum comando faz sozinho:

1. **O navegador.** Crie uma chave em <http://127.0.0.1:5173> e importe o `.conf`
   pela **GUI do WireGuard for Windows** — `wg-quick up` não é o caminho do
   cliente nesta máquina. Abra <http://172.30.13.10>: "Hello", e o seu próprio
   endereço de túnel na tela. Desative, recarregue: nada.
2. **A revogação morde.** Com o túnel **ainda ativo**, revogue o device na web e
   recarregue. Tem que morrer em poucos segundos.
3. **A origem sobrevive.**

   ```bash
   docker compose exec wireguard iptables -t nat -S POSTROUTING
   ```

   `RETURN` tem que aparecer **antes** do MASQUERADE. Se a página mostrar
   `seenFrom: 172.30.13.2`, é esta ordem que está errada.
