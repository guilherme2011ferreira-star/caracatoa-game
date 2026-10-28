# ADR 0355 — Direção de arte e pipeline visual do Caracatoa

- **Status:** aceita como direção permanente; medidas de runtime ainda pendentes.
- **Data:** 27/10/2026.
- **Relacionado:** ADRs 0332, 0333, 0347, 0350, 0352 e 0353.

## Contexto

O usuário reforçou que as estruturas atuais parecem genéricas e geométricas,
distantes das imagens de MMORPGs coreanos do início dos anos 2000. Pediu uma
identidade original que mantenha a atmosfera gótica medieval, materiais
artesanais, personagens estilizados e leitura clara. Também pediu que a
memória de produção sobreviva à conversa e que um ambiente pequeno sirva para
validar o padrão antes de expandi-lo.

A inspeção do cliente confirma Defold 1.14.0, recursos `.model` para GLB e o
fragment shader `assets/shaders/caracatoa_town.fp`. Esse shader amostra uma
textura e modula a cor por luz interpolada a partir dos atributos do modelo.
Isso não demonstra, por si só, sombras dinâmicas, luzes de cena ou orçamento de
desempenho medido no cliente.

## Alternativas consideradas

1. Continuar usando volumes simples e aumentar apenas a quantidade de props —
   rejeitada porque mantém a aparência de protótipo que motivou o pedido.
2. Trocar engine/renderizador — rejeitada nesta decisão: a Defold 1.14.0 já
   carrega os modelos e materiais do cliente; não há medição que justifique
   reescrever uma base que funciona.
3. Refinar um ambiente compacto com forma, material e iluminação deliberados,
   validar em Defold e só então aplicar o procedimento a cenas maiores —
   escolhida.

## Decisão

1. Adotar a direção permanente registrada em
   [`docs/art/caracatoa-visual-style-guide.md`](../art/caracatoa-visual-style-guide.md):
   fantasia medieval gótica estilizada, proporções de MMORPG clássico,
   silhuetas assimétricas, pedra/ferro/bronze/carmesim e luz quente/fria
   equilibrada. WYD e Lineage II são referências amplas; conteúdo expressivo
   deve ser Caracatoa original ou licenciado.
2. Preservar o pipeline Defold atual (`.glb` → recurso `.model` → material e
   shader Defold) até que uma limitação concreta peça outra solução. Validar
   formatos, APIs e efeitos no Defold 1.14.0 instalado; não presumir suporte
   nativo a LOD, sombras, culling ou iluminação dinâmica.
3. Criar primeiro um ambiente de referência compacto e isolado em
   `docs/art/concept/`. Ele deve conter silhueta arquitetônica legível,
   alvenaria e marcenaria com variação, terreno/vegetação controlados e
   iluminação estilizada; não substituir a cidade ativa automaticamente.
4. Renderizar e revisar em close e na escala da câmera de gameplay. Medir o
   custo do bundle/modelo e a leitura no cliente; uma galeria, render offline ou
   build sem captura não aprova o ambiente para gameplay.
5. Manter os critérios de aprovação de gameplay da ADR 0347 e o fluxo de prévia
   antes da integração da ADR 0332. O estudo visual não muda sistemas ativos
   nem avança a etapa de gameplay.
6. Manter instruções curtas em `AGENTS.md`, decisões duradouras nesta ADR e
   procedimentos reutilizáveis em `.agents/skills/`. O guia visual registra os
   critérios estáveis; não duplicar listas extensas entre os três.

## Consequências

- O padrão artístico fica registrado e pode ser consultado sem depender do
  histórico desta conversa.
- O pipeline permanece econômico e compatível com a base atual, mas detalhes
  de iluminação avançada, LOD e desempenho ficam em aberto até haver teste
  concreto na Defold 1.14.0.
- O primeiro ambiente é um estudo isolado. Só uma revisão posterior e
  aprovação de integração podem alterar a cidade jogável.
- Skills de arquitetura, personagens, materiais, luz e revisão serão
  versionadas no repositório; seu escopo é procedimental e remete ao guia/ADRs.
