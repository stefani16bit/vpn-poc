# Fundação de UI e organização em camadas

**Status:** entregue
**Decisões relacionadas:** DEC-019, DEC-020, DEC-021, DEC-022, DEC-023, DEC-024,
DEC-025, DEC-026, DEC-027, DEC-028

> **Pendente:** a passagem manual de navegador descrita em "Como validar" ainda
> não foi feita. Ela é a única parte desta spec que nenhum teste substitui, e o
> commit que apagou o CSS legado já passou — reverter uma página agora devolve
> uma página sem estilo.

## Problema

Três sintomas de uma mesma causa: nada obriga o código a ficar onde ele deveria
estar.

**No front, não existe camada de componente.** `apps/web` não tem nenhuma
dependência de UI. Toda tela é markup à mão contra uma folha de estilo global, e
o resultado é duplicação contável: `<section className="card">` em nove lugares,
a tela terminal de mensagem copiada cinco vezes, e um formulário que
reimplementa `Field` e `Submit` à mão porque o par existente não serve para um
formulário fora do react-hook-form. Não há tema claro, não há anel de foco em
botão nem em link, e nenhum campo associa seu erro ao seu controle.

**No back, o módulo é plano.** Um arquivo de 59 linhas carrega quatro exports
com públicos diferentes; um de 235 mistura rate limit, identidade, sessão,
composição de e-mail e mapeamento. Duas preocupações transversais — o guard de
acesso e o rate limit — moram dentro de `modules/auth`, e é por isso que
`billing` alcança `../auth/`. Nenhum dos dois módulos de feature tem um teste
unitário.

**Em nenhum dos dois lados a fronteira é verificável.** As regras existem, em
prosa, nos `CLAUDE.md`. `@nx/enforce-module-boundaries` opera por projeto, então
todo `apps/api/src` é um nó só e nada impede um módulo de importar o outro. Uma
regra que ninguém verifica é uma regra que já foi quebrada e ninguém viu.

## Escopo

Entra:

- Tailwind v4 e shadcn/ui em `apps/web`, com os componentes copiados para
  `src/components/ui/`, e tema claro e escuro.
- Reorganização de `apps/web` por feature, incluindo a quebra do `createApi`
  monolítico em base mais `injectEndpoints` por feature.
- Camadas em `apps/api`: `controllers/`, `services/`, `repositories/`,
  `mappers/` por módulo, e `common/` virando o kernel `shared/`.
- Movimentação de controle de acesso e de rate limit para o kernel.
- Extração de repositório, de composição de e-mail e de mecânica de cookie, cada
  uma com o teste unitário que hoje não existe.
- Zonas de importação verificadas por lint nos dois apps.
- Piso de cobertura ligado nos dois apps.
- A11y: `aria-invalid`/`aria-describedby`, foco na troca de tela, `lang` no
  `documentElement`, skip link, `role="status"`, `aria-busy`.

**Não** entra, explicitamente:

- Nenhuma mudança de schema, de rota, de contrato ou de comportamento de API
  observável pelo front — salvo as duas correções nomeadas em "Comportamento".
- Nenhum pacote `@vpn/ui`. Ver DEC-019.
- Playwright. A dívida de teste de tela continua no roadmap; esta spec entrega
  teste de componente e de página em jsdom, não teste de navegador.
- Prettier e qualquer reformatação de repositório. Ver DEC-022.
- Teste de integração de repositório. Ver DEC-026 — entra no roadmap.
- Redesenho visual. As telas ganham tokens e primitivos; não ganham layout novo.

## Vocabulário

Termos novos, todos já em `CONTEXT.md`:

**Kernel compartilhado** (`shared/`) — a camada da qual todo módulo pode
depender e que não pode depender de módulo nenhum.

**Repository** — o nosso código de query em cima do token `DATABASE`. Não é
porta, e a distinção é o assunto de DEC-026.

