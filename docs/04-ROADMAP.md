# Roadmap

Este arquivo faz as vezes de issue tracker. Não abra issues; edite aqui.

---

## Estado — 2026-08-05

**Fase 1 + i18n entregues.** Cadastro, verificação, login, rotação de sessão,
reset de senha e assinatura funcionando de ponta a ponta contra o devstack, em
pt-BR e en.

| Suíte | Testes | Precisa do devstack |
| --- | --- | --- |
| `packages/` — portas, contratos, i18n, fakes | 213 | não |
| `libs/env` | 11 | não |
| `libs/adapters` — render de e-mail/SMS, redação | 13 | não |
| `apps/api` — AppError, ZodBody, filtro, health | 19 | não |
| `apps/web` — store, normalização de erro, locale | 18 | não |
| `infra` — validação de config CDK | 11 | não |
| **Subtotal `pnpm verify`** | **285** | **não** |
| `libs/adapters` — as mesmas suítes contra Redis, Postgres, mailpit, LocalStack, localstripe | 89 | sim |
| `apps/api` — fluxo completo mais a matriz de locale | 47 | sim |
| **Total** | **421** | |

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
- [ ] Falta Playwright. `apps/web` agora tem teste de tela em jsdom para as seis
      páginas, o que cobre comportamento mas não renderização: nenhum teste vê
      um layout quebrado, um contraste ruim ou um foco perdido de verdade.
- [ ] `libs/adapters`, `infra` e `packages/` não têm limiar de cobertura. O
      preset de `@vpn/config` está aplicado em `apps/api` e `apps/web`
      (DEC-028), e o número honesto dos dois só apareceu ao ligar
      `coverage.include` — antes disso a corrida contava apenas os arquivos que
      algum teste já importava, e `apps/api` reportava 90% valendo 40%.
- [ ] Repositório não tem teste de integração. DEC-026 aceita isso e apoia a
      corretude no e2e; um teste de integração por repositório fecharia a
      lacuna sem reabrir a discussão de porta.
- [ ] A página de reset mostra a tela de link inválido só quando o token está
      **ausente**. Um token presente e malformado deixa um formulário que se
      recusa a enviar e não mostra nada, porque o campo de token não tem `Field`
      para renderizar o erro.
- [ ] `@vpn/i18n` não tem regra de plural. Nenhuma chave precisa hoje; quando
      precisar, a troca por i18next é contida porque tudo passa por
      `getTranslator` (DEC-014).
- [ ] Não há lint que proíba string literal voltada ao usuário. A disciplina de
      i18n é revisão, não ferramenta.

### Fase 2 — quando o produto exigir

- [ ] Multi-tenancy com RLS. Os papéis de banco já existem (DEC-005); falta
      `tenant_id`, as policies e um teste negativo obrigatório por tabela.
- [ ] SMS de verdade atrás de `ISmsSender` (SNS ou Twilio).
- [ ] WireGuard: emissão de chave no cliente, provisionamento de peer,
      orquestração de nós de saída.
- [ ] Fila para envio de e-mail. Hoje o envio é síncrono dentro da requisição:
      um SMTP lento é um cadastro lento.

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
