# Roadmap

Este arquivo faz as vezes de issue tracker. Não abra issues; edite aqui.

---

## Estado — 2026-08-14

**Fase 1 + i18n entregues. Fase 2: outbox, webhook, Account/User + RLS e
entitlements entregues.** Cadastro, verificação, login, rotação de sessão, reset
de senha e assinatura funcionando de ponta a ponta contra o devstack, em pt-BR e
en, com toda tabela de domínio sob RLS. Assinar agora muda o que a account tem:
o tier sai da subscription a cada requisição, com cache, e o webhook invalida.
O retorno do checkout tem tela própria: ela espera o webhook em vez de supor que
ele já chegou, e a ativação avisa por e-mail. Cancelar pergunta antes, e um
cancelamento agendado pode ser desfeito. As cinco transições de cobrança avisam
por e-mail — inclusive a que tira o acesso, que até aqui era silenciosa.

O plano de dados deixou de ter as duas arestas que a spec dele admitia: o agente
do nó **exige credencial** e a aplicação recusa subir apontada para ele sem uma,
e a varredura do worker passou a carimbar `provisioned_at` — um device cujo job
morreu na DLQ recupera o túnel **e** para de dizer que está liberando o acesso.
DEC-073, DEC-074.

E o túnel deixou de ser afirmação: existe um **recurso privado** atrás dele, sem
porta publicada, e um provador que roda o ciclo inteiro — isolamento, criar a
chave como o navegador cria, conectar, alcançar, revogar, deixar de alcançar — e
sai diferente de zero em qualquer passo. Medido: `seenFrom` é o endereço que a
API alocou, e a revogação mata o acesso em 4s **com o túnel ainda de pé**.
DEC-075, `docs/specs/tunnel-proof.md`.

E existe uma segunda pessoa. A página de usuários fechou o penúltimo item da
Fase 2; o portão dela nasceu como `@RequiresRole` e a DEC-080 o trocou por
permissão, que é **dado da account** e não rank do enum. A senha é gerada e
mostrada uma vez, o user nasce verificado, e mudar a role mata as sessões dele em
vez de esperar o token de 15 minutos expirar. DEC-076, DEC-080.

A tela passou a mostrar só o que a concessão permite fazer: rota e controle
nascem atrás do que o servidor cobra, o alcance em `/devices` virou permissão em
vez de rank, e quem não gere cobrança perde a seção de assinatura em vez de ver
botões que respondem 403. Junto veio o histórico de faturas, projetado do webhook
com o PDF arquivado em S3 na chegada do evento. DEC-082, DEC-083.

E dez dívidas do backlog caíram de uma vez: a assinatura passou a ser
reconciliada contra o provider, as tabelas que cresciam para sempre ganharam
expurgo, o rate limit ganhou um segundo balde por endereço de origem e passou a
dizer quanto esperar, a varredura deixou de abortar num peer recusado, e o teto
de dispositivos por account virou índice. DEC-084 a DEC-087.

Junto veio o alocador de endereços lendo a máscara do CIDR, o que fecha uma
dívida antiga e desarma uma armadilha nova: o contrato de servidores já aceita
`tunnelCidr`, então um `/25` tratado como `/24` deixaria de ser teórico assim
que a frota ganhasse o primeiro nó com faixa diferente.

E duas armadilhas do devstack saíram de cena antes do segundo nó, que é o que as
tornaria caras. A do NAT **já tinha disparado**: a regra casava por interface e
`eth0` aqui é a rede do canário, então o egress do túnel para a bridge saía sem
NAT — com `make check` verde o tempo todo, porque ele aferia o **texto** da regra
e nunca o disparo dela. As duas regras casam por destino agora, e a asserção que
faltava zera o contador e exige vê-lo subir. Junto, editar um CGI do plano de
controle passou a valer com `restart` em vez de `build`, copiado para dentro no
boot em vez de servido do mount — porque o bit de execução viaja com o host e
esses arquivos são `100644` no git. DEC-088, DEC-089.

E o segredo saiu do ambiente. `AUTH_JWT_SECRET` e `STRIPE_WEBHOOK_SECRET` viraram
referências, e a porta que as resolve passou a nomear a **janela de rotação** —
uma mudança de porta e não duas, porque tirar do ambiente e rotacionar eram um
desenho só. Trocar o segredo de assinatura deixou de derrubar todo mundo de uma
vez: assina com o corrente, verifica contra os dois, e o **mesmo** `jwtVerify`
confere issuer e audience nas duas tentativas. Um terceiro valor aposenta o
primeiro, e é a suíte de conformidade que cobra isso. DEC-101.

