# Sobre

O `poc-vpn` é a terceira iteração de uma plataforma de VPN. As duas anteriores
estão na mesma máquina e servem de referência:

- **`poc`** (`vpn-poc`) — polyrepo onde a arquitetura de portas e adapters
  amadureceu: 20 interfaces, 8 suítes de conformidade, devstack de 13 serviços,
  44 decisões registradas. O backend é esqueleto.
- **`convoy`** — monorepo Nx + pnpm com a stack executável: NestJS 11, Drizzle,
  validação de ambiente com zod, pino + Sentry, RTK Query.

Esta iteração herda a **disciplina** do `poc` e a **stack** do `convoy`, num
escopo deliberadamente muito menor.

## O que existe nesta fase

Cadastro, verificação de e-mail, login, refresh com rotação, reset de senha e
assinatura via Stripe — tudo rodando 100% local, com LocalStack simulando a AWS
onde possível.

Toda dependência externa está atrás de uma interface substituível, e cada uma
tem no mínimo duas implementações que passam pela mesma suíte de conformidade.

## O que está fora

Multi-tenancy e RLS, WireGuard e orquestração de nós de saída, Terraform,
aplicativo mobile, jobs em ECS/EC2, deploy real.

`ISmsSender` existe como porta com um adapter de console: verificação por SMS
está no roadmap, e a forma da chamada é a parte cara de mudar depois.

## Princípio

**Local-dev-first.** Um clone novo sobe com `make up` e `pnpm dev`, sem conta
AWS, sem chave de Stripe, sem servidor SMTP. Se um fluxo só pode ser testado
contra um serviço remoto, ou ele ganha um emulador local, ou a lacuna é
registrada no decision log — foi o que aconteceu com o Stripe Checkout em
DEC-009.
