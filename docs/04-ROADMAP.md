# Roadmap

Este arquivo faz as vezes de issue tracker. Não abra issues; edite aqui.

---

## Estado — 2026-08-10

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

| Suíte                                                       | Testes   | Precisa do devstack |
| ----------------------------------------------------------- | -------- | ------------------- |
| `packages/` — portas, contratos, i18n, fakes                | 248      | não                 |
| `libs/env`                                                  | 23       | não                 |
| `libs/adapters` — render de e-mail/SMS, redação, webhook    | 22       | não                 |
| `apps/api` — kernel, serviços, controllers                  | 474      | não                 |
| `apps/web` — store, telas, normalização de erro, locale     | 226      | não                 |
| `infra` — validação de config CDK                           | 11       | não                 |
| **Subtotal `pnpm verify`**                                  | **1004** | **não**             |
| `libs/adapters` — as mesmas suítes contra os serviços reais | 90       | sim                 |
| `apps/api` — RLS, transações, a view e o trigger            | 63       | sim                 |
| `apps/api` — fluxo completo mais a matriz de locale         | 103      | sim                 |
| **Total**                                                   | **1260** |                     |

Cobertura com piso aplicado, e o piso só sobe (DEC-028): `apps/api` em
94/87/88/93 (linhas/funções/ramos/statements), `apps/web` em 97/95/92/96.
Conferido como portão: `--coverage.thresholds.branches=99` falha citando o
valor real.

`make check` 19/19 · `cdk synth` 6 stacks · `consumer-check` verde ·
`pnpm lint` verde e provado que falha num import proibido.

`pnpm verify` roda com o Docker parado, de propósito: `*.integration.spec.ts` e
`*.e2e.spec.ts` estão excluídos do config unitário. Uma suíte que fica vermelha
sem Docker ensina a ignorar suíte vermelha.

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
- [ ] **A suíte de conformidade de billing não roda contra o Stripe.** Ela começa
      por `createCheckout`, e o localstripe não implementa `/v1/checkout/sessions`
      (DEC-009), então registrar o adapter real faria o bloco de checkout falhar
      por limitação do mock. O conserto é partir a suíte em dois — checkout e ciclo
      de vida — para que o Stripe passe pelo segundo; hoje cancelar e retomar são
      pinados à mão em `stripe.integration.spec.ts`. DEC-060.
- [x] ~~**O agente do nó não tem autenticação.**~~ O plano de controle exige
      credencial, cobrada pelo `httpd` do nó antes de qualquer CGI rodar, e
      `EXIT_NODE_DRIVER=http` sem token falha no boot. A porta não mudou, então
      `packages/` não se moveu. DEC-073.
- [ ] **A credencial do nó é um token só, para a frota inteira.** Trocá-lo
      derruba todos os nós ao mesmo tempo, e não há como distinguir no log qual
      chamador o usou. O alvo é mTLS, que é certificado de cliente num dispatcher
      de `fetch` mais terminação TLS no nó — o `busybox httpd` não fala TLS, então
      isso é trabalho de nó real e da stack `network`. DEC-073, DEC-011.
- [ ] Preencher as stacks CDK. Ordem: `network` → `data` → `events` → `api`.
- [ ] Secrets Manager em vez de variáveis de ambiente para `AUTH_JWT_SECRET` e
      `STRIPE_WEBHOOK_SECRET`.
- [ ] Rotação de `AUTH_JWT_SECRET` — hoje uma troca invalida todo access token
      em circulação de uma vez. Precisa aceitar dois segredos durante a janela.

### Dívida conhecida

- [ ] `verification_tokens` e `refresh_tokens` não têm expurgo. Crescem para
      sempre. É um job, e é o primeiro candidato à `WorkersStack`.
- [ ] Rate limit é por endereço de e-mail, não por IP. Um atacante com uma lista
      de endereços não é limitado por nada.
- [ ] Nenhum 429 traz `Retry-After`, e o cliente não tem como saber quanto
      esperar. Não é obtível sem mudar a porta: `ICacheStore.increment` devolve
      a contagem, não o TTL restante. Ver DEC-029.
- [ ] `RATE_LIMITED` diz "a few minutes" em `@vpn/i18n`, mas `register`,
      `forgotPassword` e `resendVerification` têm janela de uma hora. A mensagem
      mente para três das quatro regras.
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
- [ ] A página de reset mostra a tela de link inválido só quando o token está
      **ausente**. Um token presente e malformado deixa um formulário que se
      recusa a enviar e não mostra nada, porque o campo de token não tem `Field`
      para renderizar o erro.
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
- [ ] **Rate limit divide balde entre accounts.** A chave é o e-mail, então o
      mesmo endereço em duas empresas compartilha o limite e martelar o login de
      uma tranca a pessoa da outra. Corrigir exige resolver a account **antes**
      de limitar, que é trabalho antes do throttle — daí ficar como está.
      DEC-050.
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
- [ ] **Nada reconcilia a subscription com o provider.** Se um webhook se perder,
      a projeção fica parada e a account continua entitulada para sempre — o TTL
      de 60s do cache encurta a janela de uma invalidação perdida, não a de um
      evento que nunca chegou. O conserto é um job que pergunta ao provider, e é o
      mesmo `WorkersStack` do expurgo. DEC-054.
- [x] **`@RequiresCapability` ganhou chamador em produção.** `/devices` é a
      primeira rota guardada, e o 402 é provado no e2e apagando o decorator e
      vendo os dois casos virarem 201 e 200.