A pergunta que a DEC-098 deixou como spike foi respondida, e a resposta foi
melhor que a pergunta: o `busybox httpd` guarda **as duas** linhas para o mesmo
caminho **e** relê o arquivo no `SIGHUP`. Então rotacionar a credencial de um nó
não é recriá-lo — é escrever e mandar um sinal, com o túnel de pé e nenhum peer
perdido. O `check.sh` fecha e reabre uma janela de verdade a cada rodada e afirma
que o **PID do `httpd` não mudou**. mTLS, o item vizinho, foi adiado por escrito,
com os dois atalhos recusados e o motivo de cada um. DEC-102, DEC-103.

E a suíte de billing finalmente enfrenta o Stripe. Ela é quatro agora — checkout,
ciclo de vida, webhook e arquivo de fatura —, partida pelo que um provider
consegue responder, com harness estreita cada uma: registrar uma suíte que o
adapter não sabe alimentar virou erro de compilação. O que o Stripe não enfrenta é
medido e nomeado, nunca um `skip` dentro de uma suíte que depois se declara verde.
Junto veio o SDK, cinco majors de uma vez, e ele custou duas linhas — as duas
sendo a DEC-057 se pagando. DEC-104, DEC-105.

| Suíte                                                         | Testes   | Precisa do devstack |
| ------------------------------------------------------------- | -------- | ------------------- |
| `packages/` — portas, contratos, i18n, fakes                  | 332      | não                 |
| `libs/env`                                                    | 23       | não                 |
| `libs/adapters` — render de e-mail/SMS, redação, webhook, nós | 36       | não                 |
| `apps/api` — kernel, serviços, controllers                    | 650      | não                 |
| `apps/web` — store, telas, normalização de erro, locale       | 306      | não                 |
| `apps/worker` — o laço não esqueceu nenhuma varredura         | 10       | não                 |
| `infra` — validação de config CDK                             | 11       | não                 |
| **Subtotal `pnpm verify`**                                    | **1368** | **não**             |
| `libs/adapters` — as mesmas suítes contra os serviços reais   | 93       | sim                 |
| `apps/api` — RLS, transações, o endereço por nó e o trigger   | 81       | sim                 |
| `apps/api` — fluxo completo mais a matriz de locale           | 160      | sim                 |
| **Total**                                                     | **1702** |                     |

Cobertura com piso aplicado, e o piso só sobe (DEC-028): `apps/api` em
94/87/88/93 (linhas/funções/ramos/statements), `apps/web` em 97/95/92/96.
Conferido como portão: `--coverage.thresholds.branches=99` falha citando o
valor real.

`make check` 65/65 · `cdk synth` 6 stacks · `consumer-check` verde ·
`pnpm lint` verde e provado que falha num import proibido.

`pnpm verify` roda com o Docker parado, de propósito: `*.integration.spec.ts` e
`*.e2e.spec.ts` estão excluídos do config unitário. Uma suíte que fica vermelha
sem Docker ensina a ignorar suíte vermelha.

A frota fechou a maior peça que faltava, e ela chegou com três defeitos que só
o portão inteiro pegou. O módulo de devices nunca importou o de frota, então o
container não montava e **a API não subia** — o e2e não estava falhando em 26
casos, estava falhando em todos, e a diferença só apareceu ao rodar o e2e em vez
de confiar na suíte de integração. O `NodeHealth` existia inteiro, com teste e
janela própria, e ninguém o chamava: uma varredura órfã não falha, ela só não
acontece, e `last_seen_at` congelado faz toda região ler como inalcançável. E o
par região/nó, que a DEC-090 chamou de o ponto inteiro, era guardado por duas FKs
separadas que aceitavam um device na Ásia atribuído a um nó da Europa. DEC-091,
DEC-094, e o guard do laço em `apps/worker`.

## Próximo

### Antes de qualquer deploy

- [x] ~~**Validar Stripe Checkout contra a API real.**~~ Rodado em 2026-08-08
      contra uma conta em test mode, com `stripe listen` encaminhando: o
      `createCheckout` devolve uma sessão `checkout.stripe.com` de verdade; um
      `customer.subscription.created` real verifica assinatura, normaliza,
      atualiza a projeção e invalida o cache — `GET /entitlements` passou a `pro`;
      e um cartão que falha ao ser cobrado (`pm_card_chargeCustomerFail`) produziu
      `invoice.payment_failed` aplicado, com o e-mail de dunning na caixa.
      **Achou dois bugs, os dois corrigidos na DEC-057.** Falta só o clique humano
      na página hospedada, que nenhum teste automatiza.
