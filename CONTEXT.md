# Glossário do domínio

Termo novo entra aqui **antes** de virar tabela, campo ou tipo. O objetivo é que
o código e a conversa usem a mesma palavra para a mesma coisa — e palavras
diferentes para coisas diferentes.

---

## Identidade

**Account** — quem se cadastra. Uma linha em `accounts`, identificada por
e-mail. Deliberadamente não chamada de "user": *user* é quem está usando o
sistema agora, e a distinção importa quando aparecer acesso delegado.

**E-mail normalizado** — minúsculo e sem espaços nas pontas. A normalização
acontece no schema em `@vpn/contracts`, num lugar só, e o índice único em
`accounts.email` é o que a torna obrigatória em vez de decorativa.

**Verificado** — a conta provou controlar o endereço. É um *timestamp*
(`email_verified_at`), não um booleano: "quando" responde perguntas de suporte
que "se" não responde. Verificar de novo não move o timestamp.

## Sessão

**Session family** — o conjunto de refresh tokens que descendem de um mesmo
login. Uma linha em `session_families`. É a unidade de revogação: logout,
troca de senha e detecção de roubo matam a família, não um token.

**Rotação** — cada uso de um refresh token emite um novo e marca o antigo como
*gasto*. Um token gasto nunca volta a valer.

**Reuse detected** — alguém apresentou um token já gasto. O cliente legítimo já
rotacionou, então isto é a assinatura de um token roubado sendo reproduzido. A
resposta é revogar a família inteira — o ladrão e a vítima caem juntos, e a
vítima faz login de novo.

**Access token** — JWT de vida curta (15 min), assinado com HS256, **não
revogável**. A revogação mora no refresh token. Uma saída de sessão leva no
máximo uma vida de token para ter efeito, e esse é o preço de não consultar o
banco a cada requisição.

## Tokens de uso único

**Verification token** — 32 bytes de aleatoriedade, entregues uma vez ao
usuário e guardados só como SHA-256. Serve a dois propósitos
(`email_verification`, `password_reset`) na mesma tabela.

**Consumido** — resgatado. Marcado dentro do próprio `UPDATE` condicional, e é
isso que faz o resgate ser único sob concorrência.

**Emitir invalida o anterior** — pedir um novo link de reset consome o link
anterior. Dois links válidos ao mesmo tempo dobram a janela de ataque, e o
usuário pede um novo justamente porque acha que o primeiro falhou.

## Cobrança

**Billing provider** — quem processa o pagamento. Stripe em produção,
`MemoryBillingProvider` localmente (DEC-009).

**Checkout session** — a página hospedada pelo provider onde o cartão é
digitado. Redirecionamos para ela; dados de cartão nunca passam por esta
origem.

**Normalized billing event** — o webhook do provider traduzido para o nosso
vocabulário. `parseWebhookEvent` é a única função do sistema que sabe o formato
do provider.

**External event id** — o identificador do evento no provider. É a chave de
deduplicação: todo provider reentrega, e uma reentrega de `payment_failed` não
pode mandar um segundo e-mail.

**Billing events** — o livro-razão de tudo que já foi aplicado. O índice único
`(source, external_event_id)` **é** o mecanismo de idempotência, não um registro
dele.

**Subscription** — a projeção local do estado no provider, uma por conta. É uma
projeção, não a verdade: o provider é a autoridade, e o webhook sobrescreve.

**Cancelar no fim do período** — o padrão. O usuário pagou pelo período; cortar
na hora é para suporte e exclusão de conta.

## Infraestrutura

**Port** (porta) — a interface por onde uma dependência externa entra
(`@vpn/ports`). **Adapter** — uma implementação dela (`libs/adapters`).
**Driver** — o valor de ambiente que escolhe qual adapter é montado
(`CACHE_DRIVER=redis`).

**Conformance suite** — a bateria de testes que define o que a porta promete,
compartilhada por todos os adapters (`@vpn/testing/contracts`).

**Fake** — a implementação in-memory. Não é um stub: é também o driver `memory`
que roda de verdade em desenvolvimento, e por isso nada em `fakes/` pode
importar vitest.

**Devstack** — os sete contêineres em `devstack/`. **Verdaccio** — o registry
npm local por onde `@vpn/*` transita.

**Correlation id** — o identificador que segue uma requisição pelos logs, volta
no header e aparece no corpo de erro. É o que o usuário cita num relato de bug.
