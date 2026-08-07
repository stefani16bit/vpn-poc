# Account, User e isolamento por RLS

**Status:** entregue
**Decisões relacionadas:** DEC-034, DEC-035, DEC-039, DEC-005, DEC-026, DEC-037, DEC-047,
DEC-049, DEC-050, DEC-051, DEC-052, DEC-053

## Problema

O produto é whitelabel: quem compra é uma empresa, que recebe um domínio, uma assinatura e
vários acessos de pessoas. O modelo de hoje tem uma tabela `accounts` que é uma pessoa, e nada
acima dela. Não há onde pendurar a assinatura da empresa, nem o segundo usuário dela, nem a
identidade visual — e não há nada que impeça uma query de devolver a linha de outra empresa,
porque não existe "outra empresa".

Há também um problema menor e imediato que este trabalho resolve de passagem: o cadastro grava a
conta e **depois** enfileira a notificação, em duas transações. Se a segunda falha, existe uma
conta que nunca receberá o e-mail de verificação, e o usuário fica parado no muro do cadastro
sem ter o que fazer. É a mesma forma do dual-write que a DEC-047 removeu da cobrança.

## Escopo

**Entra:** `accounts` como a empresa e `users` como a pessoa; `role` em `users` com um `owner`
por account garantido por restrição; RLS em toda tabela de domínio com um teste negativo por
tabela; as duas espécies de transação do kernel; `acc` e `rol` no access token; registro
criando empresa, owner e intenção de notificação numa transação só; `slug` derivado do e-mail;
login resolvendo a account por slug opcional; a aposentadoria de `IIdentityProvider`.

**Não entra:** convite por e-mail (a página de usuários cria direto, e é item posterior da Fase
2); aplicação de `seats` — DEC-043 registra o mecanismo, e com um tier só não há o que aplicar;
resolução de tenant por host ou subdomínio (DEC-038, Fase 3); `custom_domains` e branding
(DEC-040, Fase 3); trocar de account sem novo login; renomear o slug depois do registro;
entitlements no request, que são o próximo item do roadmap.

## Vocabulário

**Account**, **User**, **Role**, **Account scope**, **Slug**, **E-mail normalizado** — já em
`CONTEXT.md`, e é esta feature que os torna reais no schema.

**Owner**, **Transação da requisição**, **Transação de sistema**, **Slug derivado** — entram em
`CONTEXT.md` junto com esta spec.

## Comportamento

### Registro

```
Dado    um e-mail que não existe em account nenhuma
Quando  a pessoa se registra
Então   nascem uma account e um user com role owner, na mesma transação
E       a intenção auth.verification é escrita na mesma transação
E       a resposta é 202
```

```
Dado    um registro em que a escrita da intenção falha
Quando  a transação é desfeita
Então   não sobra linha em users, nem em accounts, nem em outbox
E       o e-mail continua livre para um novo registro
```

```
Dado    um e-mail já usado como owner de uma account
Quando  a pessoa se registra de novo
Então   a resposta é 202, idêntica no corpo, no status e no tempo
E       nada é criado
```

```
Dado    dois registros cujos e-mails derivam o mesmo slug
Quando  os dois acontecem
Então   o segundo recebe o slug com sufixo -2
E       nenhuma resposta revela que o primeiro existe
```

```
Dado    um e-mail cujo local part deriva um slug reservado (api, www, admin)
Quando  a pessoa se registra
Então   o slug reservado nunca é emitido
E       a account recebe a variante com sufixo
```

### Login

```
Dado    um e-mail que existe em exatamente uma account
Quando  a pessoa entra sem informar slug
Então   a account é resolvida e a sessão é emitida
E       o access token carrega acc e rol
```

```
Dado    um e-mail que existe em duas accounts
Quando  a pessoa entra sem informar slug
Então   a resposta é INVALID_CREDENTIALS
E       é idêntica — corpo, status e tempo — à de uma senha errada
```

