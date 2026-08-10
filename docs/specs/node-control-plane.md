# Plano de controle do nó: uma credencial e um reparo

**Status:** entregue
**Decisões relacionadas:** DEC-046, DEC-047, DEC-054, DEC-062, DEC-063, DEC-064,
DEC-071, DEC-072, DEC-073, DEC-074

## Problema

Duas coisas separam o plano de dados de algo implantável, e nenhuma das duas foi
descoberta aqui — as duas estão nomeadas em decisões que já existiam.

**O agente do nó não tem autenticação.** A DEC-063 diz com essas palavras:
qualquer coisa que alcance `21821` adiciona ou remove qualquer peer, e isso só é
defensável porque a DEC-062 registrou que aquele contêiner é fixture. A porta
está publicada no host. Um `wg set` vindo de fora move o endereço do device de
outra account sem nada em log nenhum.

**Nada repara um provisionamento que falhou.** A DEC-064 escolheu o outbox
justamente para que uma queda não perdesse o trabalho — mas at-least-once só vale
enquanto alguém continua entregando. Um `device.provision` que esgota as
tentativas termina na DLQ e a linha diz `provisioned_at IS NULL` para sempre, sem
alarme e sem reparo. O reconciliador da DEC-071 repõe o **peer** e não carimba a
coluna: o túnel volta a funcionar e a tela continua dizendo que está liberando o
acesso, pelo tempo que a aba ficar aberta (DEC-072).

## Escopo

**Entra:** a credencial do plano de controle, cobrada pelo `httpd` do nó e
carregada pelo adapter; a recusa de subir sem ela, nas duas pontas; a varredura
carimbando `provisioned_at` de device pendente passado um prazo; e o
`tunnel:doctor` e o `check.sh` dizendo em voz alta quando alguma dessas coisas
não está de pé.

**Não entra:**

- **mTLS e qualquer nó de saída real.** A DEC-011 deixa as stacks vazias e a
  DEC-062 diz que este contêiner nunca é publicado. mTLS é certificado de cliente
  mais terminação TLS no nó, e a DEC-073 registra por que ele não reaproveita
  esquema de cabeçalho nenhum.
- **Rotação do token do nó.** Um token só serve a frota inteira, então trocá-lo
  derruba todos os nós ao mesmo tempo. Está no roadmap.
- **Rotação da chave do próprio nó.** Invalidaria todo `.conf` já baixado e não há
  como reemiti-los. Decisão de produto, como a spec anterior já dizia.
- **Regiões, segundo nó e metering.** Continuam dependendo de mais de um nó.
- **`devicesPerUser`.** A DEC-043 não mudou, e continua **sem contador de
  fachada**.
- **Isolar peer a peer dentro da varredura.** Um peer que o nó recusa aborta a
  varredura inteira; a próxima repete. Roadmap.

## Vocabulário

**Nenhum termo novo.** A credencial é infraestrutura, não domínio: ela não
aparece em nenhuma tela, em nenhum contrato e em nenhuma tabela. **Reconciliação**
já estava em `CONTEXT.md` §Rede e é o único verbete que muda — ele passa a dizer
que a varredura converge as duas projeções da linha, não só a lista de peers.

## Comportamento

### A credencial

```
Dado    o plano de controle no ar
Quando  alguém pede /cgi-bin/describe sem credencial
Então   a resposta é 401
E       o corpo não contém a chave pública do nó
```

Medido, contra o nó real: `401` sem credencial, `401` com a senha errada, `401`
com o usuário errado, `200` com a credencial certa. E `401` também no `POST` de
`/cgi-bin/peers`, que é o que de fato altera o nó.

```
Dado    o adapter configurado com o token
Quando  a suíte de conformidade roda contra o nó
Então   os treze casos passam sem nenhuma edição na suíte
```

Essa é a asserção que prova que a credencial **não vazou para a porta**. Se
`describeExitNodeContract` tivesse precisado de um parâmetro, o desenho estaria
errado — e `packages/` teria que ser republicado.

