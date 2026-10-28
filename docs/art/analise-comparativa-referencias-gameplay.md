# Comparação das referências de gameplay — Caracatoa

Atualizado em 28/10/2026. A lista abaixo separa o que aparece nas quatro
capturas do que o código e os testes atuais do Caracatoa demonstram. As imagens
orientam composição e leitura; nomes, números, símbolos, modelos, mapas e
arquivos de terceiros não foram copiados.

## Diferenças observáveis

| Referência | Evidência visível | Estado atual do Caracatoa | Lacuna que a imagem evidencia |
| --- | --- | --- | --- |
| **1 — cidade, personagem montado e equipamento** | Personagem grande e montado no centro; HP/MP no alto; equipamento à direita; chat e atalhos distribuídos nas bordas inferiores. | Cliente 3D Defold, Bastião, status HP/MP do servidor, alvo, três habilidades reais e mochila em grade 5×4. A câmera agora acompanha o avatar com três distâncias e zoom pelo scroll. | O personagem ainda precisa de escala e silhueta melhores; falta equipamento vestido e montaria visual aprovada. O HUD precisa deixar a cena e o avatar visíveis. |
| **2 — combate em grupo** | Vários personagens enfrentam uma criatura; nome/vida do alvo, dano destacado, magia e chat comunicam o combate. | O servidor Caracatoa executa combate e movimento autoritativos. A HUD recebe resultados de habilidade, dano, cura e EXP; o Golem pode mover-se no mundo. | A sessão atual é solo: não há outros jogadores, grupo ou chat. Os resultados de combate ainda não têm efeitos 3D ligados ao alvo. |
| **3 — comparação de classes** | Quatro figuras aparecem juntas, em escala semelhante, cada uma com silhueta, pose, arma e armadura legíveis. | A tela de espaços mantém os quatro avatares pequenos. A tela de criação agora aproxima a câmera e alinha os quatro modelos grandes à esquerda do painel; a classe selecionada recebe destaque. | A composição agora segue a referência, mas os modelos ainda usam bases licenciadas com equipamento genérico e paletas Caracatoa. Couraças v1–v7 continuam rejeitadas e fora do jogo. |
| **4 — exploração e interface** | Campo aberto com criatura reconhecível, raio/efeito, chat, inventário e avisos de experiência/loot. | Bastião, Golem, inventário autoritativo, alvo e feedback textual de ações existem no cliente. | A variedade de regiões e criaturas é pequena; não há chat/loot na HUD nem efeito de habilidade posicionado no mundo. |
| **Todas — acabamento** | Pedra, tecido, metal e terreno têm valores distintos; detalhes, luz e sombras separam personagens, equipamento e cenário. | ADRs 0355/0357 definem materiais góticos e breakup pintado à mão; há estudos isolados de pedra, portão e materiais. | As texturas irregulares ainda não foram validadas como materiais da cidade ativa. Personagens, arquitetura, luz e sombras precisam de inspeção renderizada no cliente. |

## Lista priorizada e estado de aplicação

1. **Câmera e leitura do personagem — implementada e compilada; avaliação visual pendente.**
   As referências mantêm o avatar legível e ocupando uma parte clara da cena.
   No Caracatoa, V alterna entre Próxima, Clássica e Ampla; o scroll aproxima
   e afasta em passos de 0,9, limitado ao intervalo 4,6–16. A câmera acompanha
   o jogador, mira o torso e interpola o movimento. Falta conferir o resultado
   em pixels e ajustar distância/ângulo com o usuário; isto não aprova o modelo
   nem a etapa de gameplay.
2. **Composição das quatro classes — aplicada anteriormente.** A seleção mantém os
   quatro modelos pequenos. Ao abrir a criação, os quatro ficam maiores numa
   linha à esquerda, a câmera deixa espaço para o painel e a classe escolhida
   ganha escala e pose de destaque. Sair da criação restaura posições e escala
   de seleção. A aparência final das malhas ainda não foi aprovada.
3. **HUD e equipamento — parcialmente aplicados.** As referências distribuem
   status no alto, ações na base e equipamento numa janela própria; nas capturas
   atuais do Caracatoa, os painéis e textos ainda disputam a mesma área e algumas
   linhas ficam apertadas. Status do jogador e alvo,
   ações funcionais na barra inferior, painéis de detalhe exclusivos e grade de
   20 espaços por página existem. Faltam ícones próprios, boneco equipado,
   buffs, revisão do tamanho dos rótulos e acabamento visual conferido em pixels.
