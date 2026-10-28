# ADR 0350 — Revisão visual das couraças Astrais

- **Status:** v1–v7 rejeitadas visualmente e fora do jogo; escopo de classes e tiers permanece aceito.
- **Data:** 27/10/2026.
- **Relacionado:** ADRs 0331 e 0332.

## Contexto

O usuário rejeitou as primeiras malhas GLB das doze couraças: a leitura ficou rígida e genérica, distante do MMORPG medieval gótico clássico usado como referência. O catálogo continua definido por quatro classes e três tiers, mas a apresentação visual precisa de nova execução.

## Decisão

1. Retirar as malhas 3D v1 da fila de integração. Não alteram a aparência de personagem nem entram no cliente.
2. Usar a prancha forjas-astrais-3d-v2/forjas-astrais-concept-v2.png como estudo de direção, não como arte aprovada ou asset de gameplay.
3. Para a nova malha, trabalhar silhuetas humanas proporcionais, superfície vestível articulada, placas arredondadas e sobrepostas, couro/tecido por classe, acabamento de ferro escuro, bronze envelhecido, prata fria e ouro contido. Diferenciar TransKnight (placas pesadas), Foema (manto e placas elegantes), BeastMaster (couro e escamas flexíveis) e Huntress (proteção leve e mobilidade).
4. Manter três tiers por classe e IDs mecânicos atuais. A estética não muda stats, drops ou regras.
5. Produzir prévia 3D isolada e conferir leitura em escala de personagem antes de integrar. A imagem conceitual não substitui essa prévia.

## Consequências

- A tentativa v5 gerou doze GLBs estáticos, mas a inspeção ainda mostrou manequins rígidos. Essa versão segue rejeitada e fora do cliente.
- A candidata v6 gera doze GLTF sobre os corpos e esqueletos dos quatro modelos de classe que o cliente já usa. Cada malha nova contém pesos `JOINTS_0`/`WEIGHTS_0`, com placas, tecidos e detalhes específicos por classe. `preview-v6.html` permite girar as variantes no visualizador 3D.
- O teste `armors-v6.test.mjs` verifica a presença dos avatares-base, os 12 IDs, buffers, texturas, atributos de skin e pesos normalizados. Isso prova a estrutura skinned no GLTF, mas não prova a pose durante animação nem a leitura no cliente Defold. A v6 ainda não tem aprovação estética ou integração e não conta como correção concluída.
- Validação local: `node --check generate-skinned-armors-v6.mjs`, `node --check armors-v6.test.mjs` e `node --test --test-reporter=spec armors-v6.test.mjs` passaram (1 teste cobrindo as 12 variantes). A página, os doze GLTFs, seus doze buffers e os arquivos de textura conferidos responderam HTTP 200 pelo preview local. Não foi feita captura visual no Model Viewer ou no cliente Defold.
- O catálogo e o loot podem existir no servidor, mas nenhum destes itens tem visual final aprovado no jogo.
- A avaliação manual da Etapa 1 pode usar a build atual para acesso/criação/cidade, mas não deve ser interpretada como teste ou aprovação das armaduras.

### Revisão v7 — rejeitada

A v7 tentou acrescentar uma casca curva ao torso e um clip `Idle_Loop` aos mesmos
avatares-base usados nas v6. A inspeção da prancha
`forjas-astrais-3d-v2/rendered-model-sheet-v7.png` mostra que o resultado ainda
parece um humanoide genérico em pose de manequim com placas geométricas simples.
O corpo-base, a silhueta, o acabamento e a leitura de armadura não alcançam as
referências de personagem do WYD fornecidas pelo usuário. O clip incluído no
GLTF não foi validado no cliente Defold e não muda essa avaliação visual.

As verificações de estrutura e geração da v7 não são critério de aceitação
artística. As malhas v1–v7 permanecem isoladas e não devem ser integradas nem
apresentadas como prontas. O próximo avanço visual deve ser um único protótipo
de personagem completo, com equipamento integrado ao corpo, silhueta e
proporções coerentes com as referências e uma pose de combate legível. A
avaliação deve ocorrer em close e na escala de gameplay antes de expandir para
outras classes e tiers. Se a referência de estilo não estiver visivelmente
presente, interromper e corrigir o protótipo em vez de produzir outra série.

### Complemento das referências de personagens — 27/10/2026

O usuário enviou sete novas referências de personagens e equipamentos. Elas
reforçam a distinção de silhueta entre TK (placas e peso), Foema (vestes e foco
mágico), BM (couro/peles e formas orgânicas) e HT (proteção leve, mobilidade e
arco). As telas de equipamentos e os guerreiros dourados mostram placas
articuladas e ornamentação legível; a imagem de acabamento dourado é uma
referência de tier alto. A prancha ilustrada orienta os arquétipos, não o estilo
final do render 3D.

O próximo protótipo deve seguir
[`docs/art/direcao-visual-dos-personagens-caracatoa.md`](../art/direcao-visual-dos-personagens-caracatoa.md).
Essa folha complementa as decisões desta ADR e deixa explícita a revisão em
close e em escala de gameplay. Ela não aprova nem reabilita as meshes v1–v7.
