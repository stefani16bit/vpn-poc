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

**`StripeBillingProvider.parseWebhookEvent`** confia no `status`, não no nome do
evento: um `customer.subscription.updated` que chega com `status: 'canceled'` é
um cancelamento. Confiar no nome é como uma assinatura cancelada acaba gravada
como ativa.

**E lê as duas formas de payload**, porque um endpoint de webhook guarda para
sempre a versão de API com que foi criado, enquanto o default da conta anda para
frente. `current_period_end` mora na subscription até `2025-02-24.acacia` e nos
**items** depois; `subscription_details` da invoice mora na raiz antes e sob
`parent` depois. Ler só uma das formas é o que fazia um `invoice.payment_failed`
real normalizar para `null` — webhook respondendo `applied: false`, e-mail de
dunning nunca enviado, nada vermelho em nenhum teste. Ver DEC-057.

**`ConsoleSmsSender`** lança no construtor se `NODE_ENV=production`. Ele imprime
o código em vez de enviar; falhar no boot é melhor que o usuário nunca receber.

**`HttpExitNode`** carrega a credencial do nó, e a porta não sabe disso. É
`Authorization: Basic`, com o nome `worker` fixo nas duas pontas, porque quem
cobra é o `busybox httpd` do nó — o 401 sai antes de qualquer CGI rodar, então não
existe script que possa esquecer a checagem. Um token `Bearer` conferido dentro
dos três CGI seria três cópias da mesma guarda. DEC-073.

Ele **lança no construtor** com token vazio, no mesmo espírito do
`ConsoleSmsSender`: o `?? ''` da factory existe para o tipo, e sem essa guarda ele
seria um caminho silencioso para falar anônimo com o nó. Quem falha primeiro, e
com a mensagem melhor, é `assertDriverConfiguration`.

Trocar de esquema é uma linha aqui. A suíte de conformidade **não muda** — se
precisar mudar, a credencial vazou para a porta.

## Don't

- Não construa um adapter fora do registry. Se um módulo faz `new`, a
  substituibilidade virou ficção.
- Não importe de `apps/` — o lint bloqueia (`type:adapter` só depende de
  `type:lib`).
- Não adicione um método a uma porta sem estender a suíte de conformidade
  primeiro. Os dois adapters têm que passar — com **uma** exceção conhecida e
  escrita: `describeBillingProviderContract` não roda contra o
  `StripeBillingProvider`, porque ela começa por `createCheckout` e o localstripe
  não implementa `/v1/checkout/sessions` (DEC-009). Enquanto a suíte não for
  partida em checkout e ciclo de vida, o que o Stripe faz com uma subscription é
  pinado à mão em `stripe.integration.spec.ts`. DEC-060.
- Não faça um adapter revalidar o que a porta já promete; a suíte é o contrato.
- Não use string como token de DI. `Symbol.for('vpn.*')`, em `@vpn/ports`.
