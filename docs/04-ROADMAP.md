# Roadmap

Este arquivo faz as vezes de issue tracker. Não abra issues; edite aqui.

---

## Estado — 2026-08-05

**Fase 1 + i18n entregues.** Cadastro, verificação, login, rotação de sessão,
reset de senha e assinatura funcionando de ponta a ponta contra o devstack, em
pt-BR e en.

| Suíte                                                                                       | Testes  | Precisa do devstack |
| ------------------------------------------------------------------------------------------- | ------- | ------------------- |
| `packages/` — portas, contratos, i18n, fakes                                                | 213     | não                 |
| `libs/env`                                                                                  | 11      | não                 |
| `libs/adapters` — render de e-mail/SMS, redação                                             | 13      | não                 |
| `apps/api` — AppError, ZodBody, filtro, health                                              | 19      | não                 |
| `apps/web` — store, normalização de erro, locale                                            | 18      | não                 |
| `infra` — validação de config CDK                                                           | 11      | não                 |
| **Subtotal `pnpm verify`**                                                                  | **285** | **não**             |
| `libs/adapters` — as mesmas suítes contra Redis, Postgres, mailpit, LocalStack, localstripe | 89      | sim                 |
| `apps/api` — fluxo completo mais a matriz de locale                                         | 47      | sim                 |
| **Total**                                                                                   | **421** |                     |

`make check` 12/12 · `cdk synth` 6 stacks · `consumer-check` verde ·
`pnpm lint` verde e provado que falha num import proibido.

`pnpm verify` roda com o Docker parado, de propósito: `*.integration.spec.ts`
está excluído do config unitário. Uma suíte que fica vermelha sem Docker ensina
a ignorar suíte vermelha.

## Próximo

### Antes de qualquer deploy

- [ ] **Validar Stripe Checkout contra a API real em staging.** localstripe não
      tem o endpoint (DEC-009), então `createCheckout` do adapter Stripe é o
      único ponto do sistema sem cobertura contra o provider.
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
- [ ] Repositório não tem teste de integração. A DEC-049 fecha **metade** disso:
      a suíte de conformidade de `IIdentityProvider` não foi apagada com a porta,
      e a parte de política dela virou teste unitário de `IdentityService`. A
      parte de **forma de SQL** — a atomicidade do `UPDATE` condicional que gasta
      o token, o `SELECT … FOR UPDATE` da rotação e a busca case-insensitive
      contra o Postgres real — ainda não tem casa e segue coberta só pelo e2e.
      Entra junto com a suíte
      negativa de RLS, que precisa do mesmo harness; escrevê-la antes seria
      escrevê-la contra um schema que a DEC-034 vai renomear.
- [ ] A página de reset mostra a tela de link inválido só quando o token está
      **ausente**. Um token presente e malformado deixa um formulário que se
      recusa a enviar e não mostra nada, porque o campo de token não tem `Field`
      para renderizar o erro.
- [ ] `@vpn/i18n` não tem regra de plural. Nenhuma chave precisa hoje; quando
      precisar, a troca por i18next é contida porque tudo passa por
      `getTranslator` (DEC-014).
- [ ] Não há lint que proíba string literal voltada ao usuário. A disciplina de
      i18n é revisão, não ferramenta.
- [ ] **O localstripe não semeia preço nenhum.** `price_local_monthly` e
      `price_local_yearly` respondem 404, e nada em `devstack/` os cria — o
      `.env.example` aponta para preços que não existem. O e2e não pega porque
      usa `BILLING_DRIVER=memory`; quem paga é quem testa no navegador.
- [ ] `pnpm packages:publish:local` **não publica nada** no Git Bash e sai com 0.
      O filtro `./packages/*` não casa e o resultado é
      `No projects matched the filters`. **As variáveis de ambiente sozinhas não
      resolvem** — medido em 2026-08-07: com `MSYS_NO_PATHCONV=1` e
      `MSYS2_ARG_CONV_EXCL='*'` exportadas, o script da raiz continua publicando
      zero pacotes e saindo com 0. O que funciona é rodar o comando de dentro de
      `packages/`, invocando o `pnpm -r --filter './packages/*' publish`
      diretamente em vez de passar pelo `pnpm -C packages` do script da raiz, que
      resolve o filtro contra o diretório errado. Consertar o script — ou
      fazê-lo falhar quando publica zero pacotes — vale mais que o contorno,
      porque um publish silenciosamente pulado é o pior modo de falha possível
      para a DEC-002. **Confira sempre com
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
- [ ] **Entitlements e o gate de assinatura.** O mapa em `@vpn/contracts` com
      **um** tier, leitura por requisição com cache, invalidação no webhook.
      É aqui que assinar passa a desbloquear alguma coisa. DEC-036, DEC-037.
- [ ] **Página de usuários.** Admin cria user direto com senha, dentro da
      account. Sem convite por e-mail no PoC. Seats não são aplicados com um
      tier só; DEC-043 registra o mecanismo para quando forem.
- [ ] **Spike do WireGuard, depois a spec.** `devstack/` não tem WireGuard, nem
      `NET_ADMIN`, nem `/dev/net/tun`. Subir o contêiner, adicionar um peer à
      mão, conectar do host Windows — que usa o cliente WireGuard for Windows,
      **não** `wg-quick` — e só então escrever `docs/specs/data-plane.md`.
- [ ] **Página de chaves e a conexão.** Par gerado no navegador, `.conf` montado
      no cliente, peer provisionado no nó, entitlement aplicado no servidor.
      DEC-045.

### Fase 3 — quando o produto exigir

- [ ] Domínio por account e branding. As decisões existem (DEC-038, DEC-040) e
      não constroem nada em direção a um túnel.
- [ ] Apps nativos (React Native, Tauri/Electron). Refresh por body, tenant por
      slug, e **nenhum fluxo de compra**. DEC-041, DEC-042.
- [ ] Regiões e metering de tráfego. `monthlyTrafficGb` existe no tipo para os
      tiers anunciarem; a aplicação depende do data plane e é explicitamente
      adiada.
- [ ] SMS de verdade atrás de `ISmsSender` (SNS ou Twilio).
- [ ] Expurgo do `outbox` publicado. Como `verification_tokens` e
      `refresh_tokens`, cresce para sempre; é o mesmo job.

---

## Como validar o que está pronto

```bash
make up && make check                                # devstack: 12/12
pnpm --filter @vpn-poc/api test:e2e                  # 37, o fluxo inteiro
pnpm --filter @vpn-poc/adapters test:integration     # 86, adapters reais
pnpm dev                                             # api :3000, web :5173
```

Depois, no navegador: cadastro → mailpit em <http://localhost:28025> → confirmar
→ entrar → esqueci a senha → redefinir → entrar com a senha nova → assinar.