- [ ] **`stripe` está no 17 e o npm no 22; a versão de API que fixamos é de
      2025-02.** Não é urgente: a DEC-057 fez o parser aguentar as duas formas de
      payload. Mas as **nossas chamadas** continuam falando uma versão de 18 meses
      atrás, então campo novo não existe para nós e os tipos descrevem um passado.
      Subir são cinco majors de mudança de tipos, e o alvo natural é a versão
      default da conta.
- [x] ~~**A suíte de conformidade de billing não roda contra o Stripe.**~~ Ela é
      **quatro** agora — checkout, ciclo de vida, webhook e arquivo de fatura —,
      partida pelo que um provider consegue responder, e o Stripe enfrenta as duas
      do meio. Dois blocos não bastavam: o localstripe não serve `invoice_pdf`
      nenhum, e `fetchInvoicePdf` dividia bloco com a normalização de fatura, que é
      pura e passa. Os dois ausentes são medidos e nomeados, e nenhum é um `skip`
      dentro de uma suíte que depois se declara verde. Cancelar e retomar deixaram
      de ser pinados à mão. DEC-104.
- [x] ~~**O agente do nó não tem autenticação.**~~ O plano de controle exige
      credencial, cobrada pelo `httpd` do nó antes de qualquer CGI rodar, e
      `EXIT_NODE_DRIVER=http` sem token falha no boot. A porta não mudou, então
      `packages/` não se moveu. DEC-073.
- [x] ~~**A credencial do nó é um token só, para a frota inteira.**~~ Cada nó tem
      a sua, guardada no Secrets Manager e lida pela referência que a linha dele
      carrega — `credential_ref`, que existia desde a DEC-090 e não tinha leitor
      nenhum. Rotacionar é um nó de cada vez, e `make check` prova o isolamento
      com uma negativa cíclica: cada nó recusa o token do vizinho. DEC-098.
- [ ] **O plano de controle do nó fala HTTP puro.** O alvo continua sendo mTLS,
      que é certificado de cliente num dispatcher de `fetch` mais terminação TLS
      no nó — o `busybox httpd` é 1.37.0 e não fala TLS, então isso é trabalho de
      nó real e da stack `network`. **Adiado explicitamente, com os dois atalhos
      recusados por escrito** (proxy por nó, troca de imagem): os dois destroem
      uma decisão recente para chegar a um nó que ainda não é o de produção, e a
      stack `network` sequer começou. A credencial por nó não adianta caminho, e
      a DEC-073 já explicava por quê: mTLS não reaproveita esquema de cabeçalho
      nenhum. DEC-103, DEC-073, DEC-098, DEC-011.
- [x] ~~**A rotação da credencial de um nó exige recriá-lo.**~~ O spike foi feito
      e a resposta é sim, duas vezes: o `busybox httpd` guarda **as duas** linhas
      para o mesmo caminho (`parse_conf` não deduplica, e a guarda `prev` de
      `check_user_passwd` só pula prefixos **diferentes**), e — o que a pergunta
      não previa — ele **relê o `httpd.conf` no `SIGHUP`**. Então rotacionar não é
      recriar o contêiner: é `rotate.sh NOVO VELHO` para abrir a janela e
      `rotate.sh NOVO` para fechá-la, sem derrubar o túnel nem perder um peer. O
      `check.sh` fecha e reabre uma de verdade a cada rodada e afirma que o **PID
      do `httpd` não mudou**. DEC-102.
- [ ] Preencher as stacks CDK. Ordem: `network` → `data` → `events` → `api`.
- [x] ~~Secrets Manager em vez de variáveis de ambiente para `AUTH_JWT_SECRET` e
      `STRIPE_WEBHOOK_SECRET`.~~ Os dois viraram `*_REF`: o que o ambiente carrega
      é o **nome** de onde o valor mora. `SECRETS_DRIVER` perdeu `memory` — um
      driver de memória semeado do ambiente manteria o ambiente como fonte de
      segredo —, então o e2e passou a apontar para o localstack que ele já
      dependia. O segredo do webhook é resolvido na construção do provider e
      nunca por requisição: a assinatura cobre os bytes exatos. DEC-101.
- [x] ~~Rotação de `AUTH_JWT_SECRET`.~~ `read()` devolve
      `{ current, previous }` — uma mudança de porta, não duas, porque este item e
      o de cima eram um desenho só. Assina com o corrente, verifica contra os
      dois, e o **mesmo** `jwtVerify` confere issuer e audience nas duas
      tentativas. Um terceiro valor aposenta o primeiro, e é a suíte de
      conformidade que cobra isso — sem essa asserção, "aceita dois" e "aceita
      todos os que já existiram" passam pelos mesmos testes. O devstack semeia o
      segredo duas vezes, então a janela está sempre aberta e o `check.sh` a
      afirma a cada rodada. DEC-101.