```
Dado    um e-mail que existe na account acme e um slug de outra account
Quando  a pessoa entra informando esse slug
Então   a resposta é INVALID_CREDENTIALS
E       nada revela que o e-mail existe em acme
```

### Isolamento

```
Dado    duas accounts com linhas em uma tabela de domínio
Quando  a aplicação consulta com app.account_id fixado na primeira
Então   a linha da primeira aparece
E       nenhuma linha da segunda aparece
E       isso vale para cada tabela de domínio, uma por uma
```

As duas asserções são obrigatórias, e a positiva é a que quase falta. Uma asserção só negativa
("A não vê a linha de B") passa contra uma tabela com RLS ligada e **policy nenhuma** — o falso
verde mais sedutor deste desenho. É o par que prova "quebra se a policy sumir".

```
Dado    uma tabela de domínio e uma transação de sistema
Quando  a mesma consulta roda como app_system
Então   as linhas das duas accounts aparecem
```

Sem este terceiro caso, uma policy `TO app_system` esquecida fica invisível até o registro
quebrar com uma mensagem que não aponta para lugar nenhum — `app_system` não tem `BYPASSRLS`.

```
Dado    um access token válido cujo acc é de outra account
Quando  ele é apresentado a uma rota autenticada
Então   a transação é aberta para o acc do token
E       as leituras não alcançam a account do sub — não há dado a vazar
```

```
Dado    uma query fora de qualquer transação do kernel
Quando  ela roda
Então   ela falha com 42704 em vez de devolver zero linhas em silêncio
```

```
Dado    o relay do outbox, que legitimamente cruza accounts
Quando  ele drena linhas pendentes
Então   ele as vê todas, porque roda como app_system
```

## Portas afetadas

Nenhuma dependência externa nova. Esta feature **remove** uma porta:

- [x] `IIdentityProvider` sai de `@vpn/ports` — DEC-049
- [x] A suíte de conformidade de identidade sai de `@vpn/testing/contracts` e é **convertida**
      em teste de integração dos repositórios
- [x] `MemoryIdentityProvider` sai de `@vpn/testing/fakes` — não era driver de nada
- [x] `DrizzleIdentityProvider` sai de `libs/adapters`, com o `defineAdapter` correspondente

## Banco

`accounts` (nova) — `id`, `slug` (único), `name`, `created_at`. Escreve: o registro. Lê: login
por slug e todo `SELECT` de domínio, pela policy. Apaga: ninguém ainda — exclusão de conta é
posterior, e está no roadmap.

`users` (era `accounts`) — ganha `account_id` e `role`. O único de e-mail vira
`(account_id, email)`, e um índice único parcial em `(account_id) where role = 'owner'` faz "um
owner por account" ser restrição, não convenção. Um segundo índice parcial, em
`(email) where role = 'owner'`, faz o inverso: um endereço funda no máximo uma account. Sem
ele, um duplo clique no cadastro criaria duas empresas e deixaria a pessoa sem conseguir
entrar, porque a DEC-051 colapsa "e-mail em duas accounts sem slug" em `INVALID_CREDENTIALS`.

`session_families` — `account_id` vira `user_id` (mesmo alvo, nome certo) e ganha um
`account_id` novo, que aponta para a empresa. `refresh_tokens` e `verification_tokens` ganham
`account_id` pelo mesmo motivo; `verification_tokens.account_id` de hoje vira `user_id`.

A denormalização é deliberada: uma policy que precisa de subquery por linha é lenta, e o
`EXISTS` interno estaria ele próprio sujeito à policy da tabela consultada — o predicado
passaria a depender da ordem de avaliação das policies, que não é coisa em que apoiar
isolamento.

