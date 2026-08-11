# Glossário do domínio

Termo novo entra aqui **antes** de virar tabela, campo ou tipo. O objetivo é que
o código e a conversa usem a mesma palavra para a mesma coisa — e palavras
diferentes para coisas diferentes.

---

## Identidade

**Account** — a **empresa** que assina. Uma linha em `accounts`, identificada por
um `slug`. É a unidade de cobrança, de isolamento e de identidade visual: uma
assinatura, um domínio, um conjunto de features.

Até a DEC-034, `Account` era a pessoa que se cadastrava — e a definição de então
já previa este momento: _"a distinção importa quando aparecer acesso delegado"_.
Apareceu. A pessoa virou **User**, e o nome ficou com quem compra.

**User** — a **pessoa** que usa o sistema, sob exatamente uma account. Uma linha
em `users` (a tabela que já foi `accounts`), com `account_id` e `role`.

**E-mail normalizado** — minúsculo e sem espaços nas pontas. A normalização
acontece no schema em `@vpn/contracts`, num lugar só, e o índice único é o que a
torna obrigatória em vez de decorativa. Esse índice é `(account_id, email)`, não
`email`: a mesma pessoa pode ser usuária de duas empresas, e a identidade dela
só é única dentro de uma. É também o que obriga o login a saber de qual account
está falando **antes** de procurar o e-mail.

**Role** — o que esta pessoa pode fazer dentro da account: `owner`, `admin` ou
`member`. Uma coluna em `users`, não uma tabela: um usuário pertence a uma
account só, então `memberships` teria exatamente uma linha por usuário. É a
segunda dimensão de autorização, e compõe com a primeira — ver **Entitlement**.

**Owner** — o user que criou a account. É a role de quem se registrou, e é
**uma por account**: um índice único parcial em `(account_id) where role =
'owner'` faz disso uma restrição, não uma convenção — a diferença é que uma
convenção sobrevive a dois `INSERT` concorrentes e uma restrição não. DEC-039.

O inverso também é restrição: um índice único parcial em `(email) where role =
'owner'` faz um endereço ser owner de **no máximo uma** account. É o que impede
um duplo clique no cadastro de criar duas empresas — e, pior, de deixar a pessoa
sem conseguir entrar, já que a DEC-051 responde `INVALID_CREDENTIALS` quando um
e-mail existe em mais de uma account e nenhum slug foi informado. A mesma pessoa
continua podendo ser `admin` ou `member` de quantas accounts quiser; o que ela
não pode é **fundar** duas.

**Verificado** — a conta provou controlar o endereço. É um _timestamp_
(`email_verified_at`), não um booleano: "quando" responde perguntas de suporte
que "se" não responde. Verificar de novo não move o timestamp.

**Senha temporária** — a senha que o **servidor** gera quando um admin cria um
user, mostrada **uma vez** e nunca mais. Não é uma espécie diferente de senha:
mesmo scrypt, mesma coluna, mesmo login. O que muda é a custódia — ninguém a
escolheu, então ela não é a senha que a pessoa já usa em outro lugar, e ela não
existe em lugar nenhum além da tela que a exibiu. Quem a perdeu não a recupera:
o caminho de volta é "esqueci minha senha", o mesmo de todo mundo. DEC-076.

## Tenancy

**Account scope** — toda linha de domínio pende de uma account. O mecanismo é
**RLS**: uma policy no banco, contra `current_setting('app.account_id')`, que a
transação da requisição fixa com `SET LOCAL`. Não é um `WHERE account_id = ?` na
aplicação — esse é o tipo de coisa que funciona em 99 queries e vaza na
centésima, e a query que vaza não falha, ela devolve dados de outra empresa.
DEC-035. O que torna isso verificável é a DEC-005: `vpn_app` não tem
`BYPASSRLS`, então a policy vincula de verdade em vez de ler como correta.

**Transação da requisição** — a transação que o kernel abre por requisição
autenticada, fixando `app.account_id` com `set_config(…, true)`. É onde a policy
encontra o valor contra o qual decidir. Nenhuma query de domínio roda fora de
uma: fora dela não há setting, e sem setting a policy devolve zero linhas **sem
erro** — por isso o kernel lança em vez de cair para o pool.