### Dívida conhecida

- [x] ~~`verification_tokens` e `refresh_tokens` não têm expurgo.~~ O
      `RetentionSweeper` roda no worker de hora em hora e leva os dois mais o
      `outbox` publicado, com um dia de folga atrás do corte — nada no código lê
      essa folga, quem lê é quem abre um incidente de manhã. A janela é um
      contador no cache, então dois workers não varrem juntos. DEC-085.
- [ ] `invoices` e os PDFs em S3 não têm retenção. É deliberado — recibo não some
      quando a assinatura acaba —, mas "para sempre" não é política: falta
      decidir por quanto tempo, e quem responde por isso é a área fiscal, não o
      código. A exclusão de conta já leva os dois junto, por cascade. DEC-083.
- [ ] O histórico de faturas começa quando começamos a ouvir o webhook. Uma conta
      que já cobrava antes disso tem a tela vazia até a próxima cobrança. O
      backfill pelo provider é trabalho próprio, e a tabela já o comporta.
- [x] ~~Rate limit é por endereço de e-mail, não por IP.~~ São dois baldes por
      tentativa agora, e os dois são consumidos antes de qualquer um ser julgado:
      lançar no primeiro deixaria o contador de IP parado justo para quem martela
      um endereço só. O teto por IP é mais alto de propósito — um escritório atrás
      de um NAT é muita gente. DEC-084.
- [x] ~~Nenhum 429 traz `Retry-After`.~~ A porta mudou, que era a condição que a
      DEC-029 registrou: `increment` devolve `{ count, ttlSeconds }`, lidos no
      mesmo `MULTI` que escreve o contador. A recusa carrega o que sobrou da
      janela no header e no corpo. DEC-084.
- [x] ~~`RATE_LIMITED` diz "a few minutes" e mente para três das quatro regras.~~
      A copy do catálogo não nomeia janela nenhuma — não pode, porque as quatro
      regras têm duas — e a tela usa `common.retryInMinutes` com o número que o
      servidor mandou, arredondado para cima. DEC-084.
- [ ] Falta Playwright. `apps/web` agora tem teste de tela em jsdom para as seis
      páginas, o que cobre comportamento mas não renderização: nenhum teste vê
      um layout quebrado, um contraste ruim ou um foco perdido de verdade.
- [ ] A cobertura de `apps/api` caiu de 100%/91,8% (número registrado na
      DEC-028) para 96,4% de statements e 90,4% de funções, ao aposentar
      `IIdentityProvider`. O piso de 80 do `@vpn/config` continua intacto e nada
      foi rebaixado — o que sobrou descoberto são os invólucros finos de
      repositório, que a DEC-026 exclui de propósito, mais alguns ramos do
      serviço novo. Aceito por ora porque a Fase 2 mexe nesses mesmos arquivos;
      revisitar depois que o schema assentar.
- [ ] `libs/adapters`, `infra` e `packages/` não têm limiar de cobertura. O
      preset de `@vpn/config` está aplicado em `apps/api` e `apps/web`
      (DEC-028), e o número honesto dos dois só apareceu ao ligar
      `coverage.include` — antes disso a corrida contava apenas os arquivos que
      algum teste já importava, e `apps/api` reportava 90% valendo 40%.
- [x] ~~Repositório não tem teste de integração.~~
      `apps/api/src/shared/identity/identity.integration.spec.ts` fecha a metade
      que a DEC-049 deixou aberta, no mesmo harness da suíte de RLS: a
      atomicidade do `UPDATE` condicional que gasta um refresh token, o
      `SELECT … FOR UPDATE` da rotação, o `consume` do token de verificação, as
      duas restrições parciais de owner (DEC-039, DEC-052) e a corrida de slug.
      O `FOR UPDATE` é provado **removendo** o lock: sem ele o perdedor de duas
      rotações concorrentes decide por uma linha velha e devolve `rejected` em
      vez de `reuse_detected`, e só esse teste fica vermelho.
      Duas correções ao que esta linha dizia antes: a busca não é
      case-insensitive — a normalização mora em `@vpn/contracts` e o índice é o
      que a torna obrigatória —, então o que a suíte prova ali é a regra de
      ambiguidade da DEC-051; e a suíte negativa de RLS não estava pendente, ela
      chegou com a DEC-035.
