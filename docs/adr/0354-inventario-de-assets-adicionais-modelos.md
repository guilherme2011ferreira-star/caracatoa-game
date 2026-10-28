# ADR 0354 — Inventário e triagem dos assets adicionais de MODELOS

- **Status:** Aceita como registro de procedência e fila de revisão; nenhum asset novo foi integrado.
- **Data:** 27/10/2026.
- **Relacionado:** ADRs 0332, 0347 e 0352.

## Contexto

O usuário adicionou mais arquivos utilizáveis a
`pasta MODELOS fornecida pelo usuário` e pediu que o conteúdo fosse aproveitado e
registrado nas ADRs. A pasta é a fonte original e permanece fora do repositório.
Os arquivos recebidos não vêm todos com licença ou atribuição verificável; o
nome “free”, a extensão Unity e a presença de um modelo não provam autorização
de redistribuição.

## Decisão

1. Não mover, apagar, extrair em massa nem duplicar a pasta MODELOS para reduzir
   espaço. Usar apenas cópias de trabalho pequenas e necessárias a uma prévia,
   com procedência, hash e licença anotadas.
2. Liberar para avaliação isolada os pacotes cuja identidade e licença
   correspondem a uma página de origem verificável. Mesmo assim, avaliar
   aparência, formato e integração antes de incluir qualquer modelo no cliente.
3. Manter os itens sem licença rastreável como referência/local-only. Não
   integrar nem distribuir seus arquivos até encontrar a página ou o contrato
   de licença correspondente.
4. A malha `free_pack_male_base_mesh.obj` permanece sob o registro detalhado da
   ADR 0352; não é substituída pelos arquivos novos.

## Inventário observado

| Arquivo recebido | Uso candidato | Procedência/licença verificada | Estado Caracatoa |
|---|---|---|---|
| `free_pack_male_base_mesh.obj` | Corpo masculino | PolyOne Studio / Sketchfab, CC BY; ver ADR 0352 | Prévia isolada já registrada; não integrada |
| `pp_freefantasyrpgweapons_fbx_files.zip` | Armas para visualizar como itens/equipamentos | Nome e pacote correspondem à listagem Pure Poly de 26 armas, Extended Commercial License, $0 | Elegível para prévia de itens, após revisão visual; ainda não integrado |
| `stylized_npc_peasant_nolantfree_version.zip` | NPC civil, não boneco de classe | Corresponde à listagem Winged Boots Studio “Stylized NPC - Peasant Nolant”; Standard Use License gratuita para um projeto comercial, sujeita ao limite publicado de 2.000 vendas ou 20.000 visualizações | Candidato somente a prévia de NPC; licença e limites devem acompanhar qualquer uso |
| `pp_freefantasyrpgweapons_fbx_files.glb` | Modelo de arma | Não confirmado separadamente pela listagem do ZIP | Local-only até identificar conteúdo e licença específicos |
| `bar_patrons_outfits.glb` | Roupas/NPCs | Desconhecida; sem licença local identificada | Referência/local-only |
| `free_pack_human_skeleton.obj` | Corpo/rig humano | Desconhecida; arquivo MTL referenciado não foi fornecido junto do OBJ | Referência/local-only; não substituir os avatares de classe |
| `freeweappack.fbx`; `freeweappackue5.blend` | Armas | Desconhecida | Referência/local-only |
| `horse.obj` | Montaria cavalo | Desconhecida | Referência/local-only; sem integração |
| `longsword.zip` | Armas e texturas | Sem licença ou README localizado no pacote | Referência/local-only |
| `lowpolymedievaleuropestarter.zip` | Personagens/armaduras medievais | Sem licença ou README localizado no pacote | Referência visual/local-only; revisão de estilo pendente |
| `lowpolynature_essentials_2021330f1.unitypackage` | Vegetação/ambiente | Licença não confirmada nos metadados examinados | Referência/local-only |
| `mega_moduler_apartment_building_obj.zip` | Arquitetura modular | Sem licença ou README localizado no pacote | Referência/local-only |
| `obj_abandoned_mountain_surrounded_village.obj` | Aldeia/ambiente | Desconhecida; arquivo com cerca de 1,76 GB | Não importar nem duplicar enquanto a licença e necessidade não forem confirmadas |
| `obj_files.zip` | Coleção de modelos em arquivos aninhados | Desconhecida; sem licença consolidada encontrada | Não extrair em massa; referência/local-only |
| `pb_frontier_settlement.unitypackage`; `pb_sword_shield_inn.unitypackage`; `rpgpp_lt_101_20223.unitypackage`; `weapons_newbiepack_unity6.unitypackage` | Cenários e armas | Termos não confirmados nos pacotes recebidos | Referência/local-only |
| `people_freepack_rigsobj.zip` | Humanos OBJ/MTL | Sem licença ou README localizado no pacote | Referência/local-only; não substituir o elenco de classes |
| `source (1).zip`; `source.zip`; `szombie_gltf.zip`; `textures.zip` | Armas, castelo, zumbi e texturas | Procedência/licença não identificadas; `source.zip` tem cerca de 1,60 GB | Não extrair em massa nem integrar |