**Transação de sistema** — a outra espécie, que assume `app_system` com
`set local role` e enxerga todas as accounts. Atende o que legitimamente não tem
tenant: o resto do caminho pré-autenticação (que é o código que descobre quem
você é), o relay do outbox e o webhook de cobrança. `app_system` não tem
`BYPASSRLS`, então esse acesso é uma policy escrita, não um atributo de papel.
DEC-050.

**Transação de descoberta** — a terceira espécie, e a que existe justamente para
o caso em que "não tem tenant" dura **uma consulta**. Começa como sistema, faz a
busca que descobre a account, e nesse instante abandona o papel (`reset role`) e
fixa `app.account_id` — sem fechar a transação. É o `refresh`: ele apresenta um
token opaco e nada mais, então a account só pode sair do próprio token; mas
gastar o token, emitir o novo e ler o user já sabem a account, e não há motivo
para nenhum deles rodar sem policy.

A transação é uma só porque a **rotação** não pode partir ao meio: entre gastar o
antigo e emitir o novo não pode existir uma janela em que um crash destrói a
sessão. E o estreitamento é estrutural, não disciplinar — o trabalho só é
alcançável depois da troca de papel, então "esqueci de estreitar" não é um
caminho que exista.

**Slug** — o identificador legível da account (`acme`). É o que vira subdomínio
e o que o app nativo pede no primeiro login, porque um cliente nativo não tem
`Host` para entregar de graça.

**Slug derivado** — como o slug nasce: o local part do e-mail de quem se
registra, slugificado. A colisão é resolvida pelo `INSERT` perdendo para a
restrição e tentando de novo com `-2`, `-3` — nunca por um `SELECT` antes, que
dois registros simultâneos atravessariam juntos. DEC-052.

**Custom domain** — o host próprio de uma account. `{slug}.vpn.example.com` sai
de um cert wildcard e existe para toda account; um domínio do cliente é uma
linha em `custom_domains` e depende de emissão de certificado, que é fase
posterior. Em ambos os casos o host **resolve a account**, e é isso que a torna
conhecida antes da autenticação.

**Branding** — a identidade visual da account: um logo e um conjunto **fechado**
de **tokens de tema**. Fechado é a decisão: CSS arbitrário de cliente executa na
nossa origem. DEC-040.

## Sessão

**Session family** — o conjunto de refresh tokens que descendem de um mesmo
login. Uma linha em `session_families`. É a unidade de revogação: logout,
troca de senha e detecção de roubo matam a família, não um token.

**Rotação** — cada uso de um refresh token emite um novo e marca o antigo como
_gasto_. Um token gasto nunca volta a valer.

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

**Subscription** — a projeção local do estado no provider, uma por account. É uma
projeção, não a verdade: o provider é a autoridade, e o webhook sobrescreve.

**Tier** — o nível do produto. É ele que determina os entitlements. Hoje existe
**um**, `pro`, e é o único comprável. `TIER_IDS` mora em `@vpn/contracts`.

**Cadence** — mensal ou anual. É só o intervalo de cobrança e não muda o que a
account pode fazer. `PLAN_IDS = ['monthly','yearly']` era **só a cadência**, sem
que nada no nome dissesse isso; um plano é o par **tier × cadence**, e o preço
pende do par enquanto os entitlements pendem só do tier. Hoje os dois nomes
existem separados (`TIER_IDS`, `CADENCES`), e o checkout pede o par.

**Account sem tier** — a que não tem subscription em estado que dê acesso.
`active` e `trialing` dão; `past_due`, `canceled`, `incomplete` e a ausência de
linha não dão. Não é um tier chamado "free": é a **ausência** de tier, o mapa não
a cobre, e o conjunto dela é explícito (`UNSUBSCRIBED_ENTITLEMENTS`). A diferença
importa porque um tier é comprável e isto não é.

**Cancelar no fim do período** — o padrão. O usuário pagou pelo período; cortar
na hora é para suporte e exclusão de conta.

**Retomar** — desfazer um cancelamento agendado antes de o período fechar. É a
mesma subscription voltando a renovar, então não passa por checkout e não cria
cobrança. Só existe enquanto o cancelamento está **agendado**: depois que o
período fecha e o status vira `canceled`, o caminho de volta é assinar de novo.

