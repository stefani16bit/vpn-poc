# <nome da feature>

> Copie este arquivo para `docs/specs/<kebab-case>.md` e escreva **antes** do
> primeiro teste RED. Se não dá para preencher "Como validar", a feature ainda
> não está entendida o suficiente para ser implementada.

**Status:** rascunho | em implementação | entregue
**Decisões relacionadas:** DEC-NNN

## Problema

Qual necessidade real isto atende. Não a solução — o problema. Se a frase
descreve uma implementação, ainda não é o problema.

## Escopo

O que entra. O que **não** entra, explicitamente: a lista de fora é a que evita
a discussão na revisão.

## Vocabulário

Termos novos do domínio. Todo termo aqui precisa entrar em `CONTEXT.md` antes do
schema.

## Comportamento

Cenários no formato Dado / Quando / Então. Um por comportamento observável,
incluindo os caminhos infelizes — que são os que costumam faltar.

**Caso de borda vira teste, não comentário no código.**

```
Dado    uma conta não verificada
Quando  o usuário tenta entrar com a senha correta
Então   a resposta é 403 com código EMAIL_NOT_VERIFIED
E       nenhuma sessão é criada
```

## Portas afetadas

Alguma dependência externa nova? Então:

- [ ] Interface em `@vpn/ports` — sem bloco de comentário (DEC-013)
- [ ] Suíte de conformidade em `@vpn/testing/contracts`, escrita **antes** do adapter
- [ ] Adapter in-memory (que é também o driver `memory`)
- [ ] Adapter real
- [ ] Wiring em `adapters.module.ts` com a variável de ambiente que escolhe

## Banco

Tabelas e colunas novas. Para cada uma: quem escreve, quem lê, e o que a apaga.
Se nada apaga, isso é dívida — registre no roadmap.

## Idempotência

Esta operação pode chegar duas vezes? Se sim, o que faz a segunda ser um no-op —
e por que esse mecanismo funciona com dois processos concorrentes.

## Segurança

- Vaza a existência de uma conta? (respostas **e** tempo de resposta)
- Que token é gerado, quanto vive, é de uso único, é guardado com hash?
- Que sessões precisam morrer quando isto acontece?

## Como validar

Comandos e passos concretos que provam que funciona. Um revisor deve conseguir
seguir isto sem fazer perguntas.