- [x] ~~A página de reset mostra a tela de link inválido só quando o token está
      **ausente**.~~ Quem julga o token agora é o schema que já governa o envio,
      não a presença de uma string: um link truncado pelo cliente de e-mail cai
      na **mesma** tela de link inválido que um link sem token nenhum. O campo
      continua `hidden` e continua sem `Field`, de propósito — o que faltava não
      era onde renderizar o erro, era não ter chegado ao formulário.
- [ ] `@vpn/i18n` não tem regra de plural. Nenhuma chave precisa hoje; quando
      precisar, a troca por i18next é contida porque tudo passa por
      `getTranslator` (DEC-014).
- [ ] Não há lint que proíba string literal voltada ao usuário. A disciplina de
      i18n é revisão, não ferramenta.
- [x] ~~**O localstripe não semeia preço nenhum.**~~ Estava certo e **insuficiente**:
      semear preço só moveria a falha do `#priceFor` para a criação da sessão,
      porque o localstripe não implementa `/v1/checkout/sessions` **nem**
      `/v1/prices` — as duas respondem `404 text/plain`, e é isso que o SDK relata
      como "Invalid JSON received from the Stripe API". Medido em 2026-08-08.
      Fechado pelo outro lado (DEC-056): cobrança de verdade roda contra o Stripe
      em test mode com a CLI, `pnpm billing:prices` cria os preços na conta de quem
      roda, e a combinação impossível é recusada no boot em vez de dar 500 no
      clique. O modo offline continua no `memory`, agora com um checkout que o
      navegador abre e `pnpm billing:activate` para a ativação.
- [x] ~~`pnpm packages:publish:local` **não publica nada** no Git Bash e sai com 0.~~
      Duas causas, as duas corrigidas. O filtro `./packages/*` não casa no Git
      Bash e o `pnpm` responde `No projects matched the filters` **saindo com
      0** — o filtro saiu, e `pnpm -r` escopa por construção. E o `pnpm build`
      que precede o publish rodava os alvos do repositório **de fora**, porque
      `nx run-many` resolve a raiz subindo até o `nx.json` mais externo: ele
      publicava o `dist` que estivesse no disco, sem reconstruir. DEC-066,
      DEC-067. **Continue conferindo com
      `npm view @vpn/<pkg> version --registry …` depois.**
- [x] ~~`apps/api` não tem forma de ver o erro real de um 500 no e2e.~~
      `e2e.setup.ts` passou a usar `??=` em vez de fixar `LOG_LEVEL=silent`, então
      `LOG_LEVEL=debug pnpm --filter @vpn-poc/api test:e2e` mostra o stack que o
      `GlobalExceptionFilter` já loga. O corpo da resposta continua `INTERNAL`, e
      isso é correto — o que faltava era o log, não a resposta.
- [x] ~~**Rate limit divide balde entre accounts.**~~ O balde do sujeito passou a
      ser escopado pelo tenant que a requisição **já traz** — o slug que o login
      enviou, ou o primeiro rótulo do host. Nenhuma query entrou na frente do
      throttle, que era a razão de a DEC-050 ter deixado como estava. DEC-084.
- [ ] **O slug não pode ser renomeado.** Ele nasce derivado de um e-mail pessoal
      (DEC-052) e frequentemente não é o nome que a empresa quer. Renomear mexe
      no subdomínio já em uso, então não é só um `UPDATE`.
- [ ] **O e2e e o `worker` do `pnpm dev` disputam o mesmo `outbox`.** O relay do
      worker reivindica com `for update skip locked` as linhas que o teste ia
      drenar, e o sintoma é um teste diferente vermelho a cada corrida — e-mail
      que não chega, contagem de linhas que não bate. Hoje a resposta é parar o
      worker (`pm2 stop worker`), documentado em `docs/06-AMBIENTE-LOCAL.md` §4.
      O conserto real é o e2e ter banco ou schema próprio, que também acabaria
      com o `DELETE FROM accounts` global do `beforeEach`. O e2e já fixa
      `QUEUE_DRIVER=memory` para não dividir a fila; a tabela é o que sobra.
- [x] ~~**Nada reconcilia o nó com o banco.**~~ O worker varre `listPeers()`
      contra as linhas vivas a cada 5 min, tira o que nenhuma account
      reivindica e repõe o que um nó reconstruído esqueceu, dentro da faixa que
      o alocador distribui. DEC-071.
- [x] ~~**Nada reconcilia a subscription com o provider.**~~ O
      `SubscriptionReconciler` pergunta a cada 15 min e corrige a projeção quando
      o provider discorda, invalidando o cache de entitlement só nesse caso. Uma
      assinatura que o provider não conhece **não** apaga a linha: consulta que
      falhou não é motivo para revogar acesso de quem paga. DEC-085.