## Rechecagem do pacote de armas — 28/10/2026

Uma listagem sem extração de `pp_freefantasyrpgweapons_fbx_files.zip` retornou
26 FBX; o arquivo tem 1.651.181 bytes e SHA-256
`DAD951007B265D5B437D1FEB27CD703B4090AC7A06F937B78C45A69679C6197B`.
O arquivo separado `pp_freefantasyrpgweapons_fbx_files.glb` tem 9.068 bytes,
SHA-256 `7E85640586EAC05AE43516A92B6A25487AB20C633378E8D1B10F0F48B2B10FB6` e
contém um único nó/mesh chamado `PP_Theme_01_Arrow_001.fbx`, com um material.
Esse nome coincide com um dos FBX listados no ZIP, mas não provei igualdade da
geometria nem cadeia de conversão. Por isso, o GLB continua local-only; não foi
integrado nem distribuído. Nenhum arquivo foi extraído ou movido nesta auditoria.

Ainda não gerei uma prévia visual do GLB: não há Blender, Assimp, Chromium,
Edge ou Firefox de sistema disponível nesta máquina, e o Computer Use falhou ao
iniciar. A inspeção de estrutura binária não aprova silhueta, materiais, escala
ou qualidade no jogo. Próximo passo para este candidato: render isolado com
licença de origem preservada e avaliação antes de qualquer integração.

## Consequências e revisão visual

- A lista informa triagem, não certifica que todos os conteúdos internos foram
  inspecionados ou que o autor pretendeu a redistribuição em Caracatoa.
- Os dois candidatos com páginas correspondentes continuam condicionados à
  prévia visual. O guerreiro/núcleo de personagem deve manter a direção aprovada
  de MMORPG medieval gótico clássico; o NPC Peasant é um papel civil e não deve
  substituir TransKnight, Foema, BeastMaster ou Huntress.
- Assets sem licença rastreável não entram em builds do jogo nem no GitHub. Os
  arquivos de mais de 1 GB permanecem somente na pasta indicada pelo usuário,
  sem cópia de trabalho.
- A decisão de não integrar ainda é intencional: ADR 0332 exige prévia de
  modelos novos e o usuário pediu para revisar os modelos antes de colocá-los
  no jogo.

## Evidências de procedência

- Pure Poly, “Free Low Poly Fantasy RPG Weapons”: lista o pacote de arquivos
  FBX com 26 armas e Extended Commercial License gratuita:
  <https://pure-poly.artstation.com/store/p0zjk/free-low-poly-fantasy-rpg-weapons>.
- Winged Boots Studio, “Stylized NPC - Peasant Nolant”: mostra a variante
  gratuita, conteúdo do ZIP e Standard Use License:
  <https://www.artstation.com/marketplace/p/p06lV/stylized-npc-peasant-nolant>.
- A identidade/licença de cada arquivo não listado acima permanece pendente;
  verificação por semelhança de nome não basta para liberar esses itens.