## Autorização

**Entitlement** — o que a assinatura da account permite. Deriva do tier por um
mapa versionado em código, em `@vpn/contracts`, compartilhado com todo cliente
(DEC-036).

Autorização tem **duas dimensões e elas compõem**: o entitlement diz o que a
_empresa_ contratou, a **role** diz o que _esta pessoa_ pode fazer. O efetivo é a
interseção. Um `owner` num tier sem a feature não a tem; um `member` numa account
que a tem pode continuar não podendo usá-la.

A role se aplica de duas formas, e a distinção é a decisão. Em `/devices` ela é
**escopo**: toda operação é sobre o que a pessoa possui, e `admin` ou `owner`
alargam para a account inteira. Um guard que responde sim/não antes do handler
não sabe expressar "os dois podem, com alcances diferentes", e é por isso que
`/devices` não é barrada por role. DEC-070.

Em `/users` e em cobrança ela é **portão**: `@RequiresRole` recusa com 403 antes do
handler, porque ali não há escopo menor que faça sentido — administrar quem tem
acesso é administrar a account inteira ou nada, e uma assinatura é uma só.
Retroaplicar o portão a `/devices` destruiria a distinção acima.

São **dois portões, com degraus diferentes**, e a diferença é o assunto e não o
rank: `/users` pede `admin`, cobrança pede `owner`. Admin gere pessoas, owner gere
dinheiro — um `admin` que pode desligar gente não desliga o produto, e é esse 403
para o admin que dá conteúdo à decisão. `GET /billing/subscription` fica de fora
dos dois: ela alimenta a home da conta, e quem não é owner perde os botões, não a
página. DEC-079.

Nenhuma rota mutante sob `modules/` pode nascer sem essa pergunta:
`authorization.guard.spec.ts` lê a fonte dos controllers e cobra um decorator de
portão — ou uma exceção escrita, com o motivo ao lado. Cobrança ficou desprotegida
porque a checagem era memória de quem revisa.

**Capability** — o entitlement que é um liga/desliga. Verificado no request, por
um guard do kernel, que responde **402** quando falta: o problema não é quem você
é, é o que a empresa contratou. Hoje existe **uma**, `vpn_access` — o que assinar
desbloqueia. `sso`, `audit_log` e `split_tunneling` são ilustrações da forma, não
capabilities deste produto.

**Seat** — o entitlement que é um contador: quantos users cabem na account.
`devicesPerUser` é da mesma natureza. Contadores são aplicados na **escrita** e
por **restrição de banco** — um `count()` seguido de `INSERT` é o `if (jáVimos)`
que o inegociável nº 3 proíbe, e dois convites aceitos ao mesmo tempo passam
pelo `SELECT` juntos. DEC-043.

Ler um entitlement é uniforme; **aplicar não é**. São quatro momentos diferentes
— request, escrita, provisionamento de peer e medição contínua — e um decorator
só resolve o primeiro. Ver `docs/specs/entitlements-and-plans.md`.

**Entitlements não estão no access token.** O JWT vive 15 minutos e não é
revogável, mas um `payment_failed` muda o que a account pode fazer _agora_. São
lidos por requisição a partir da subscription, com cache, e o webhook invalida.
`accountId` e `role` **estão** no token: mudam por ação nossa, e a rotação de
família já é o mecanismo de propagação. DEC-037.

O que o cache guarda é o **tier**, não os entitlements: o mapa é código, então
publicar um mapa novo vale na hora em vez de esperar o TTL de cada account. A
entrada é `{ owner: accountId, namespace: 'entitlements' }` — a primeira do
sistema cujo `owner` é de verdade uma account — e o webhook a apaga **depois** do
commit. DEC-054, DEC-055.

## Rede

**Device** — uma instalação do app nativo, com sua chave. A chave privada nasce e
morre no dispositivo; o servidor só vê a pública. É por device que o túnel
existe, não por user — daí `devicesPerUser` ser um entitlement.

**Peer** — a entrada de um device na configuração de um exit node. É o que o
provisionamento cria, e é onde o entitlement de região é aplicado: no servidor,
nunca só na UI, porque o cliente que pede o peer é código do usuário.