- [x] **`@RequiresCapability` ganhou chamador em produção.** `/devices` é a
      primeira rota guardada, e o 402 é provado no e2e apagando o decorator e
      vendo os dois casos virarem 201 e 200.
- [x] ~~**O reconciler repõe o peer e não carimba `provisioned_at`.**~~ A mesma
      varredura converge as duas projeções da linha agora, passado um prazo de
      120s que separa "o job está a caminho" de "o job morreu". Medido contra o
      nó real sem worker nenhum: `provisioned: 1, stamped: 1`. DEC-074.
- [x] ~~**Um peer recusado aborta a varredura inteira.**~~ Cada chamada ao nó é
      isolada e o relatório ganhou `failed`. Ninguém é carimbado como provisionado
      sem que o `wg set` dele tenha acontecido, que é o que faria a linha dizer
      que o túnel está aberto sem nada ter sido escrito no nó. DEC-085.
- [x] ~~**Nada prova que o túnel carrega tráfego.**~~ Um recurso privado sem
      porta publicada no repositório irmão `poc-vpn-canary`, duas asserções novas
      no `check.sh` (endereço do nó na rede e a **ordem** das regras de
      POSTROUTING), uma quarta seção no `tunnel:doctor` e um provador de 12
      asserções. Nenhuma linha de aplicação mudou e `packages/` não se moveu —
      que é o resultado, não a sorte. DEC-075.
- [x] ~~**A regra de MASQUERADE do nó ainda casa por interface (`-o eth0`).**~~
      Esta linha dizia "se a default virasse `eth1`". Ela **já tinha virado**:
      neste devstack `eth0` é a rede do canário e a bridge do projeto é `eth1`,
      então o egress do túnel para a bridge saía **sem NAT** — três pacotes
      atravessando o POSTROUTING e zero batendo na regra. As duas regras casam
      por destino agora, e o que faltava não era só a regra: `make check` ganhou
      uma asserção que zera o contador, emite tráfego com origem no túnel e exige
      que ela **tenha disparado**. A afirmação textual da ordem continua ao lado
      dela, porque foi ela que ficou verde o tempo todo enquanto o NAT não
      acontecia. DEC-088.
- [x] ~~**A faixa do túnel ignora o prefixo do CIDR.**~~ O alocador passou a
      trabalhar em inteiros de 32 bits e a ler a máscara: a faixa vai de
      `rede + 4` até `broadcast − 1`, então um `/25` para em `.126` em vez de
      entregar a metade que não é dele, e um `/16` atravessa octetos. Um prefixo
      sem host algum (`/30`) falha em voz alta em vez de devolver um gerador
      vazio. `10.13.13.0/24` continua rendendo exatamente os mesmos 251
      endereços, então nada observável mudou no devstack — o que mudou é que
      `EXIT_NODE_TUNNEL_CIDR` passou a significar o que diz.
      `firstFreeHost` virou `firstFreeAddress` e fala em endereço, não em octeto.
- [x] ~~**O teto de endereços deixou de ser do sistema, e ainda não virou
      capacidade utilizável.**~~ Virou: o índice é `(exit_node_id,
tunnel_address)` e o alocador lê o CIDR da linha do nó. Dois nós são duas
      faixas de 251 endereços, e o teto praticável passa a ser quantos nós
      operamos — 251 por nó **somando as accounts**, porque o nó é compartilhado.
      A starvation já não existia desde a DEC-086.
- [x] ~~**O intervalo do reconciler é de processo.**~~ Virou contador no cache:
      quem o leva de 0 a 1 é dono da janela, e o TTL a rearma. Linha travada
      custaria uma transação por turno de um laço que roda a cada 500 ms. As três
      varreduras usam a mesma forma. DEC-085.
- [x] ~~**Mudar um script CGI do nó exige `docker compose build wireguard`.**~~ O
      compose monta `control/` em `/srv/control-src` e o entrypoint copia para
      dentro no boot, então um `restart` basta. **Copiar** em vez de servir o
      mount é o conserto, não um detalhe: os CGI são `100644` no git, e servir o
      mount direto responderia 500 em qualquer host que honre esse modo — só não
      neste Windows, onde o Docker Desktop reporta `rwxrwxrwx` e o defeito ficaria
      invisível para quem escreveu. A diferença entre dev e produção é a presença
      do mount, não uma variável. DEC-089.
