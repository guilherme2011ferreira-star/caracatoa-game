# ADR 0357 — Texturas irregulares e personagens orgânicos

- **Status:** aceita como direção visual permanente; as texturas v4 e clips articulados de ataque estão no cliente, enquanto as silhuetas finais dos personagens e a revisão visual completa continuam pendentes.
- **Data:** 27/10/2026.
- **Relacionada:** ADRs 0332, 0350 e 0355.

## Contexto

O usuário rejeitou a textura em grade regular porque as linhas retas, a repetição
uniforme e a iluminação plana fazem o ambiente parecer feito de blocos. A nova
amostra de pedra irregular foi recebida como uma direção melhor. O padrão deve
se estender às superfícies, arquitetura e personagens, mantendo a atmosfera de
MMORPG coreano do início dos anos 2000 já definida na ADR 0355.

## Decisão

1. Adotar superfícies pintadas à mão, com resolução e breakup de cor compatíveis
   com jogos 3D do início dos anos 2000: variação tonal em manchas, desgaste,
   bordas imperfeitas e silhuetas de material não uniformes. A leitura deve
   sobreviver à distância normal de gameplay.
2. Evitar grades ortogonais, fileiras regulares de tijolos, cubos repetidos,
   formas perfeitamente quadradas, materiais planos e ruído fotográfico de alta
   frequência. Pedra, madeira, metal, couro e tecido precisam ter padrões e
   valores distintos.
3. Aplicar irregularidade controlada aos personagens: placas com recortes e
   sobreposições não idênticos, bordas gastas, costuras e tecidos em camadas,
   pequenas assimetrias de equipamento e variação pintada de material. Preservar
   anatomia legível, articulações funcionais e uma silhueta reconhecível para
   cada classe; imperfeição não significa deformidade aleatória.
4. Usar variação de luz e valor local para quebrar superfícies uniformes,
   equilibrando calor de tochas com preenchimento frio. Não declarar sombras
   dinâmicas como requisito até validá-las no renderer Defold 1.14.0; não gravar
   uma sombra direcional na textura albedo como substituta de iluminação.
5. Manter as primeiras amostras de pedra como histórico. O gerador procedural
   v4 em [`stone-organic-periodic-v1/`](../art/concept/stone-organic-periodic-v1/)
   fornece pedra, pavimento e telhas com bordas periódicas e variação de cor;
   sua integração é um avanço de textura, não aprovação de arte final.
6. Produzir e revisar cada novo material e personagem em prévia isolada,
   primeiro em close e depois na câmera de gameplay. Integrar somente após
   inspeção visual, respeitando a ADR 0332 e sem avançar automaticamente o gate
   de gameplay da ADR 0347.
7. Aplicar o gerador v4 aos materiais TownStone, TownTrim, TownShadow,
   TownCobble, TownRoofRed e TownRoofBlue da cidade. Os testes confirmam
   determinismo, diferenciação de sementes/tons e continuidade de borda. A
   captura isolada na Defold 1.14.0 confirma que pedra e telhas renderizam com
   variação visível; a composição completa, a repetição em gameplay e o
   desempenho ainda requerem revisão. As formas arquitetônicas continuam
   angulares e as malhas dos personagens não foram revisadas.
8. Gerar quatro clips compactos de ataque a partir do rig Quaternius CC0 que
   já acompanha as classes: corte do TransKnight, conjuração da Foema, golpe
   pesado do BeastMaster e disparo da Huntress. Cada ação toca uma vez por 0,52
   s, usa faixas de rotação em braços e tronco e só começa após a confirmação
   do servidor. Os clips deixam a animação mais legível sem trocar o esqueleto;
   não corrigem as proporções low-poly existentes nem substituem avaliação em
   movimento. A conclusão do golpe usa `model_animation_done`, retomando a
   última intenção de caminhar ou repousar. O controlador de animação não
   desloca nem gira o objeto raiz durante o golpe: essa transformação pertence
   ao controlador de movimento autoritativo. Quando parado, esse controlador
   pode orientar o personagem para o alvo confirmado. Isso evita que tweens
   cosméticos disputem a posição com os passos aceitos pelo servidor.
9. Manter a fonte da praça fora do caminho de entrada. A revisão visual mostrou
   que ela ocupava o centro da rota e o primeiro plano da câmera; mover o marco
   para o lado direito da praça exige atualizar a zona bloqueada da navegação do
   servidor a partir do mesmo layout, para que a geometria visível e o mapa
   caminhável continuem alinhados.

## Consequências

- A linguagem visual ganha irregularidade e breakup sem perder leitura de classe,
  função ou materiais.
- A versão v4 está aplicada às texturas da cidade e supera as amostras iniciais
  na variação pintada e na continuidade; não resolve por si só as formas
  arquitetônicas rígidas nem a qualidade dos personagens.
- A checagem numérica de emendas pode reprovar cortes óbvios, mas não mede
  qualidade estética, repetição perceptual nem adequação da escala no mundo.
- As meshes e texturas atuais não são aprovadas retroativamente. A direção será
  aplicada aos próximos estudos e correções, uma peça de cada vez.
- Os ataques agora têm movimentos articulados diferentes por classe e a rota
  central fica livre da fonte; a forma dos quatro bonecos, as sombras do mundo,
  a composição da HUD e a inspeção em resolução de jogo permanecem em aberto.
