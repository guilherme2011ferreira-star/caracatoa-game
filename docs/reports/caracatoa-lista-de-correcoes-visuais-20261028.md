# Lista de correções visuais e de gameplay — 28/10/2026

Base: capturas do usuário e uma captura Defold HTML5 isolada a 1280×720. As
referências WYD guiam a leitura e a atmosfera; não são modelos a copiar.

| # | Problema visível | Correção aplicada nesta rodada | Estado e verificação |
|---|---|---|---|
| 1 | Bonecos com silhuetas simples e materiais chapados | Texturas pintadas de armadura já variam em 128×128; quatro clips de ataque agora articulam braços e tronco por classe | **Parcial.** As malhas Quaternius low-poly ainda são visíveis. O corpo-base masculino de MODELOS é estático e sem rig; não serve para substituir as quatro classes. |
| 2 | Casas lidas como paredes sem telhado | A malha da cidade fecha as duas águas até as eaves e inclui fachadas de empena, parede, janelas e madeira; telhas e pedra usam variação procedural v4 | **Geometria funcional presente.** A captura confirma paredes e telhados; a arquitetura ainda precisa de formas e acabamento mais ricos. |
| 3 | Golem parecia suspenso e sem textura | Golem alinhado ao plano da praça, com UV em 13 primitivas, 756 triângulos texturizados e dois mapas de pedra de 512×512 | **Parcial.** A captura mostra os pés junto ao piso e breakup visível; falta sombra de contato e a silhueta ainda é básica. |
| 4 | Movimento desconectado e sem orientação | Interpolação acompanha o ciclo autoritativo de 0,18 s; o boneco vira para a direção aceita | **Implementado tecnicamente.** Cadastro e quatro sessões locais validam o percurso; previsibilidade antes da resposta do servidor não foi adicionada. |
| 5 | Nenhuma ação legível ao atacar | Clips one-shot para TransKnight, Foema, BeastMaster e Huntress; o cliente os inicia após confirmação autoritativa | **Build e dados de animação validados.** O preview compila todos os clips; ainda falta captura renderizada do golpe em andamento. |
| 6 | Bordas serrilhadas | Janela Defold configurada com 4× MSAA | **Configurado e compilado** em Windows x64 e HTML5; qualidade/fps no computador do jogador não foram medidos. |
| 7 | Cena confusa e fonte bloqueando a vista central | Fonte movida para `[16.5, 6.7]`, à direita do caminho; navegação do servidor regenerada pelo mesmo layout | **Aplicado.** Testes confirmam passagem pela antiga posição e bloqueio no novo pedestal; captura mostra a rota central limpa. |

## Testes e limites

- A suíte de preview mais a navegação nativa passou **52/52**.
- A build Defold 1.14.0 Windows x64 e a build HTML5 passaram; o bundle contém
  dois engines WASM e o cadastro sintético HTTP retorna 201.
- O cliente nativo passou cadastro, login e PIN e sessões de TK, Foema,
  BeastMaster e Huntress com dados descartáveis e servidor Caracatoa em
  loopback. As quatro classes passaram movimento e ações autoritativas.
- A captura isolada confirma casas com telhados/paredes, Golem texturizado junto
  ao piso e a rota central sem a fonte. Ela não substitui o jogo completo nem
  aprova as malhas, o movimento, a animação em pixels, as sombras ou a HUD.
- Ainda não há clique real comprovado no HTML5: os probes headless enviam eventos
  ao canvas, mas a tela da HUD não troca. Esse limite é separado dos testes do
  cliente nativo.

Próxima prioridade visual: substituir ou remodelar as silhuetas das quatro
classes com malhas licenciadas e rig compatível; avaliar o Golem e os ataques
em movimento; acrescentar luz/sombra de contato; revisar a HUD com a câmera de
gameplay. Os arquivos sem licença da pasta `MODELOS` permanecem local-only.

### Atualização focal — 28/10, 13:09 BRT

O ataque esquelético agora retoma a intenção de caminhar/repousar ao terminar,
sem deslocar a raiz controlada pelo movimento autoritativo. Ver ADR 0357 e o
checkpoint de 13:09 em CARACATOA_HANDOFF.md: 11 cenários Lua, 49 testes de preview,
builds Windows/HTML5 e sessões nativas das quatro classes passaram. Esta rodada
não acrescenta aprovação visual dos modelos, sombras, HUD ou animação renderizada.
