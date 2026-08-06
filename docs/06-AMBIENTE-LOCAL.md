# Ambiente local

## 1. Do zero

```bash
git clone --recurse-submodules <url> poc-vpn
cd poc-vpn
cp .env.example .env.local

make up                      # sobe os 7 contêineres e espera ficarem saudáveis
make check                   # 12 asserções; tem que dar 12/12

pnpm install
pnpm packages:publish:local  # publica @vpn/* no Verdaccio local
pnpm --filter @vpn-poc/database db:migrate
pnpm dev                     # api :3000, web :5173
```

Se clonou sem `--recurse-submodules`: `git submodule update --init`.

## 2. Os contêineres

| Serviço      | Porta         | Para quê                                                  |
| ------------ | ------------- | --------------------------------------------------------- |
| postgres 17  | 25432         | banco                                                     |
| redis 7.4    | 26379         | `ICacheStore`                                             |
| verdaccio 6  | 24873         | registry de `@vpn/*` — <http://localhost:24873>           |
| localstack 4 | 24566         | S3, SQS, SNS, Secrets Manager                             |
| localstripe  | 28420         | API do Stripe (sem Checkout, DEC-009)                     |
| mailpit      | 21025 / 28025 | SMTP + caixa de entrada — <http://localhost:28025>        |
| caddy        | 20080 / 20443 | TLS e roteamento por Host — `https://app.localhost:20443` |

Portas no intervalo 2xxxx de propósito (DEC-010): três projetos irmãos dividem
esta máquina e todos queriam a 5432.

## 3. Comandos do devstack

```bash
make up               # sobe e espera
make down             # para
make reset            # apaga volumes e sobe de novo — os pacotes publicados
                      # sobrevivem (o storage do Verdaccio é bind mount)
make reset-registry   # o opt-in explícito para apagar os pacotes também
make reload s=caddy   # depois de editar um config montado
make logs s=postgres
make check
```

`make reload` existe porque editar um arquivo montado não recria o contêiner:
`up` continua servindo o arquivo anterior e a edição parece não ter efeito.

## 4. Rodando os testes

```bash
pnpm test                                          # unitários; Docker parado tudo bem
pnpm --filter @vpn-poc/adapters test:integration   # adapters reais contra o devstack
pnpm --filter @vpn-poc/api test:e2e                # o fluxo inteiro
pnpm verify                                        # lint + typecheck + unitários
```

Os suítes de integração compartilham um banco e um Redis, então rodam num worker
só. Limpam com `DELETE` porque o papel da aplicação não tem TRUNCATE (DEC-005).

## 5. Mexendo em `packages/`

`packages/` é um submodule com workspace próprio, consumido do Verdaccio e não
por caminho (DEC-002). Depois de mudar algo lá:

```bash
cd packages
# suba a version do pacote alterado
pnpm build && pnpm test
pnpm publish:local
pnpm consumer-check          # instala os tarballs FORA do workspace e importa

cd ..
pnpm install                 # o repo principal pega a versão nova
```

`consumer-check` é o que pega `files` errado, subpath faltando em `exports` e
dependência declarada como dev — coisas que funcionam dentro do workspace e só
quebram para quem consome.

## 6. Fluxo manual completo

1. <http://127.0.0.1:5173/signup> → cadastre um e-mail qualquer
2. <http://localhost:28025> → abra a mensagem, clique no link
3. Entre com a senha
4. Assine — o driver local é o `MemoryBillingProvider` (DEC-009), então o
   checkout devolve uma URL `memory://`. Para simular o webhook:

```bash
# o MemoryBillingProvider assina com um esquema próprio; o e2e em
# apps/api/src/auth-billing.e2e.spec.ts mostra o formato exato
```

5. "Esqueci minha senha" → mailpit → redefinir → entrar com a senha nova

## 7. Quando algo não sobe

- **`make check` falha em postgres:** o volume pode ter ficado de uma versão
  anterior do `01-roles.sql`. `make reset`.
- **`permission denied for table X`:** o papel `vpn_app` não tem TRUNCATE e não
  vai ter (DEC-005). Use `DELETE`.
- **Erro de caminho no docker, no Git Bash:** `MSYS_NO_PATHCONV=1` antes do
  comando. `dev.sh` e `check.sh` já fazem isso.
- **`@vpn/...` não encontrado:** o Verdaccio está no ar mas os pacotes não foram
  publicados. `pnpm packages:publish:local`.
- **Login funciona e refresh não:** `credentials: 'include'` no cliente e
  `WEB_ORIGIN` no CORS do servidor precisam bater — e o **host** também.
  O cookie de refresh é `SameSite=Lax`, então `WEB_ORIGIN`, `VITE_API_URL` e o
  `server.host` do Vite precisam usar o mesmo: `localhost` e `127.0.0.1` são
  sites diferentes para o navegador, e o cookie é gravado no login e nunca mais
  enviado. Tudo aqui é `127.0.0.1` (DEC-032).
