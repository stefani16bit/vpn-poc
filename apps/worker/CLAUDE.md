# apps/worker

**Status:** new · **Tag:** `type:app`

O laço que drena o outbox e entrega as notificações. É **só** o laço: um
`main.ts`, sem regra de negócio e sem teste próprio.

## Por que não tem nada aqui

Tudo que ele faz mora no kernel de `apps/api`: `OutboxRelay`,
`NotificationConsumer`, `NotificationDispatcher`. Este app monta um
`ApplicationContext` do Nest a partir do mesmo `AppModule` — o mesmo movimento
que `apps/api-lambda` faz com `createApp()` — e chama `runOnce()` num laço.

Isso é deliberado e tem uma consequência que vale mais que a economia de código:
**o e2e drena no mesmo processo**, chamando `app.get(OutboxRelay)`. Se o relay
morasse aqui, o teste de ponta a ponta teria que duplicar a lógica ou o
`apps/api` teria que depender de `apps/worker`, que já depende dele.

A ordem no laço é relay → consumer: publicar antes de consumir faz uma
notificação recém-escrita sair na mesma volta em vez de esperar a próxima.

## Coisas que quebram de formas não óbvias

**Um job não reconhecido não é um job perdido.** O consumer só chama
`acknowledge` depois de o envio voltar. Um `kind` desconhecido e um envio que
lança terminam do mesmo jeito: sem reconhecimento, de volta para a fila, e na
DLQ depois de `maxReceiveCount`. Reconhecer antes de enviar é o que perderia
e-mail em silêncio.

**Uma falha não derruba o lote.** Cada job é despachado dentro do seu próprio
try/catch. Sem isso, uma mensagem envenenada trava as outras nove a cada
redelivery.

**`autorestart` está desligado no pm2**, como nos outros processos: um crash em
desenvolvimento é informação, não algo para esconder num laço de restart.

## Don't

- Não coloque regra de negócio aqui. Se o worker precisa saber algo, isso é
  serviço do kernel de `apps/api` e o worker resolve do container.
- Não faça `apps/api` depender deste pacote. A seta aponta em um sentido só.
- Não reconheça um job antes de o efeito ter acontecido.