O que impede a denormalização de derivar é uma **FK composta**, não disciplina: único em
`users (id, account_id)`, e então
`session_families (user_id, account_id) REFERENCES users (id, account_id)`; único em
`session_families (id, account_id)`, e então
`refresh_tokens (family_id, account_id) REFERENCES session_families (id, account_id)`; o mesmo
para `verification_tokens (user_id, account_id)`. Uma linha cuja account discorda da do seu
user passa a ser rejeitada pelo banco. É o mesmo movimento do inegociável nº 3: o mecanismo é
uma restrição, nunca um `if`.

`billing_events.account_id` é **anulável**, com `ON DELETE SET NULL`, e a policy de tenant é
`FOR SELECT` apenas. Anulável porque o único `(source, external_event_id)` **é** o mecanismo de
idempotência e não pode ser bloqueado por um evento cuja account não se resolve; `SET NULL`
porque apagar uma account não pode apagar o registro do que já foi aplicado; e só `SELECT`
porque o livro-razão é escrito exclusivamente pelo caminho de sistema — a ausência de policy de
`INSERT` para `vpn_app` é uma afirmação mais forte que um `WITH CHECK`.

`subscriptions.account_id` **mantém o nome e muda de significado** — passa a apontar para a
empresa. `billing_events` e `outbox` ganham `account_id`, para caírem sob RLS como qualquer
tabela de domínio.

Migração: `0000_init` é **regenerada**, dobrando `0000`–`0002` numa só. Não há dado e não houve
deploy; quem tem banco local roda `make reset`. `drizzle-kit` não infere estes renames — ele
emite drop e create, e isso está certo aqui.

## Idempotência

O registro pode chegar duas vezes — duas abas, um duplo clique, um retry de rede. O que faz a
segunda ser inofensiva é o índice único `(account_id, email)` perdendo a corrida, dentro da
transação: não há `SELECT` antes do `INSERT`, então dois processos concorrentes não passam
juntos por checagem nenhuma. A resposta é a mesma nos dois casos, que é o que o inegociável nº 4
exige.

A colisão de slug segue a mesma forma com um detalhe que não é opcional: a inserção é
`on conflict (slug) do nothing returning id`, e conjunto vazio significa "tomado". Deixar o
`INSERT` levantar e capturar o erro **aborta a transação inteira** no PostgreSQL — a segunda
tentativa receberia `25P02` e derrubaria o cadastro, não só o slug. Um `SELECT count(*)`
seguido de `INSERT` seria o `if (jáVimos)` que o inegociável nº 3 proíbe; um `INSERT` que
levanta seria o cadastro perdido. A forma certa é a que `BillingEventRepository.claim()` já
usa.

A verificação de e-mail continua idempotente pelo `UPDATE` condicional que já existia —
verificar duas vezes não move o timestamp.

## Segurança

- **Vaza a existência de uma conta?** Não. `register` responde 202 idêntico para e-mail livre e
  ocupado. `login` responde `INVALID_CREDENTIALS` idêntico para senha errada, e-mail
  inexistente, e-mail existente em outra account e e-mail ambíguo entre duas accounts — no
  corpo, no status e no tempo, porque o hash roda contra `ABSENT_ACCOUNT_HASH` mesmo quando não
  há usuário. A ambiguidade entre accounts é o caso novo, e é o que a DEC-051 resolve
  colapsando-o no mesmo erro.

  O detalhe de implementação que faz isso valer: **exatamente uma verificação de scrypt em todo
  ramo**. Quando o desfecho já está decidido — zero correspondências, mais de uma, ou slug
  desconhecido — verifica-se contra `ABSENT_USER_HASH` e descarta-se o resultado. Verificar N
  vezes quando há N correspondências seria N× mais lento e diria em voz alta "este endereço está
  em duas empresas". O custo do scrypt vem dos parâmetros, não do conteúdo, então os tempos
  coincidem.

  Slug desconhecido responde `INVALID_CREDENTIALS`, nunca `NOT_FOUND`: uma resposta distinguível
  por slug é oráculo de enumeração de **empresas**, que é o inegociável nº 4 com outro sujeito.

  A colisão de slug não produz erro visível: o sufixo é escolhido pelo servidor, e o registro
  responde `{ acknowledged: true }`. Vale registrar o limite disso — se algum endpoint passar a
  devolver o slug, `ada` contra `ada-2` volta a dizer se `ada` estava tomado.

