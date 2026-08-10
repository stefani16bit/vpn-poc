# Gerenciamento de usuários

**Status:** rascunho
**Decisões relacionadas:** DEC-034, DEC-035, DEC-037, DEC-039, DEC-043, DEC-051,
DEC-069, DEC-070, DEC-076

## Problema

Não há como criar um segundo usuário. Uma account tem exatamente a pessoa que se
cadastrou, e `role` existe na tabela, em `hasAtLeastRole` e dentro do access
token — mas nenhuma superfície do produto a produz.

O sintoma mais claro está nos testes: cinco casos de e2e provam a DEC-070
fabricando um colega com **SQL cru** (`colleagueOf`, com `password_hash = 'x'`),
porque não existe endpoint que faça isso. Uma regra provada só por um atalho que
o produto não tem é uma regra sem chamador.

É também o último item não marcado da Fase 2, e escopo obrigatório do brief.

## Escopo

**Entra:** listar, criar, mudar a role e apagar usuários dentro da account; o
guard `@RequiresRole`; a página de administração; e a substituição de
`colleagueOf` pelo endpoint de verdade nos cinco e2e.

**Não entra:**

- **Convite por e-mail.** DEC-076: o admin cria e entrega a senha. Um convite
  precisa de token, de tela pública e de expiração, e nada disso é o que falta
  para o brief.
- **Aplicação de `seats`.** Com um tier só não há o que aplicar, e meio-aplicado
  parece aplicado. DEC-043 registra o mecanismo para quando houver dois tiers.
- **Transferência de propriedade.** `owner` é um por account, por índice único
  parcial (DEC-039). Mover isso não é mudar uma role, é outro recurso.
- **Troca obrigatória de senha no primeiro login.** DEC-076 diz por quê.
- **Auditoria.** Quem criou quem e quando não é gravado. `audit_log` é ilustração
  da forma de capability, não capability deste produto.

## Vocabulário

**Senha temporária**, já em `CONTEXT.md` §Identidade. **Role**, **Owner** e
**Seat** já estavam.

O que muda em `CONTEXT.md` quando isto entregar é a frase de §Autorização que
hoje diz _"Não existe `@RequiresRole`"_ — ela passa a existir, **nesta rota e em
nenhuma outra**.

## Comportamento

### O portão

```
Dado    um member autenticado
Quando  ele pede GET /users
Então   a resposta é 403 com código FORBIDDEN
```

```
Dado    um admin ou um owner
Quando  ele pede GET /users
Então   a resposta é 200 com os usuários da account
```

Este par **é** o item do lado do servidor: é o primeiro chamador de
`@RequiresRole` em produção. Apagar o decorator tem que fazer os 403 virarem 200,
que é a mesma sonda com que a DEC-070 conferiu `@RequiresCapability`.

E é por isso que ele **não** é retroaplicado em `/devices`. Lá as duas roles
podem, com alcances diferentes, e um guard que responde sim/não antes do handler
não sabe dizer isso — destruir essa distinção é destruir a decisão que a
registrou.

### Listar

```
Dado    uma account com owner, admin e member
Quando  o admin lista
Então   os três aparecem, cada um com a role
E       o owner aparece marcado como owner
```

O owner aparece. Esconder da lista alguém que existe é fazer a tela mentir sobre
quem tem acesso — e o admin já podia inferir a existência dele de qualquer forma.
O que muda no owner não é a visibilidade, é o que se pode fazer com ele.

```
Dado    um admin da account A
Quando  ele lista
Então   nenhum usuário de outra account aparece
```

Não é um `WHERE`: é a policy. O teste negativo por tabela da DEC-035 é o que faz
essa linha ser verificada em vez de assumida.

### Criar

```
Dado    um admin
Quando  ele cria um usuário com e-mail e role
Então   a resposta é 201
E       o corpo traz a senha temporária, uma única vez
E       a linha nasce com email_verified_at preenchido
```

```
Dado    o usuário recém-criado
Quando  ele entra com a senha temporária
Então   o login funciona, sem passar por verificação de e-mail
```

Este é o cenário que prova a DEC-076 inteira. Sem ele, "nasce verificado" é uma
coluna preenchida sem consequência observável — e com `email_verified_at` nulo o
login responderia `EMAIL_NOT_VERIFIED` para sempre.

```
Dado    um e-mail já usado nesta account
Quando  o admin tenta criar de novo
Então   a resposta é 409 com código CONFLICT
E       nenhuma linha é criada
```

O mecanismo é o índice único `(account_id, email)`, alcançado pela escrita — não
um `SELECT` antes, que dois cliques simultâneos atravessariam juntos.

```
Dado    um e-mail que é owner de outra account
Quando  o admin o cria como member aqui
Então   a resposta é 201
```

A mesma pessoa pode ser usuária de várias empresas; o que ela não pode é
**fundar** duas. O índice parcial `(email) where role = 'owner'` só é alcançado
criando um owner, e este caminho nunca cria um.

```
Dado    um pedido pedindo role owner
Quando  ele chega
Então   é recusado na validação
```

`owner` não está no schema da requisição. Recusar na borda é mais barato que
recusar no serviço, e o índice parcial continua sendo a rede embaixo.