- [x] ~~**O reconciler repõe o peer e não carimba `provisioned_at`.**~~ A mesma
      varredura converge as duas projeções da linha agora, passado um prazo de
      120s que separa "o job está a caminho" de "o job morreu". Medido contra o
      nó real sem worker nenhum: `provisioned: 1, stamped: 1`. DEC-074.
- [ ] **Um peer recusado aborta a varredura inteira.** As chamadas ao nó não são
      isoladas peer a peer, então um `wg set` que falhe deixa o resto da varredura
      sem rodar e nada é carimbado. A próxima varredura repete e `wg set`
      converge, então isso custa latência e não correção — mas o relatório mente
      sobre quanto havia para fazer. DEC-074.
- [x] ~~**Nada prova que o túnel carrega tráfego.**~~ Um recurso privado sem
      porta publicada no repositório irmão `poc-vpn-canary`, duas asserções novas
      no `check.sh` (endereço do nó na rede e a **ordem** das regras de
      POSTROUTING), uma quarta seção no `tunnel:doctor` e um provador de 12
      asserções. Nenhuma linha de aplicação mudou e `packages/` não se moveu —
      que é o resultado, não a sorte. DEC-075.
- [ ] **A regra de MASQUERADE do nó ainda casa por interface (`-o eth0`).** Com
      duas redes, qual interface o Docker entrega a cada uma não é garantido, e
      se a default virasse `eth1` o egress à internet pararia de ser mascarado. O
      caminho do canário não corre esse risco — a regra de `RETURN` casa por
      **destino**, de propósito. Ficou como está porque `data-plane.md` documenta
      a linha de MASQUERADE textualmente e a sonda `200 → 000 → 200` dela cita a
      regra exata. DEC-075.
- [ ] **A faixa do túnel ignora o prefixo do CIDR.** `assignableAddresses` e
      `isAssignable` usam só os três primeiros octetos, então `10.13.13.0/25`
      é tratado como `/24` e o alocador distribuiria endereços fora da faixa.
      Anterior a este trabalho, agora com teste que fixa o comportamento — o
      teste descreve o que é, não o que deveria ser.
- [ ] **O intervalo do reconciler é de processo.** Dois workers varreriam em
      paralelo; hoje há um. Quando houver dois, o throttle vira linha travada
      ou chave no cache, não um campo privado.
- [ ] **Mudar um script CGI do nó exige `docker compose build wireguard`.**
      `control/` entra na imagem por `COPY`, não por bind mount, então um
      `restart` continua servindo o script velho — e o sintoma é a suíte de
      conformidade do `HttpExitNode` vermelha contra um adapter correto.
- [ ] **`seats`, `devicesPerUser`, `monthlyTrafficGb` e `regions` são anunciados e
      não aplicados.** Estão no tipo para os tiers se descreverem; o contador
      depende da DEC-043 e os dois últimos do data plane. Com um tier só não há o
      que aplicar, e meio-aplicar um contador parece aplicado.
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
- [ ] **Uma transação de requisição atravessa chamada externa.**
      `BillingService.createCheckout` fala com o Stripe com a transação aberta,
      prendendo uma conexão do pool pela ida e volta. É um handler hoje; a
      alternativa era um escape hatch que reabre o buraco da query sem escopo.

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
- [ ] **Página de usuários.** Admin cria user dentro da account, e a senha é
      **gerada e mostrada uma vez** — não digitada pelo admin, que é a única
      senha do sistema que nasceria fraca por construção. Sem convite por e-mail
      no PoC; o user nasce verificado porque o admin avalizou. Traz
      `@RequiresRole`, e só esta rota. Seats não são aplicados com um tier só.
      DEC-076, e `docs/specs/user-management.md`.
- [ ] **Servidores e regiões.** Escopo obrigatório do brief, e a peça que subiu
      da Fase 3. O tenant registra os próprios nós e os agrupa em regiões que
      **ele** nomeia; o usuário final escolhe região e a atribuição do nó é
      nossa. `exit_nodes` e `regions` viram tabelas sob RLS, a faixa de endereços
      passa a ser por nó — o que levanta um teto de duas accounts — e a varredura
      passa a rodar por nó. DEC-077, DEC-078, e
      `docs/specs/servers-and-regions.md`.
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
- [~] ~~Regiões.~~ **Subiu para a Fase 2, atropelado pelo brief.** Esta linha
  dizia "quando o produto exigir" e chamava a aplicação de "explicitamente
  adiada"; o brief pede gerenciamento de servidores e regiões como escopo
  obrigatório, então a condição foi satisfeita por fora. Fica registrado em
  vez de reordenado em silêncio, porque a razão do adiamento — não havia o
  segundo nó — continua sendo a razão pela qual isto é caro. DEC-077,
  DEC-078.
- [ ] SMS de verdade atrás de `ISmsSender` (SNS ou Twilio).
- [ ] Expurgo do `outbox` publicado. Como `verification_tokens` e
      `refresh_tokens`, cresce para sempre; é o mesmo job.

---

## Como validar o que está pronto

```bash
make up && make check                                # devstack: 19/19
pnpm --filter @vpn-poc/api test:e2e                  # 84, o fluxo inteiro
pnpm --filter @vpn-poc/api test:integration          # 54, RLS e formas de SQL
pnpm --filter @vpn-poc/adapters test:integration     # 74, adapters reais
pnpm dev                                             # api :3000, web :5173
```

Depois, no navegador: cadastro → mailpit em <http://localhost:28025> → confirmar
→ entrar → esqueci a senha → redefinir → entrar com a senha nova → assinar.
