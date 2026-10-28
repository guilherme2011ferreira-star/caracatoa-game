# ADR 0347 — Marcos de gameplay com aprovação do jogador

- **Status:** Aceita
- **Data:** 27/10/2026

## Contexto

O desenvolvimento de Caracatoa precisa produzir versões que o jogador consiga
abrir e avaliar em jogo. Testes automatizados validam regras e comunicação,
mas não mostram por si só a leitura visual, a sensação de controle ou a
qualidade da gameplay. Também há modelos de equipamento cuja prévia ainda não
foi aprovada.

## Decisão

Dividir o desenvolvimento em marcos jogáveis numerados em
`docs/roadmap/etapas-de-gameplay-caracatoa.md`. Cada marco terá escopo, testes
automáticos, roteiro de teste manual e critérios de saída. A entrega deve
incluir uma build local e instruções para reproduzir quando o cliente for
afetado.

Um marco só é considerado aprovado quando o usuário confirmar que testou e
aprova a gameplay daquele marco. Até essa confirmação, o trabalho fica na
mesma etapa; a etapa seguinte não começa. Modelos e arquitetura novos aparecem
em prévia isolada antes da integração, conforme ADR 0332. Uma falha nos testes
automáticos bloqueia a entrega como pronta; testes automáticos aprovados não
substituem a avaliação manual.

## Consequências

- O avanço fica verificável e cada aprovação tem um escopo conhecido.
- Algumas funcionalidades ficam temporariamente em prévia ou fora do jogo até
  a revisão visual.
- O status do projeto distinguirá implementação, teste automático, teste
  manual e aprovação do usuário, sem chamar uma sessão sintética de playtest.
- Commits só incluem alterações que o usuário tenha validado, conforme
  `AGENTS.md`.