- **Que token é gerado?** Nenhum novo. O access token cresce com `acc` e `rol` (DEC-037);
  entitlements continuam fora, porque um `payment_failed` precisa valer agora e o JWT vive 15
  minutos sem ser revogável. Os tokens de uso único não mudam: 32 bytes, guardados só como
  SHA-256, emitidos pelo worker no envio (DEC-048).
- **Que sessões precisam morrer?** Nenhuma por causa desta mudança em si. Mas o `rol` dentro do
  token significa que uma troca de papel só vale na próxima rotação de família — e é por isso
  que ele pode morar no token: a rotação **é** o mecanismo de propagação. Uma mudança de papel
  que precise valer na hora revoga a família, como já fazem a troca de senha e o logout.

## Como validar

```bash
make reset                                           # NÃO db:migrate — ver abaixo
make check                                           # 12/12
pnpm verify
pnpm --filter @vpn-poc/adapters test:integration
pnpm --filter @vpn-poc/api test:e2e
cd packages && MSYS_NO_PATHCONV=1 pnpm consumer-check
```

`make reset`, não `pnpm db:migrate`, e esta é a linha mais fácil de esquecer: `0000_init` foi
**reescrita**, e o ledger do Drizzle guarda o hash da versão anterior. Contra um banco de
desenvolvimento que já migrou, `db:migrate` não aplica a nova init — ele não reconhece o que
mudou. `make reset` derruba o volume, sobe de novo e migra do zero. O Verdaccio é bind mount e
sobrevive, então os `@vpn/*` publicados não se perdem.

Três provas que nenhum comando faz sozinho, e que são o ponto desta spec:

1. **Cada policy carrega peso.** Para cada tabela de domínio, como `vpn_migrator`:
   `begin; drop policy <nome> on <tabela>;`, rodar a suíte de integração, confirmar que **o
   caso daquela tabela** fica vermelho, `rollback`. Duas policies por tabela, então são duas
   sondas por tabela. Uma policy nunca exercitada contra o papel certo lê como correta e não
   faz nada — é o que a DEC-035 chama de teatro, e é por isso que `vpn_app` não tem `BYPASSRLS`
   desde a DEC-005.

   A suíte precisa também afirmar, como primeiro caso do arquivo, que `current_user` é
   `vpn_app`. `vpn_migrator` é dono de toda tabela e donos ignoram policy — uma suíte conectada
   com a string errada prova exatamente nada, e está a um caractere de distância.

   Um caso automatizado complementa, sem substituir: `pg_policies` contém exatamente o conjunto
   esperado de `(tablename, policyname)`. Isso pega uma policy renomeada ou removida mesmo que
   alguma outra asserção continue passando por acidente.

2. **A transação do registro carrega peso.** Tirar o `TransactionRunner` do `register`, rodar o
   caso de e2e "não sobra nada quando a transação do registro falha" e vê-lo ficar **vermelho**
   antes de aceitá-lo como verde.
3. **A limpeza dos testes ainda apaga.** `DELETE FROM users` como `vpn_app` sob RLS apaga zero
   linhas **sem erro**, e toda asserção depois disso fica estranha por um motivo que não aparece
   em lugar nenhum. A limpeza roda como `app_system`, e o jeito de confirmar é contar as linhas
   depois de limpar.

No navegador, com `pnpm dev`: cadastrar dois e-mails com o mesmo local part em domínios
diferentes (`ada@exemplo-a.com` e `ada@exemplo-b.com`), conferir no banco que as accounts
nasceram com `ada` e `ada-2`, entrar com os dois e conferir que cada sessão só enxerga a própria
empresa.
