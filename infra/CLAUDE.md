# infra

**Status:** scaffold · **Tag:** `type:infra`

AWS CDK. Seis stacks **sem nenhum recurso**, com o grafo de dependências montado
e validado a cada `pnpm synth`.

Mover um recurso de stack depois do deploy significa destruir e recriar; para o
banco isso é indisponibilidade e restore. A divisão é a decisão cara — o
conteúdo não é. Ver DEC-011.

```
network ← data  ← api
        ← events ←
        ← workers
observability (independente)
```

`data` antes de `api` para que a API nunca seja publicada contra um banco que
não existe. Nada depende de `api`, e é isso que a torna a única stack segura de
reverter sozinha.

`config/environments.ts` é TypeScript, não context do `cdk.json`: valores de
context são `any`, então um erro de digitação sintetiza uma stack com
`undefined` onde deveria haver contagem de subnet, e a falha chega no deploy.
`validate()` recusa produção com AZ única, sem proteção de deleção, ou com
retenção de log curta demais para investigar.

## Don't

- Não importe nada de `apps/` ou `libs/` — o lint bloqueia.
- Não coloque segredo em context nem em variável de stack; um template de
  CloudFormation é legível por qualquer um com describe-stacks.
- Não relaxe `validate()` para fazer um deploy passar.