### Mudar a role

```
Dado    um admin e outro usuário da account
Quando  ele muda a role do outro
Então   a resposta é 200 e a role muda
E       as sessões daquele usuário são revogadas
```

A revogação é a parte com conteúdo. `role` viaja **dentro** do access token
(DEC-037), que vive 15 minutos e não é revogável — sem matar a família, alguém
rebaixado continua sendo admin por até um quarto de hora. O mecanismo já existe e
já é usado por logout e troca de senha: mata-se a família, não um token.

```
Dado    um admin
Quando  ele tenta mudar a própria role
Então   a resposta é 403
```

Um admin que se rebaixa perde a página no meio da própria ação, e uma account
pode chegar a zero admins sem que ninguém tenha pedido isso.

```
Dado    o owner
Quando  alguém tenta mudar a role dele
Então   a resposta é 403
```

### Apagar

```
Dado    um usuário sem device vivo
Quando  o admin o apaga
Então   a resposta é 204
E       as sessões dele morrem junto
```

```
Dado    um usuário com device vivo
Quando  o admin o apaga
Então   o banco recusa e a resposta é 409
```

Isto **já** é recusado por `0003_device_delete_guard.sql`, e é por isso que
"revogue os devices antes" é restrição e não convenção. Esta rota expõe a regra;
ela não a reimplementa, e não há caminho pelo qual a aplicação possa discordar do
banco.

```
Dado    um admin
Quando  ele tenta apagar a si mesmo
Então   a resposta é 403
```

```
Dado    o owner
Quando  alguém tenta apagá-lo
Então   a resposta é 403
```

### Escopo de tenant

```
Dado    um admin da account A e um usuário da account B
Quando  ele pede qualquer operação sobre aquele usuário
Então   a resposta é 404
```

**404 e não 403.** Sob RLS a linha não é visível, então "não encontrado" é
literalmente verdade — e responder 403 diria que ela existe, que é exatamente o
que o isolamento existe para não dizer.

## Portas afetadas

**Nenhuma.** Nenhuma dependência externa nova. `IPasswordHasher` já existe e a
senha gerada passa por ele como qualquer outra.

## Banco

**Nenhuma migração.** `libs/database/src/schema.ts` já carrega `userRole`,
`scopedPolicies('users')` e os quatro índices únicos.

Uma correção, e não é cosmética: `UserRepository.insert` faz
`onConflictDoNothing()` **sem alvo**, o que absorve os quatro índices de uma vez.
Hoje é benigno porque os dois de owner são parciais e o cadastro não os alcança;
com uma segunda via de criação, deixa de ser. O alvo passa a ser nomeado —
`(account_id, email)` — e qualquer outra violação levanta `23505` para o
`isUniqueViolation` já existente. É o mesmo defeito que a DEC-069 já consertou uma
vez em devices.

## Idempotência

`POST /users` não é reentregue por fila nem por webhook: é um formulário. O que é
real é o **clique duplo**, e o mecanismo é o índice único `(account_id, email)`
alcançado pela escrita — o segundo `INSERT` perde e vira 409. Nunca um `SELECT`
antes, que os dois cliques atravessariam juntos.

`DELETE` de um usuário já apagado responde 404 e não chama nada.

## Segurança

- **Vaza a existência de uma conta?** Não. Toda rota aqui é autenticada e
  restrita a `admin`; o 409 fala de um e-mail **da própria account**, que o admin
  já enxerga na lista.
- **Que token é gerado?** Nenhum. A senha temporária não é token: não expira, não
  é de uso único, e é guardada com o mesmo scrypt de qualquer senha (DEC-076).
  Ela existe em claro exatamente uma vez, no corpo do 201.
- **Que sessões precisam morrer?** As do usuário afetado, em **mudança de role**
  e em **exclusão**. As duas pelo mesmo motivo: `role` está dentro de um access
  token de 15 minutos que ninguém revoga.
- **Escalação de privilégio.** `owner` não é criável nem atribuível por esta
  superfície, e um admin não mexe na própria role — então nenhum caminho aqui
  aumenta o alcance de quem o percorre.

## Como validar

```bash
pnpm verify
pm2 stop worker && pnpm --filter @vpn-poc/api test:e2e && pm2 start worker
```

O e2e é a aceitação: os cinco casos que hoje fabricam um colega com
`colleagueOf` passam a criá-lo **pelo endpoint**. Se a rota não existir ou estiver
errada, é a suíte da DEC-070 que fica vermelha.

Depois, no navegador:

1. Entre como owner → **Usuários** → crie um admin. A senha aparece **uma vez**,
   com botão de copiar. Recarregue: ela sumiu.
2. Entre numa janela anônima com aquele e-mail e a senha copiada. Tem que entrar
   direto, sem tela de verificação.
3. Volte como owner, mude a role dele para member. A sessão da outra janela cai
   na requisição seguinte, não em 15 minutos.
4. Como member, abra `/users`: 403.

E a sonda que prova que o portão carrega peso: apague `@RequiresRole` do
controller e rode o e2e. Os 403 têm que virar 200.