**Exit node** — a máquina por onde o tráfego sai, e uma linha **do tenant**: quem
registra os nós é a account, sob RLS como qualquer outra tabela de domínio. O que
o registro guarda é o que o nó **responde** quando perguntado, nunca o que o
formulário afirmou — a chave pública é a que o `describe()` reportou, que é a
custódia desenhada pela DEC-063. DEC-077.

**Region** — o agrupamento de exit nodes que o **tenant** nomeia, e por onde o
usuário final escolhe. `us` e `eu` eram um enum fechado do produto, e um enum
fechado não sobrevive a uma empresa brasileira que quer "São Paulo": num produto
whitelabel quem nomeia é o cliente. O que o tier entitula deixa então de ser
_quais_ regiões e passa a ser **quantas** — um contador, da mesma natureza de
`seats`, aplicado na escrita e por restrição. DEC-078.

Um cliente escolhe região; **qual nó atende é nosso**. Por isso um device carrega
duas coisas diferentes, e este glossário existe para não deixar que virem a
mesma: a **região**, que é a escolha da pessoa, e o **exit node**, que é a nossa
atribuição.

**Device** e **Peer** existem: `devices` é tabela, sob RLS como qualquer outra, e
a chave pública é o identificador nas duas pontas — a linha e o peer no nó. O que
liga uma à outra é o **outbox**, não uma chamada: a linha é o registro e o nó é
uma projeção dela, reconciliada pelo worker. DEC-064.

**Exit node** e **Region** ainda **não são tabelas**. Existe um nó, ele vem de
variável de ambiente e é um contêiner do devstack — um nó não é uma frota. O
vocabulário acima chegou **antes** do schema de propósito, que é a regra deste
arquivo; a tabela vem com a página de servidores. Até lá, `regions` segue
anunciado no tier e aplicado em lugar nenhum.

**Recurso privado** — o que existe do outro lado do túnel e em lugar nenhum
mais. É o destino que dá sentido ao túnel: a rede interna de um cliente, um banco
sem endereço público, um painel que só a VPN alcança. O produto **não tem
nenhum** — quem os possui é o cliente, e o que vendemos é o caminho até eles.

O devstack tem um, o **canário**: uma página e um `GET /api/hello` numa sub-rede
sem porta publicada. É instrumento, na categoria do `tunnel:doctor` e das chaves
de `wireguard/peers/`, não artefato de produto. Ele existe porque "o túnel
carrega tráfego" precisava de resposta em dez segundos, e até aqui só tinha
resposta lida em saída de `wg show`. Com o túnel fora do ar não há **rota** até
ele — e é a ausência de rota, não uma regra que alguém possa configurar errado,
que faz a prova valer. DEC-075.

**Endereço no túnel** — o IP que um device ocupa dentro da faixa do nó. É
reivindicado por restrição única na escrita, nunca contado antes: dois devices
criados no mesmo instante atravessariam um `count()` juntos e pediriam o mesmo
endereço. Um device revogado o devolve, porque o índice único é parcial. A faixa
é **global**, não por account — uma view escolhe por onde começar a busca, e o
índice continua sendo quem decide (DEC-069).

**Revogado** — o device deixou de valer. É um _timestamp_, não uma remoção: a
chave pública continua sendo o identificador do que já existiu, e é ela que o
worker manda o nó esquecer. Um `.conf` perdido não se rebaixa — gera-se outro, e
o anterior é revogado (DEC-045). Revogar não derruba o túnel do outro lado: o
cliente continua marcando a interface como ativa e descartando tudo até alguém
apagá-la, e a interface diz isso.

Uma linha viva **não pode ser apagada** — o banco recusa, cascade incluído,
porque um `DELETE` que leva a linha junto com a intenção de revogar deixa o peer
no nó para sempre. Quem apaga revoga antes. DEC-071.

**Reconciliação** — a varredura que compara os peers do nó com as linhas vivas e
converge os dois sentidos: tira o que nenhuma account reivindica, repõe o que um
nó reconstruído esqueceu. Ela governa só a faixa que o alocador distribui, então
um peer semeado à mão não é dela para revogar. É o que conserta o que o outbox
não teve como entregar.