4. **Cidade, materiais e iluminação — lacuna visual.** Integrar a
   irregularidade pintada à mão na pedra/terreno ativos e conferir contraste,
   luz quente/fria e sombras no cliente. A amostra isolada não conta como
   material aprovado; não assumir sombras dinâmicas sem testar o renderer.
5. **Combate e estados de entidades — parcialmente aplicados.** A segunda
   referência mostra grupo, alvo, dano destacado, magia e chat. O servidor
   valida movimento, alvo, habilidade e resultado. O cliente agora diferencia o
   movimento da entidade local do movimento do Golem (`0x366`), atualiza a
   posição do monstro e mantém a sessão. Faltam grupo/outros jogadores, chat e
   impacto/efeitos 3D ligados às posições no mundo.
6. **Equipamento e progressão visual — parcialmente aplicados.** Os IDs e os
   dados autoritativos alimentam a mochila; ícones originais e representação
   das peças no avatar continuam pendentes. Não inventar atributo ou slot para
   preencher a janela.
7. **Exploração e feedback — pendente.** A quarta referência acrescenta campo
   aberto, criatura, efeito visível, chat, inventário e avisos de EXP/loot.
   Variar regiões, criaturas, vegetação,
   loot e atividades depois da revisão manual da Etapa 1.

## Aplicação desta revisão

A câmera de criação enquadra quatro classes grandes ao mesmo tempo na faixa
esquerda do canvas, sem passar por baixo do painel. Separadamente, a câmera de
gameplay passa a acompanhar o avatar com enquadramento de terceira pessoa, mais
baixo e próximo, mirando aproximadamente a altura do torso. V alterna entre
três presets e o scroll regula a distância com limites e interpolação. Ao sair
do mundo, a câmera retorna à visão geral. Os nomes e dados da classe selecionada continuam
controlados pela HUD; somente o avatar escolhido é ampliado e recebe a animação
existente. A linha dos quatro modelos e a aparência final das malhas ainda
precisam de revisão visual no cliente.

O deslocamento do avatar continua condicionado às coordenadas confirmadas pelo
servidor. O tween linear de uma casa agora dura 0,18 s, igual ao intervalo
entre pedidos enquanto WASD permanece pressionado; isso remove a lacuna fixa de
0,04 s que existia após cada tween de 0,14 s. Rejeição do servidor e soltura
das teclas continuam levando o avatar à animação ociosa. Não mudei a rotação
dos modelos porque a orientação frontal das quatro malhas ainda precisa de
inspeção renderizada antes de escolher o eixo de frente.

O teste local também revelou que o servidor envia `0x366` tanto para o jogador
quanto para monstros. Antes, o cliente encerrava a sessão quando recebia o
movimento do Golem `0xFA00` (64000), pois comparava todo pacote com o ID do
jogador. Agora atualiza o monstro conhecido, recalcula o alvo e ignora uma
entidade ainda não conhecida sem derrubar a sessão.

## Validação e limites

- Validação mais recente da prévia: **37/37** testes, incluindo três casos
  focais de movimento e os testes de câmera, HUD e cadastro.
- Build nativa Windows x64 com Defold/Bob 1.14.0 compilou e gerou bundle.
- A HUD nativa criou conta, autenticou com senha/PIN, criou personagem e entrou
  no mundo para TransKnight, Foema, BeastMaster e Huntress. Cada fluxo também
  recebeu movimento do Golem; nome, classe e posição foram conferidos no SQLite
  temporário.
- As sessões das quatro classes passaram movimento, habilidade e persistência
  sintéticos. Os testes usaram apenas o servidor Caracatoa em loopback e dados
  descartáveis.
- A bundle HTML5 atual reconheceu os dois engines WASM. A prévia isolada ativa
  em `http://127.0.0.1:58903/`, instância `6DB0AA`, respondeu HTTP 200 e aceitou
  o handshake local sem conta ou credenciais.
