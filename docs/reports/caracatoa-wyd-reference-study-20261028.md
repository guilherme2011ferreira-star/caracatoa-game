# Estudo inicial da referência WYD para Caracatoa

Atualizado em 28/10/2026. Este registro transforma referências públicas e as
capturas enviadas pelo usuário em critérios de direção para o Caracatoa. Não é
uma história exaustiva do WYD nem uma especificação para reproduzi-lo.

## Evidência histórica e limites

- O perfil público da JoyImpact lista o beta fechado do WYD em junho de 2002,
  o beta aberto em agosto de 2002 e o serviço oficial pago em maio de 2003.
  O mesmo histórico registra que em agosto de 2004 o WYD foi reformulado como
  WYD II FC e passou a um modelo gratuito com serviço premium. Portanto, páginas
  atuais “Episode II” e “WYD2” não descrevem automaticamente o lançamento de
  2003. Fonte: [perfil da JoyImpact no Gamejob](https://www.gamejob.co.kr/Company/Detail?M=11525200).
- A entrevista de 2005 com o produtor da JoyImpact descreve WYD II: foco em
  combates coletivos, guerras de guilda/nações, controle de cidades, arrecadação
  de impostos, campos de acesso restrito e uma torre visível que evolui com as
  vitórias. Isso documenta decisões de WYD II em 2005, não prova que todos esses
  sistemas existiam em 2003. Fonte: [entrevista de WYD II no 4Gamer](https://www.4gamer.net/news/history/2005.11/20051104234008detail.html).
- O guia oficial atual de WYD Episode II mostra a continuidade de quatro classes,
  progressão guiada por quests, mestres de habilidade por classe, party play,
  refino e montarias. Os números de bônus, níveis, custos, itens e nomes são da
  versão/guias posteriores; não são importados para o balanceamento Caracatoa.
  Fonte: [guia WYD Episode II](https://www.wyd2.co.kr/guide/tip01.asp).

## O que as capturas do usuário comunicam

As quatro imagens fornecidas são evidência visual direta do alvo de leitura:

1. O personagem precisa ser a âncora da cena; equipamentos e montaria aparecem
   no próprio avatar, e barras/atalhos/inventário ocupam regiões distintas.
2. Combate ganha clareza quando nome e vida do alvo, personagens aliados, efeitos
   fortes e números de dano formam uma hierarquia visual rápida.
3. Classes se distinguem pela silhueta, proporção, arma, cabelo, armadura e cor;
   quatro variações da mesma figura não bastam.
4. Cidade e campo precisam de materiais identificáveis, irregularidade artesanal,
   luz localizada e referências de escala. Textura e iluminação simples devem
   continuar legíveis em câmera de jogo.

As imagens não autorizam copiar malhas, ícones, textos, nomes, símbolos ou
mapas. O Caracatoa mantém cenário, personagens, regras, UI e assets originais.

## Princípios a aplicar no Caracatoa

- **Leitura de MMORPG clássico:** câmera de gameplay com avatar claro no centro,
  cenário reconhecível e HUD encostada às bordas. A tarefa atual implementa três
  modos em terceira pessoa e zoom pelo scroll; composição, distância e conforto
  ainda precisam de playtest renderizado.
- **Identidade funcional de classe:** classe deve aparecer no modelo, na arma,
  na habilidade e no papel de combate, mantendo o mesmo ID em catálogo, cliente
  e servidor. A composição dos quatro modelos existe; silhuetas e equipamento
  ainda não estão aprovados.
- **Progressão que ensina:** organizar missões, itens e melhorias em pequenos
  objetivos que demonstrem a função de classe antes de exigir otimização. Novos
  sistemas só entram depois do gate de gameplay da ADR 0347.
- **Social visível quando chegar a sua etapa:** objetivos de guilda só terão
  valor se alterarem algo reconhecível no mundo — monumento, acesso, evento ou
  atividade — e o servidor persistir e validar o mesmo estado. Isto é princípio
  de design derivado da entrevista de WYD II, não uma feature já entregue.
- **Efeito subordinado ao resultado:** dano, cura, movimento de alvo, loot e
  equipamento devem aparecer depois de confirmação do servidor Caracatoa; efeitos
  3D ainda precisam ser ligados à posição das entidades.
- **Acabamento da época, autoria própria:** combinar silhuetas fortes, materiais
  pintados, placas assimétricas controladas, arcos e torres com variação irregular
  conforme a ADR 0357. Evitar reproduzir interface, logotipo ou elementos
  reconhecíveis do WYD.
- **Leveza com orçamento conhecido:** limitar geometria e efeitos por perfil e
  medir custo na máquina local antes de introduzir shaders, partículas, sombras
  ou assets pesados.

## Ordem prática usada

1. Câmera: V alterna Próxima (6,2), Clássica (9,2) e Ampla (13,4); scroll ajusta
   distância entre 4,6 e 16. Implementação e builds passaram; revisão em pixels
   e sensação real de controle continuam pendentes.
2. Movimento: revisar orientação, resposta de entrada e animação com validação
   do servidor.
3. Personagens: melhorar leitura de TransKnight, Foema, BeastMaster e Huntress
   em prévias isoladas, antes de integrar malhas novas.
4. Materiais/cidade: avaliar pedra, madeira, terreno e luz irregulares em escala
   de gameplay; verificar licença e custo dos arquivos da pasta MODELOS.
5. HUD: garantir campos, nomes e painéis dentro das molduras, com contraste,
   sombra e atalho legíveis.
6. Sistemas de grupo, montaria visual, mundo e guerras permanecem posteriores;
   não contam como conclusão da etapa atual.

As prioridades e testes de aceitação ficam em
[`analise-comparativa-referencias-gameplay.md`](../art/analise-comparativa-referencias-gameplay.md).

## Referências

- [JoyImpact — perfil e cronologia da empresa/WYD](https://www.gamejob.co.kr/Company/Detail?M=11525200), consultado em 28/10/2026.
- [4Gamer — entrevista com a equipe de WYD II, 04/11/2005](https://www.4gamer.net/news/history/2005.11/20051104234008detail.html), consultado em 28/10/2026.
- [WYD oficial — guia Episode II](https://www.wyd2.co.kr/guide/tip01.asp), consultado em 28/10/2026; usado apenas para padrões de progressão posteriores.
- Capturas de referência enviadas pelo usuário neste thread; análise visual em
  [`analise-comparativa-referencias-gameplay.md`](../art/analise-comparativa-referencias-gameplay.md).
