# poc-vpn — como trabalhar neste repositório

Fonte única de verdade sobre **como** trabalhar aqui. O que o sistema **é** está
em [`CONTEXT.md`](CONTEXT.md) e em [`docs/`](docs/).

---

## 1. Os cinco inegociáveis

1. **Todo serviço externo entra por uma porta.** Um pacote npm de terceiros, uma
   API HTTP, um recurso AWS — nada disso é chamado direto de um service. Existe
   uma interface `I*` em `@vpn/ports` e um adapter em `libs/adapters/`.
   Serviços **nossos** não ganham interface: o critério é "eu teria que
   substituir isto?", não "isto poderia ser abstraído?".

2. **Toda porta tem uma suíte de conformidade, escrita antes do adapter.** Ela
   mora em `@vpn/testing/contracts` e roda contra **todas** as implementações —
   a in-memory e a real. Uma porta com um adapter só não provou nada.

3. **Idempotência primeiro.** Todo handler que pode ser reentregue (webhook,
   fila, retry de rede) precisa ser seguro para rodar duas vezes. O mecanismo é
   uma restrição no banco, nunca um `if (jáVimos)` — dois processos concorrentes
   passam pelo `SELECT` juntos.

4. **Nenhum endpoint público revela se um e-mail tem conta.** `register`,
   `forgot-password` e `resend-verification` respondem idêntico nos dois casos.
   `login` responde idêntico para senha errada e conta inexistente — inclusive
   no tempo de resposta.

5. **TDD.** O teste que falha vem primeiro. Cobertura mínima de 80%, e o piso
   sobe, nunca desce (`@vpn/config`).

## 2. Antes de escrever código

1. Termo novo do domínio → entra em `CONTEXT.md` **antes** do schema.
2. Feature não trivial → spec em `docs/specs/`, a partir de `_TEMPLATE.md`,
   **antes** do teste RED.
3. Decisão arquitetural → `DEC-NNN` em `docs/03-DECISION-LOG.md`. Decisão
   superada nunca é editada nem apagada: ganha `Status: superseded by DEC-NNN`.

## 3. Fronteira dos pacotes

`packages/` é um **git submodule** com workspace próprio. O repositório
principal o consome **do Verdaccio**, como qualquer dependência de terceiro —
nunca por caminho relativo.

Isso é deliberado e é a razão de `tools/consumer-check` existir: dentro do
workspace, `workspace:*` resolve para o diretório de origem e um `files` errado,
um subpath faltando em `exports` ou uma dependência declarada como dev
funcionam perfeitamente. Só quebram para o consumidor.

- `@vpn/*` → publicado, vem do registry. Mudou? `pnpm packages:publish:local`.
- `@vpn-poc/*` → interno do workspace, nunca publicado.
- `pnpm link` é proibido.

## 4. Convenções de código

- **Idioma:** documentação em pt-BR; código, nomes de arquivo, chaves de i18n e
  mensagens de commit em **inglês**.
- **O código se explica sozinho.** Não há bloco de cabeçalho, não há comentário
  explicativo. Um comentário é permitido em exatamente dois casos: pragma
  funcional (`v8 ignore`, `eslint-disable`) e uma linha curta onde o _valor_ de
  uma constante não se deduz do nome. Se você sente vontade de explicar um
  arquivo, o texto pertence ao `CLAUDE.md` daquele diretório; se é um caso de
  borda, ele vira teste. Ver DEC-013.
- **Token de DI é um `Symbol.for('vpn.*')` ao lado da interface** — interfaces
  somem em runtime, e `ports.guard.spec.ts` exige exatamente essa forma.
- **`import type` só para tipos.** Uma classe injetada por construtor precisa de
  import de valor, senão o `emitDecoratorMetadata` do Nest resolve `Object` e o
  container falha com um erro que não aponta para a causa.
- **Nada de `any`.** `unknown` + narrowing. Um cast precisa de um comentário
  dizendo qual incompatibilidade ele contorna.
- Datas cruzam JSON como string. Todo adapter que faz parse de payload externo
  **revive** as datas — a suíte de conformidade cobra isso.

## 5. Commits

Verbo no presente, sem prefixo de Conventional Commits. Assunto e corpo em
inglês. O corpo tem 2 a 4 bullets, e cada um responde **por quê**, não o quê —
o diff já diz o quê.

```
Add the shared port, contract and testing packages

- The ports package is where every external dependency is declared, so that
  swapping a provider is one adapter rather than an audit of every call site.
- The conformance suites ship next to the interfaces because a port only
  guarantees interchangeability if both adapters face the same assertions.
```

## 6. Divergências conscientes de `convoy` e `poc`

| Aqui                                    | Lá                              | Por quê                                                                                                     |
| --------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Monorepo com `packages/` como submodule | `poc` é polyrepo                | Escopo menor; a fronteira que importa é a de publicação, e o submodule a preserva sem o custo de sete repos |
| `libs/adapters` (um pacote)             | `convoy` tem `libs/providers/*` | Oito `package.json` para oito adapters não se paga nesta fase. A fronteira é a interface, não o pacote      |
| `ICacheStore` com `owner`               | `convoy` usa `ICacheService`    | Prefixo `I` explícito, e o dono da entrada faz parte do **tipo** da chave                                   |
| scrypt                                  | Argon2id seria melhor           | Sem addon nativo em três plataformas + build Lambda. DEC-007                                                |
| `BILLING_DRIVER=memory` local           | Stripe real                     | localstripe não tem Checkout Sessions. DEC-009                                                              |
| Sem `ValidationPipe`                    | `convoy` usa class-validator    | Zod já valida, e os schemas são compartilhados com o front                                                  |

## 7. Armadilhas conhecidas deste projeto

- **Body cru do webhook.** A assinatura cobre os bytes exatos. Reserializar o
  JSON não dá bytes idênticos, e a falha só aparece contra o provider real.
- **Rotação de refresh token.** Rejeitar só o token replayado deixa o ladrão com
  um token válido. Revogue a família inteira.
- **`ALTER DEFAULT PRIVILEGES` não inclui TRUNCATE.** O papel da aplicação não
  tem esse privilégio — é intencional. Testes usam `DELETE`.
- **StrictMode roda efeitos duas vezes.** Qualquer efeito que consome um token
  de uso único precisa de guarda.
- **`pnpm` + Windows + Git Bash:** `MSYS_NO_PATHCONV=1` antes de qualquer
  comando docker com caminho absoluto.

## 8. Comandos

```bash
make up                    # devstack (docker)
make check                 # 16 asserções sobre o devstack
pnpm db:migrate            # `up` e `reset` já rodam; aqui é para rodar sozinho
pnpm dev                   # infra + api + web + worker (pm2)
pnpm logs:trace <id>       # rastro completo de uma requisição, por correlationId
pnpm tunnel:doctor         # nó, banco e túneis desta máquina, e o que não bate

pnpm verify                # lint + typecheck + testes unitários
pnpm --filter @vpn-poc/adapters test:integration   # adapters reais, precisa do devstack
pnpm --filter @vpn-poc/api test:e2e                # fluxo completo, precisa do devstack

pnpm packages:publish:local  # republica @vpn/* no Verdaccio
```