- Tentativa de captura pelo Computer Use falhou antes de abrir a prévia com
  `failed to write kernel assets` / caminho não encontrado. Build e cálculo do
  frustum verificam enquadramento planejado, não pixels, iluminação, qualidade
  final do modelo nem aprovação visual.

A Etapa 1 continua aguardando playtest e aprovação do usuário, conforme ADR
0347. Os novos modelos e materiais permanecem sem aprovação artística.

## Fila de trabalho solicitada — 28/10/2026

Esta é a ordem de execução. Cada fatia precisa passar pelos testes aplicáveis e
pela revisão da saída antes de avançar; a Etapa 1 permanece aberta até o
playtest manual.

1. **Câmera:** três enquadramentos em terceira pessoa e zoom pelo scroll —
   implementados e compilados; falta avaliação visual e teste manual dos
   controles.
2. **Movimentação:** revisar ritmo e resposta de WASD, orientação corporal e
   leitura da animação, preservando confirmação autoritativa do servidor. A
   duração da interpolação agora acompanha o intervalo de 0,18 s dos passos
   aceitos; direção corporal ainda requer prévia visual.
3. **Personagens:** diferenciar silhueta, proporção, cabelo, arma e armadura das
   quatro classes; novos modelos ficam em prévia isolada até avaliação.
4. **Arquitetura e texturas:** candidato v3 de pedra irregular ficou mais simples e orgânico; a diferença das bordas ainda supera a variação local (3,37/1,07 horizontal e 6,39/1,98 vertical), então não foi integrado. Pedra ativa, madeira, metal e terreno ainda exigem prévia renderizada e validação.
5. **Tipografia/HUD:** conferir contraste, margens, escala e recorte para manter
   texto dentro de molduras em diferentes tamanhos de viewport.
6. **Qualidade de cena:** revisar luz quente/fria, sombras suportadas pelo
   renderer, escala e repetição na câmera de gameplay.
7. **Modelos em MODELOS e gratuitos:** inventariar candidatos e licenças; criar
   prévia antes da integração. Disponibilidade do arquivo não prova permissão de
   redistribuição.
8. **Referência WYD:** registrar padrões verificados nas fontes públicas e nas
   imagens do usuário, separando fatos de 2003 de sistemas documentados em
   versões posteriores; aplicar princípios gerais ao mundo autoral Caracatoa.
9. **Autoteste:** combinar regressões focais, builds nativas e HTML5, sessão
   sintética em loopback e inspeção renderizada. Automação não substitui o gate
   manual da ADR 0347.
10. **Critério de pronto:** não avançar com falhas focais ou defeito visual
    grosseiro; registrar o que foi validado e o que depende de inspeção humana.
11. **Alvo da revisão:** 29/10/2026 às 08:00, America/Sao_Paulo. É um horário
    para revisar o progresso, não uma aprovação automática dos itens pendentes.

## Câmera — revalidação técnica em 28/10/2026

- Próxima (6,2), Clássica (9,2) e Ampla (13,4); V cicla os presets.
- Os presets também variam a inclinação (−0,19/−0,30/−0,43 rad); não são apenas
  três distâncias do mesmo ângulo.
- MOUSE_WHEEL_UP/DOWN aproxima e afasta em passos de 0,9, no intervalo 4,6–16.
  A câmera ajusta a altura para manter o foco perto do torso e suaviza a transição.
- Testes focais de câmera, composição, HUD e cadastro: **29/29**. Suíte
  `tools/preview`: **34/34**. Bundle HTML5: dois engines WASM reconhecidos;
  handshake local passou sem conta nem credenciais.
- Build Defold 1.14.0 Windows x64 passou. O harness nativo aprovou cadastro,
  login, PIN, criação de personagem, entrada no mundo, movimento e habilidade
  nas quatro classes, usando apenas servidor Caracatoa em loopback e dados
  sintéticos temporários.
- Prévia atual: `http://127.0.0.1:57945/`, instância `06B7CA`; contas e avanço
  são temporários e serão removidos quando o processo terminar.
- Limite visual: o Computer Use falhou ao iniciar (`failed to write kernel
  assets`, erro 3) e não há Chromium/Edge/Firefox de sistema para captura local.
  Build/testes não confirmam pixels nem sensação real de V/scroll. Inspeção e
  playtest manual continuam pendentes.