**Primitivo** e **composto** — primitivo é o componente copiado do registry, sem
conhecimento do domínio; composto é o nosso, que conhece `t()`, `NormalizedError`
e o formato de um campo.

**Token de tema** — a variável CSS que nomeia um papel (`--background`,
`--destructive`), não uma cor. É o que permite duas paletas com um markup só.

## Comportamento

A maior parte deste trabalho é movimentação, e movimentação não tem
comportamento novo para descrever. O que segue é o que **muda** de fato.

```
Dado    uma conta cujo locale é en
Quando  o webhook de falha de pagamento chega para essa conta
Então   o e-mail é composto em en
```

Hoje é composto em pt-BR incondicionalmente: `billing.service.ts` fixa
`locale: 'pt-BR'` nos dois envios. Isso contraria DEC-015, cuja promessa é que a
precedência conta > `Accept-Language` > fallback vale para todo e-mail.

```
Dado    uma assinatura sem currentPeriodEnd
Quando  o e-mail de cancelamento é composto
Então   o texto do período vem de billing.periodEndUnknown
```

Hoje vem do literal `'o fim do período vigente'` embutido no service, que é uma
string voltada ao usuário em código de produção — proibida pelo `CLAUDE.md`.

```
Dado    um campo de formulário com erro de validação
Quando  a tela é renderizada
Então   o controle tem aria-invalid
E       aria-describedby aponta para o nó da mensagem
E       sem erro, nenhum dos dois atributos existe
```

```
Dado    uma tela terminal (caixa de entrada, link inválido, verificação ok)
Quando  ela substitui o formulário
Então   o foco vai para o título
```

Hoje o foco fica em `<body>`: para quem usa leitor de tela, a árvore em que ele
estava foi removida e nada o reposicionou.

```
Dado    um usuário que escolheu o tema claro
Quando  ele recarrega a página
Então   não há nenhum quadro escuro antes da primeira pintura
```

```
Dado    o guard de acesso movido para o kernel
Quando  qualquer rota de cobrança é chamada sem token
Então   a resposta é a mesma de antes do movimento
```

Este é o comportamento que a movimentação **não** pode mudar, e por isso vira
teste antes dela — ver "Como validar".

**Caso de borda vira teste, não comentário no código.** Os que entram como teste
nesta spec: `clear` do cookie de refresh usando exatamente as mesmas opções do
`set` (opção diferente não limpa cookie nenhum); `Math.max(1, …)` no cálculo de
horas do e-mail, que faz 1800s virar "1"; segundo submit durante o cooldown de
reenvio não disparar a mutation; `claim` do evento de cobrança retornando
`false` fazer o handler não aplicar nada.

## Portas afetadas

**Nenhuma.**

Este trabalho não introduz dependência externa nova. `radix-ui`, `lucide-react`
e `tailwindcss` são bibliotecas de renderização dentro do processo, não
serviços: não têm I/O, não têm credencial, não têm indisponibilidade e não há
"a outra implementação" para a qual trocar. Uma porta existe para trocar um
**serviço**, não para abstrair uma biblioteca.

Vale escrever isto porque as regras deste repositório convidam exatamente à
pergunta oposta, e a resposta precisa ficar no registro em vez de ser
redescoberta.

Os repositórios extraídos também não são portas, pelo motivo separado de
DEC-026.

- [x] Interface em `@vpn/ports` — N/A
- [x] Suíte de conformidade — N/A
- [x] Adapter in-memory — N/A
- [x] Adapter real — N/A
- [x] Wiring em `adapters.module.ts` — N/A

## Banco

Nenhuma tabela nova, nenhuma coluna nova, nenhuma migration.

`verificationTokens`, `subscriptions` e `billingEvents` passam a ser acessadas
por uma classe de repositório em vez de por drizzle inline no service. As
queries são as mesmas, textualmente.

## Idempotência

Nada novo pode chegar duas vezes. O que existe precisa sobreviver ao movimento:

`BillingEventRepository.claim(source, externalEventId, kind)` **é** o
`insert(billingEvents).onConflictDoNothing({ target: [source, externalEventId] }).returning()`
que já estava no service, retornando `rows.length > 0`. O `false` é o índice
único perdendo a corrida entre dois processos, não uma consulta prévia. O
handler continua com `if (!claimed) return false`, que é um desvio sobre o
resultado de uma restrição — o padrão exigido — e não um `if (jáVimos)`.

A tentação a evitar durante a extração é dar ao repositório um método
`exists()`: ele tornaria o `claim` legível e a idempotência falsa.

## Segurança

**O movimento do guard não pode mudar a proteção de nenhuma rota.** É a única
mudança de wiring desta spec com consequência de segurança: `BillingModule`
deixa de importar `AuthModule` e passa a importar `AccessControlModule`. A prova
é o e2e, que exercita as rotas de cobrança sem token e com token de conta não
verificada, mais os testes unitários do guard escritos **antes** do movimento.

**A composição de e-mail não pode passar a vazar existência de conta.**
`AuthMailer` e `BillingMailer` são extrações de código que já rodava; nenhum
deles pode ser chamado a partir de um caminho onde o envio (ou o tempo dele)
passe a depender de a conta existir. `forgot-password` e `resend-verification`
continuam respondendo idêntico nos dois casos.

Nenhum token novo é gerado. Nenhuma sessão passa a morrer ou a sobreviver em
condição diferente. `AccessTokenService.verify` continua conferindo issuer e
audience — há teste unitário novo para os dois, que não existia.

O script inline do `index.html` lê `localStorage` e mexe numa classe do
`documentElement`. Não toca em token, não faz rede, e está dentro de um try.

## Como validar

**Por commit.**

```bash
pnpm verify
git diff --stat -M --find-renames=90%   # em commit de movimentação: R###, não delete+add
```

Se o git relata um delete mais um add onde o commit afirma mover, o commit mudou
mais do que diz e precisa ser dividido. Todo o argumento de segurança desta
spec depende de movimentação ser movimentação.

**Em qualquer commit de `apps/api`.**

```bash
make up
pnpm --filter @vpn-poc/api test:e2e
```

**Sondas de zona**, uma vez cada, pelo precedente de DEC-017: acrescentar o
import proibido, confirmar que `pnpm lint` falha com a mensagem pretendida,
reverter. São oito — quatro em `apps/api`, quatro em `apps/web`. Uma zona que
nunca dispara é pior que zona nenhuma, porque parece proteção.

**Depois da fase de API.**

```bash
pnpm --filter @vpn-poc/adapters test:integration
```

Subir a API e confirmar que toda rota de cobrança ainda responde 401 sem token e
`EMAIL_NOT_VERIFIED` para conta não verificada.

**Depois da fase de UI, passagem manual no navegador.** `pnpm dev`, e então,
para **os dois temas × os dois locales × as seis telas**:

1. Cadastro → caixa de entrada → verificação → login → cobrança → cancelamento.
2. Um formulário inteiro só com teclado: ordem de tabulação, anel de foco
   visível em botão e em link, e o skip link aparecendo ao receber foco.
3. Leitor de tela em dois pontos: o erro de um campo e a contagem regressiva do
   reenvio.
4. Alternar o tema e recarregar: nenhum quadro do tema anterior.
5. Navegador em `en` sem preferência salva: a negociação escolhe `en`.
6. `prefers-reduced-motion` ativo: nenhuma transição essencial se perde.

Esta passagem roda **antes** do commit que apaga o CSS legado, não depois. Até
ele, reverter a conversão de uma página devolve uma página que renderiza; depois
dele, não.

**Cobertura**, medida antes de ligar o piso em cada app:

```bash
pnpm --filter @vpn-poc/api test -- --coverage
pnpm --filter @vpn-poc/web test -- --coverage
```

`Math.max(80, …)` torna impossível ligar abaixo de 80 — se o número estiver
abaixo, o passo fica bloqueado até os testes de extração existirem.