A linha tem **duas** projeções, e a varredura converge as duas: a lista de peers
do nó e o `provisioned_at`. Um device cujo job morreu na DLQ ganha o peer de volta
_e_ o carimbo, senão o túnel volta a funcionar e a tela segue dizendo que está
liberando o acesso. Pendente só é tratado como falho passado um prazo — antes
dele, o job ainda está a caminho e a varredura não disputa com ele. DEC-074.

## Trabalho assíncrono

**Outbox** — a tabela onde uma notificação é escrita **dentro da transação que a
causou**. É o que faz a notificação ser tão durável quanto a mudança de estado:
publicar depois do commit perde a mensagem se o publish falhar, e essa é a mesma
forma do bug de dual-write que o webhook de cobrança tinha. DEC-047.

**Intenção** — o que o outbox guarda: a quem se destina e o nome do que enviar,
nunca a mensagem pronta. "A quem" é `userId` nas intenções de auth e `accountId`
nas de cobrança — uma fala com uma pessoa, a outra com a empresa, e usar o mesmo
nome para as duas seria a confusão que este glossário existe para evitar. É
separado da coluna `account_id` da tabela, que existe para a RLS e é sempre a
empresa. Um e-mail de verificação renderizado carregaria o token
**em claro**, e o banco só guarda hash de token. Por isso quem emite o token é o
worker, no envio. DEC-048.

**Job** — uma unidade de trabalho na fila: `{ name, data, idempotencyKey? }`. O
`name` é o `kind` da intenção. A fila não interpreta o `data` e **não** promete
ordem nem deduplicação — SQS padrão não faz nenhuma das duas. DEC-046.

O `data` é um **envelope**: a intenção mais o `account_id` da linha do outbox, um
ao lado do outro e nunca fundidos — são coisas diferentes, e este glossário
existe para não deixar que virem a mesma. O envelope é o que permite ao consumer
abrir uma transação da requisição por mensagem em vez de despachar como sistema:
sem ele, um `userId` resolveria para um user de qualquer account. Job sem account
não é despachado — volta para a fila e termina na DLQ, como qualquer job que o
consumer não entende.

**Relay** — quem drena o outbox para a fila, com `for update skip locked`, e
marca `published_at`. Publica **antes** de marcar: morrer no meio reentrega, e
reentregar é seguro.

**Consumer** — quem recebe da fila, despacha e só então reconhece. Reconhecer
antes de enviar perderia o e-mail num crash. Um job desconhecido não é
reconhecido: volta para a fila e termina na DLQ, em vez de sumir.

**At-least-once** — a garantia dos dois saltos. É segura porque o
`SmtpEmailSender` já reivindica uma chave de idempotência no cache antes de
enviar: repetir é inofensivo, perder não seria.

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

**Devstack** — os oito contêineres em `devstack/`. **Verdaccio** — o registry
npm local por onde `@vpn/*` transita.

**Correlation id** — o identificador que segue uma requisição pelos logs, volta
no header e aparece no corpo de erro. É o que o usuário cita num relato de bug.

**Kernel compartilhado** — `apps/api/src/shared/`: a camada da qual todo módulo
pode depender e que não pode depender de módulo nenhum. A segunda metade da
frase é a que tem conteúdo, e é verificada por lint.

**Repository** — o nosso código de query em cima do token `DATABASE`. Não é uma
porta: o banco já está atrás de uma fronteira, e um repositório mora em cima
dela, não no lugar dela. Por isso não tem interface nem suíte de conformidade —
e por isso também não tem teste unitário. Ver DEC-026.

## Interface

**Primitivo** — o componente copiado do registry para `components/ui/`. Não
conhece o domínio, não traduz, não sabe o que é um erro da API.

**Composto** — o componente nosso, em `components/form/` e `components/layout/`.
Conhece `t()`, `NormalizedError` e o formato de um campo. A distinção decide
onde uma string pode aparecer e o que entra na cobertura.

**Token de tema** — a variável CSS que nomeia um papel (`--background`,
`--destructive`), nunca uma cor. É o que permite duas paletas com um markup só.
