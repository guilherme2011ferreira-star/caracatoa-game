# Guia visual permanente — Caracatoa

**Versão de referência:** Defold 1.14.0
**Status:** direção aprovada; protótipos ainda exigem revisão renderizada.

## Identidade

Caracatoa é um RPG 3D original. A âncora é a atmosfera de MMORPG sul-coreano
clássico do início dos anos 2000: fantasia medieval sombria, alta magia,
armaduras legíveis e arquitetura cerimonial. WYD e Lineage II orientam a
linguagem geral. Não copiar personagens, mapas, modelos, texturas, logotipos,
emblemas ou outros elementos protegidos.

## Forma e composição

- Construir silhuetas reconhecíveis à distância, com volumes proporcionais e
  variação deliberada. Uma cena não pode depender de cubos repetidos, paredes
  lisas ou telhados triangulares genéricos.
- Arquitetura gótica medieval: arcos ogivais, contrafortes, vãos profundos,
  torres assimétricas, ameias, esculturas, ruínas e entradas com escala humana.
  Mostrar limites arquitetônicos plausíveis, apoios, espessura de paredes,
  pisos e transições.
- Personagens: anatomia estilizada esguia, postura de combate/repouso, peças
  articuladas e silhueta por classe. Detalhes de classe ficam em
  [`direcao-visual-dos-personagens-caracatoa.md`](direcao-visual-dos-personagens-caracatoa.md).
- Terreno e vegetação precisam de variação de forma, escala, rotação e
  composição; evitar repetição óbvia e planos uniformes.

## Materiais, cor e iluminação

- Materiais distinguíveis: pedra irregular e desgastada, madeira marcada,
  ferro escuro, bronze envelhecido, aço/prata fria, ouro contido, couro e
  tecidos em camadas. Acrescentar marcas, relevos e variação pintada que
  continuem visíveis na câmera de jogo.
- Tratar superfícies com breakup pintado à mão: variação tonal desigual,
  contornos gastos e marcas de uso. Evitar grades regulares, fileiras
  ortogonais, blocos quadrados repetidos, cor chapada ou ruído fotográfico fino.
  Irregularidade deve parecer construída e envelhecida, não aleatória.
- Paleta-base: carvão e basalto, ferro, bronze, ouro discreto e carmesim;
  luz quente âmbar equilibrada por preenchimento lunar frio. Magia pode emitir
  cor e brilho local sem lavar a silhueta do objeto.
- Estilizado, não fotográfico. Evitar plástico liso, metal amarelo uniforme,
  brilho cobrindo detalhe, neblina que esconda leitura ou contraste que apague
  personagens.

## Implementação na Defold

- Cliente em `work/caracatoa-defold-prototype/`, engine 1.14.0. Modelos e
  materiais de runtime ficam em `assets/`; conceitos, renders e prévias de
  aprovação ficam em `docs/art/`.
- O pipeline atual importa GLB por recursos `.model` e usa materiais/shaders
  Defold existentes. Consulte o recurso e a versão real antes de introduzir
  formatos, APIs ou efeitos novos. Compatibilidade de build não prova leitura
  visual no runtime.
- A iluminação do modelo atual inclui um fragment shader próprio
  `assets/shaders/caracatoa_town.fp`, mas a inspeção do código não confirma
  sombras dinâmicas nem luzes de cena completas. LOD, culling e limites de
  desempenho ainda precisam de medição; não depender de suporte automático sem
  verificá-lo na Defold 1.14.0.
- Preservar autoria/licença e atribuição junto ao asset. Não adicionar
  dependências externas por conveniência quando o formato atual é suficiente.

## Revisão

Verificar a saída renderizada em close e na câmera de jogo; forma, proporção,
materiais, luz, legibilidade e custo. O render de software, uma galeria GLB e
um build bem-sucedido têm escopos distintos da captura no cliente. Se não for
possível abrir/inspecionar o runtime, registrar essa limitação e não marcar a
arte como aprovada. Usar
[`caracatoa-visual-review`](../../.agents/skills/caracatoa-visual-review/SKILL.md)
para a lista de verificação.

## Referências de decisão

- [`ADR 0332`](../adr/0332-previsualizacao-3d-antes-da-integracao.md): prévia
  isolada antes de integrar modelos e módulos novos.
- [`ADR 0333`](../adr/0333-cenario-3d-a-partir-da-arte-aprovada.md): cenário
  original derivado da linguagem aprovada.
- [`ADR 0350`](../adr/0350-revisao-visual-das-couracas-astrais.md): proporções
  e rejeições de armaduras genéricas.
- [`ADR 0355`](../adr/0355-direcao-de-arte-e-pipeline-visual-caracatoa.md):
  pipeline visual, limites conhecidos e protótipo de referência isolado.
- [`ADR 0357`](../adr/0357-texturas-irregulares-e-personagens-organicos.md):
  breakup de textura, irregularidade material e formas orgânicas controladas.