```
Dado    o adapter com o token errado
Quando  ele descreve o nó ou provisiona um peer
Então   ele lança, e a mensagem diz 401
```

```
Dado    EXIT_NODE_DRIVER=http e nenhum EXIT_NODE_API_TOKEN
Quando  a aplicação sobe
Então   loadEnv lança nomeando a variável e o driver que a exige
```

```
Dado    um token com menos de 32 caracteres
Quando  a aplicação sobe
Então   o zod recusa antes de qualquer chamada ao nó
```

O prazo de validade de `changeme` é o boot, não o primeiro `wg set`.

```
Dado    o contêiner do nó sem EXIT_NODE_API_TOKEN no ambiente
Quando  ele sobe
Então   o entrypoint recusa em vez de servir sem nada para conferir
```

```
Dado    o healthcheck do contêiner
Quando  o plano de controle responde a um chamador anônimo com a chave pública
Então   o contêiner é reportado unhealthy
```

Isso é a metade que nenhuma outra sonda pega: `wg show` fica verde com o plano de
controle morto, e o plano de controle fica verde servindo para qualquer um.

### O reparo

```
Dado    um device vivo sem provisioned_at, criado há mais que o prazo
E       o job dele nunca entregue
Quando  a varredura roda
Então   o nó passa a listar a chave pública
E       provisioned_at deixa de ser nulo
```

Medido de ponta a ponta contra o nó real, sem worker e sem fila: uma linha
inserida com `created_at` de dez minutos atrás, `wg show` sem a chave, uma
varredura, e então `{"revoked":0,"provisioned":1,"stamped":1}` com a chave no nó e
a coluna carimbada.

```
Dado    um device pendente cujo peer o nó já serve
Quando  a varredura roda
Então   ela não chama o nó
E       carimba a coluna de todo jeito
```

É o job que morreu **depois** do `wg set` e antes do `UPDATE`. Sem este caso, o
túnel funciona e a tela mente para sempre — e é o caso que o `tunnel:doctor`
aprendeu a nomear.

```
Dado    um device pendente criado agora
Quando  a varredura roda
Então   ela não o provisiona nem o carimba
```

O prazo é o que separa "o job está a caminho" de "o job morreu". Sem ele a
varredura disputaria com o consumer todo device recém-criado.

```
Dado    um device pendente dentro do prazo cujo peer um job acabou de escrever
Quando  a varredura roda
Então   o peer não é revogado
```

Ele continua em `wanted`. Tirá-lo da lista o transformaria em órfão, e a varredura
apagaria o trabalho que o job acabou de fazer.

```
Dado    um device já provisionado
Quando  a varredura roda duas vezes
Então   a lista de peers do nó é idêntica
E       o carimbo não se move
E       o relatório é revoked 0, provisioned 0, stamped 0
```

Medido: três varreduras seguidas contra o nó real, lista byte a byte igual.

```
Dado    o laço do worker
Quando  ele pede a varredura mais de uma vez dentro do intervalo
Então   só a primeira varre
E       um chamador que pede runOnce varre sempre
```

## Portas afetadas

Nenhuma. `IExitNode` não mudou, `describeExitNodeContract` não mudou,
`MemoryExitNode` não mudou — e é isso que se estava tentando conseguir. A
credencial é opção do adapter (`HttpExitNodeOptions.token`), do mesmo jeito que
`S3ObjectStorage` recebe o bucket. `packages/` não é republicado.

## Banco

Nada. Nenhuma tabela, nenhuma coluna, nenhuma migração. `provisioned_at` já
existia e o único escritor novo é a varredura, sob `app_system`, num `UPDATE` que
já era condicional (`where provisioned_at is null`).

## Idempotência

A varredura é reentregável por construção e não precisa de chave: `wg set`
converge (DEC-063) e `markProvisioned` é condicional, então a segunda passada é
um no-op nas duas pontas. É o que o cenário das três varreduras fixa.

O que ela **não** faz é tocar em `outbox`. O relay drena aquela tabela com
`for update skip locked`, e uma leitura sem isso brigaria com ele — o sintoma
seria um job rodando duas vezes ou nenhuma, diferente a cada corrida. A varredura
fala com o nó e com `devices`, e nada mais.

