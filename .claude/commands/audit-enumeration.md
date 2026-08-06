---
description: Verifica que nenhum endpoint público revela se um e-mail tem conta
---

Audite CLAUDE.md §1.4.

1. Liste todo endpoint alcançável sem sessão que recebe um e-mail:
   register, login, forgot-password, resend-verification.
2. Para cada um, confirme que a resposta é **idêntica** — status, corpo e código
   de erro — exista ou não a conta.
3. Confirme que `authenticate` faz o trabalho de hash mesmo quando a conta não
   existe; um retorno antecipado é um oráculo de tempo.
4. Confirme que nenhum e-mail é enviado ao dono do endereço num cadastro
   duplicado (seria um vetor de spam apontado para ele).
5. Confirme que o e2e tem uma asserção comparando as duas respostas diretamente,
   e não duas asserções separadas que poderiam divergir.

Reporte violações com caminho e linha.
