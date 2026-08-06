# libs/adapters

**Status:** mature · **Tag:** `type:adapter`

As implementações reais das portas de `@vpn/ports`, mais o registry que decide
qual delas é montada. É o único lugar do sistema que constrói um adapter.

## Registry

`registry.ts` + `adapters.module.ts`. Cada porta declara um `defineAdapter` com
o token, uma função que lê o driver do env, e um mapa `driver → factory`. Um
driver desconhecido falha no boot com a lista dos conhecidos — não em silêncio
na primeira chamada.

O generic de `defineAdapter<IPorta>` é obrigatório. Sem ele o TypeScript infere
o tipo do **primeiro** driver do mapa e passa a exigir que os outros tenham os
campos privados dele.

## Decisões que a porta não dita

**`RedisCacheStore.increment`** usa `EXPIRE ... NX`, não `EXPIRE`. `INCR`
seguido de `EXPIRE` são dois round trips; um crash entre eles deixa um contador
sem TTL, e um rate limit que nunca reseta trava o usuário para sempre parecendo
bug do limitador.

**`SmtpEmailSender`** reivindica a chave de idempotência no cache **antes** de
enviar, e a libera se o envio lançar. Enviar primeiro e registrar depois
re-envia no retry, que é exatamente o e-mail duplicado que a chave existe para
evitar.

**`ScryptPasswordHasher`** deriva `maxmem` dos parâmetros (`128·N·r·2`). Uma
constante fixa quebra ao subir `N`, com um erro do OpenSSL que não aponta para o
parâmetro que mudou. O padrão do Node (32 MB) é menor que qualquer configuração
sensata.

**`DrizzleIdentityProvider.authenticate`** roda o hash mesmo quando a conta não
existe, contra `ABSENT_ACCOUNT_HASH`. Um retorno antecipado torna o caso
"endereço desconhecido" mensuravelmente mais rápido, e isso enumera contas tão
bem quanto uma mensagem de erro diferente.

**`DrizzleIdentityProvider.refreshSession`** marca o token gasto dentro de um
`UPDATE ... WHERE spent_at IS NULL`. Um `SELECT` seguido de `UPDATE` deixa dois
refreshes concorrentes passarem.

**`StripeBillingProvider.parseWebhookEvent`** confia no `status`, não no nome do
evento: um `customer.subscription.updated` que chega com `status: 'canceled'` é
um cancelamento. Confiar no nome é como uma assinatura cancelada acaba gravada
como ativa.

**`ConsoleSmsSender`** lança no construtor se `NODE_ENV=production`. Ele imprime
o código em vez de enviar; falhar no boot é melhor que o usuário nunca receber.

## Don't

- Não construa um adapter fora do registry. Se um módulo faz `new`, a
  substituibilidade virou ficção.
- Não importe de `apps/` — o lint bloqueia (`type:adapter` só depende de
  `type:lib`).
- Não adicione um método a uma porta sem estender a suíte de conformidade
  primeiro. Os dois adapters têm que passar.
- Não faça um adapter revalidar o que a porta já promete; a suíte é o contrato.
- Não use string como token de DI. `Symbol.for('vpn.*')`, em `@vpn/ports`.