- [ ] **`monthlyTrafficGb` é anunciado e não aplicado.** Está no tipo para os
      tiers se descreverem. `regions` **saiu** do tipo: contar regiões só fazia
      sentido enquanto o nome era do cliente, e agora que são nossas a forma
      honesta é uma lista — que espera um segundo tier para ter o que decidir
      (DEC-043, DEC-099). `monthlyTrafficGb` continua no data plane, e é
      `docs/specs/traffic-metering.md`. `seats × devicesPerUser` **passou** a ser
      aplicado, na escrita e por índice (DEC-086); `seats` sozinho, no convite de
      usuário, ainda não é.
- [x] ~~**`pnpm --filter @vpn-poc/api build` falha.**~~ Falhava, e os builds de
      `api-lambda` e `worker` **saíam com 0** emitindo `.js` dentro de
      `libs/*/src/` e um `dist` que morre com `ERR_UNKNOWN_FILE_EXTENSION`
      porque `@vpn-poc/api` exporta `./src/bootstrap.ts`. Os três `build`, os
      dois `start` e os três `tsconfig.build.json` foram apagados: o artefato é
      um bundle. DEC-066.
- [ ] **Regenerar `0000_init` perde o `GRANT` da view.** `live_tunnel_addresses`
      é declarada com `pgView` e volta sozinha, mas
      `GRANT SELECT ... TO vpn_app` é escrito à mão em `0002_tunnel_allocation`,
      porque o drizzle-kit não modela privilégio. Uma regeneração deixaria a
      view existindo e ilegível para a aplicação. DEC-069.
- [ ] **A Lambda não tem bundle.** `infra/` precisa de `NodejsFunction` (esbuild)
      apontando para `apps/api-lambda/src/handler.ts`. É o que substitui o `tsc`
      que a DEC-066 aposentou, e sem ele não há artefato de deployment nenhum.
- [x] ~~**`pnpm lint` passa vazio sem grafo do Nx.**~~ `lint` passa por
      `scripts/nx-graph.mjs`, que constrói o grafo e sai com 1 se não conseguir,
      então "a regra foi pulada" virou "o lint falhou". Junto veio a outra metade
      do mesmo problema: as zonas de par da DEC-027 estavam enumeradas à mão e
      `modules/devices` e `modules/entitlements` não apareciam em nenhuma — agora
      são derivadas do disco. DEC-065.
- [x] ~~**Uma transação de requisição atravessa chamada externa.**~~
      `@SkipTenantTransaction()` desliga o interceptor na rota de checkout, e o
      serviço abre `runInAccount` só para ler o owner. A leitura continua dentro
      de um escopo, então não é o escape hatch que se temia — é uma transação mais
      curta. O escasso é a conexão do pool, não a transação. DEC-087.

### Fase 2 — o PoC whitelabel

A linha de chegada: **o usuário se registra, assina, cria usuários e chaves, e
conecta**. As decisões estão em DEC-034 a DEC-045; o vocabulário, em
`CONTEXT.md`. A ordem abaixo é a que a natureza de cada entitlement impõe —
capability se aplica no request, contador na escrita, região no
provisionamento, tráfego continuamente — e as duas últimas dependem de um data
plane que ainda não existe.

- [x] **Tirar o envio de e-mail da requisição.** Outbox transacional, porta
      `IJobQueue` sobre SQS, relay e consumer no kernel, `apps/worker` como laço.
      Publicar depois do commit teria sido o mesmo dual-write de novo — o
      `convoy` documenta essa lacuna como `*_enqueue_failed`. DEC-046/047/048, e
      `docs/specs/queued-notifications.md`.
- [x] **Corrigir o webhook.** Reivindicação e aplicação na mesma transação, e
      guarda monotônica no upsert. Cobrança é recorrente: todo período gera
      eventos, e um evento fora de ordem retrocedia o período de um cliente
      adimplente. DEC-037, e a porta ganhou `occurredAt` (`@vpn/ports` 0.4.0).
- [x] **Account/User e RLS.** `accounts` vira `users`; nasce `accounts` como a
      empresa; `subscriptions.account_id` muda de significado sem mudar de nome.
      `0000_init` é regenerada — não há deploy. Policy por tabela e **um teste
      negativo por tabela**. Atenção: o e2e limpa como `vpn_app` e sob RLS isso
      passa a apagar zero linhas em silêncio. DEC-034, DEC-035.
- [x] **Entitlements e o gate de assinatura.** O mapa em `@vpn/contracts` com um
      tier (`pro`) e uma capability (`vpn_access`), `resolveTier` a partir do
      status, leitura por requisição via `ICacheStore` guardando o **tier**,
      `GET /entitlements`, `CapabilityGuard` no kernel e invalidação no webhook —
      provada removendo a chamada e vendo os dois cenários de cache quente ficarem
      vermelhos. DEC-036, DEC-037, DEC-054, DEC-055, e
      `docs/specs/entitlements-and-plans.md`.