As escritas ficam numa segunda transação de sistema, **depois** de todas as
chamadas ao nó. Chamada externa com transação aberta é a dívida que o roadmap já
nomeia em `createCheckout`.

## Segurança

- **A credencial é cobrada pelo servidor, não pelo script.** O 401 sai do `httpd`
  antes de qualquer CGI rodar, então não existe rota que possa esquecer a
  checagem. Os três CGI não mudaram.
- **O arquivo que guarda o token mora fora de `-h`.** `/etc/httpd.conf`, modo
  `600`. Dentro do diretório servido ele seria buscável.
- **O token do devstack é fixture commitado**, na categoria de `vpn_app_dev` e das
  chaves de `wireguard/peers/`: vale exclusivamente contra um contêiner local. Um
  nó real não herda nada disso a não ser a forma.
- **Um token só para a frota inteira não é rotacionável** sem derrubar todos os
  nós juntos. É a limitação central desta entrega e está no roadmap, não escondida
  aqui.
- **`SENSITIVE_KEYS` já cobre `token` e `authorization`**, então um contexto de
  erro capturado não leva o cabeçalho para o Sentry. Nada a acrescentar.
- **O token não entra em log.** O `tunnel:doctor` diz _que_ a credencial não
  serve, nunca qual foi tentada.
- **Vaza a existência de uma conta?** Não se aplica: não há endpoint novo, e o
  nó não sabe o que é uma account.

## Como validar

```bash
sh devstack/dev.sh up && sh devstack/check.sh    # 17/17
pnpm verify
pnpm --filter @vpn-poc/adapters test:integration # inclui a credencial contra o nó
pnpm --filter @vpn-poc/api test:integration
pm2 stop worker && pnpm --filter @vpn-poc/api test:e2e && pm2 start worker
pnpm tunnel:doctor
cd packages && MSYS_NO_PATHCONV=1 pnpm consumer-check
```

Trocar um script CGI ou o entrypoint exige **rebuild**, não `restart`:
`control/` entra na imagem por `COPY`. Um `restart` continua servindo o script
velho, e o sintoma é a suíte de conformidade vermelha contra um adapter correto.

```bash
MSYS_NO_PATHCONV=1 docker compose -f devstack/docker-compose.yml up -d --build wireguard
```

Três provas que nenhum comando faz sozinho:

1. **A credencial carrega peso.** Com `TOKEN` lido do `.env`:

   ```bash
   curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:21821/cgi-bin/describe
   curl -s -o /dev/null -w '%{http_code}' -u "worker:${TOKEN}" http://127.0.0.1:21821/cgi-bin/describe
   ```

   `401` e depois `200`. Então apague o cabeçalho de `HttpExitNode.#call` e rode
   `pnpm --filter @vpn-poc/adapters test:integration`: os **treze** casos da suíte
   de conformidade ficam vermelhos com `401` e só os três casos de credencial
   seguem verdes. Reponha.

2. **O reconciliador carrega peso.** Pare o worker, insira um device vivo com
   `provisioned_at` nulo e `created_at` de dez minutos atrás, confirme que a chave
   **não** está em `wg show wg0 peers`, e rode a varredura sozinha — sem relay,
   sem fila, sem consumer. Ela tem que devolver `provisioned: 1, stamped: 1`, pôr
   a chave no nó e carimbar a coluna. Lembre que uma linha viva não pode ser
   apagada: revogue antes de limpar (DEC-071).

3. **A convergência continua valendo.** Rode a varredura mais duas vezes contra o
   mesmo device e compare `wg show wg0 allowed-ips` antes e depois: idêntico, e o
   relatório todo zero.

Não reutilize chave que alguma fixture semeou. A suíte de conformidade é dona de
`10.13.13.202` e `.203` e limpa em volta de cada caso; `10.13.13.2` é o peer do
spike e revogá-lo derruba um túnel conectado. Gere uma nova com
`docker compose exec -T wireguard sh -c 'wg genkey | wg pubkey'`.