- [x] **Página de usuários.** Listar, criar, mudar role e remover, tudo atrás de
      `@RequiresRole('admin')` — a primeira e única rota barrada por role, provada
      apagando o decorator e vendo o 403 virar 200. A senha é **gerada e mostrada
      uma vez**, e o user nasce verificado porque o admin avalizou (DEC-076).
      Mudar a role ou remover **mata as sessões da pessoa**: `role` viaja dentro
      de um token de 15 min que ninguém revoga. Os cinco casos que fabricavam um
      colega com SQL cru agora o criam pelo endpoint e entram com a senha
      devolvida — se "nasce verificado" estivesse errado, eles ficariam vermelhos.
      `docs/specs/user-management.md`.
- [x] ~~**Servidores e regiões.**~~ A frota é **nossa**: cinco regiões e cinco
      nós semeados por migration, sem rota, tela ou permissão que os altere. Quem
      gera a chave escolhe a região e a atribuição do nó é nossa, no menos
      carregado que respondeu há menos de 180s. `exit_nodes` e `regions` são as
      duas únicas tabelas de domínio fora do RLS, com escrita revogada do papel do
      tenant; o endereço de túnel é único **por nó**; e tanto a varredura quanto o
      provisionamento rodam por nó, com um nó calado pulado em vez de lido como
      vazio. O devstack sobe **cinco**, um por região demonstrada, e só um deles
      alcança o canário: é essa assimetria que faz a escolha decidir por onde o
      pacote sai. DEC-090 a DEC-100, e `docs/specs/servers-and-regions.md`.
- [x] **Spike do WireGuard, depois a spec.** Contêiner com `NET_ADMIN`,
      `/dev/net/tun` e `21820/udp`, um peer semeado à mão, handshake provado da
      GUI do WireGuard for Windows e egress provado por NAT — o publish de UDP
      através da VM do WSL2 era a incógnita e funciona. DEC-062, e
      `docs/specs/data-plane.md`, que registra o que **não** sobrevive a um nó
      real.
- [x] **Página de chaves e a conexão.** Par gerado no navegador com fallback
      medido, `.conf` montado no cliente, `devices` sob RLS, peer reconciliado
      pelo outbox e `@RequiresCapability('vpn_access')` com o primeiro chamador
      de produção — provado apagando o decorator e vendo o 402 virar 201.
      DEC-045, DEC-063, DEC-064, e `docs/specs/keys-and-connection.md`.

### Fase 3 — quando o produto exigir

- [ ] Domínio por account e branding. As decisões existem (DEC-038, DEC-040) e
      não constroem nada em direção a um túnel.
- [ ] Apps nativos (React Native, Tauri/Electron). Refresh por body, tenant por
      slug, e **nenhum fluxo de compra**. DEC-041, DEC-042.
- [ ] Metering de tráfego. `monthlyTrafficGb` existe no tipo para os tiers
      anunciarem; a aplicação depende de medição contínua e continua adiada.
- [x] ~~Regiões.~~ **Subiu para a Fase 2 e fechou lá.** Esta linha dizia "quando
      o produto exigir" e chamava a aplicação de "explicitamente adiada"; o brief
      pede servidores e regiões como escopo obrigatório, então a condição foi
      satisfeita por fora. A razão do adiamento era não haver o segundo nó, e é ela
      que a entrega desfez: são cinco. O entitlement de região saiu do tier: contar
      só fazia sentido enquanto o nome era do cliente, e ele volta como lista de
      slugs nossos quando houver um segundo tier. DEC-090, DEC-099.
- [ ] SMS de verdade atrás de `ISmsSender` (SNS ou Twilio).
- [ ] Expurgo do `outbox` publicado. Como `verification_tokens` e
      `refresh_tokens`, cresce para sempre; é o mesmo job.

---

## Como validar o que está pronto

```bash
make up && make check                                # devstack: 65/65
pnpm --filter @vpn-poc/api test:e2e                  # 122, o fluxo inteiro
pnpm --filter @vpn-poc/api test:integration          # 65, RLS e formas de SQL
pnpm --filter @vpn-poc/adapters test:integration     # 90, adapters reais
pnpm dev                                             # api :3000, web :5173
```

Depois, no navegador: cadastro → mailpit em <http://localhost:28025> → confirmar
→ entrar → esqueci a senha → redefinir → entrar com a senha nova → assinar.
