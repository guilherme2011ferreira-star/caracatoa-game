# Relatório de implementação — Etapa 4: montarias

Data: 27/10/2026. As mudanças ligam catálogo, store, protocolo, listener e HUD;
não completam a representação 3D final.

## Entregue

- Contrato sintético `0x7F0C`/`0x7F0D`: incubar, alimentar, evoluir, selecionar,
  montar, desmontar e listar. O pedido tem 48 bytes de payload/52 bytes no
  frame. O snapshot leva cabeçalho 16 bytes e até vinte entradas de 84 bytes.
- Listener valida sessão/ID, usa dados autoritativos e sincroniza snapshot e
  consumo de material. O Equus tutorial é concedido uma vez por personagem.
- SQLite armazena o ciclo conforme ADR 0325. Montar aplica bônus no HP,
  ataque físico/mágico, defesa, velocidade e absorção. Tick ativo consome fome,
  depois vida, e remove os bônus ao morrer. Tempo offline não é cobrado.
- Novos inventários recebem `properties.stackCount` dos descritores do
  catálogo. Itens já semeados não recebem uma entrega retroativa.
- O Defold envia ações do HUD e mostra estado, requisito, material, fome, vida,
  evolução, bônus e resultado confirmado pelo servidor.
- A entidade 3D, esqueleto, pose montada, animações e FX por tier ainda não
  existem nesta fatia.

## Verificação

Em `server/caracatoa`:

```powershell
node --test caracatoa-mount-gameplay.test.mjs caracatoa-mount-protocol.test.mjs caracatoa-mount-store.test.mjs game-listener.test.mjs wyd-727-profile.test.mjs wyd-727-item-catalog.test.mjs player-account-store.test.mjs
```

Resultado: 47 passaram, 0 falharam. O teste integrado usa store temporária e
socket em `127.0.0.1`, com conta sintética. Ele valida login, lista de
personagem, entrada no mundo, ovo, incubação por poeira, seleção, montagem,
bônus de HP e delta do inventário.

Na raiz:

```powershell
node work/caracatoa-defold-prototype/tools/generate-caracatoa-items.mjs --check
git diff --check
node --check server/caracatoa/game-listener.mjs
node --check server/caracatoa/caracatoa-mount-store.mjs
node --check server/caracatoa/caracatoa-mount-protocol.mjs
node --check server/caracatoa/caracatoa-mount-gameplay.test.mjs
node --check server/caracatoa/player-account-store.mjs
node --check server/caracatoa/wyd-727-item-catalog.mjs
node --check server/caracatoa/server.mjs
node --check work/caracatoa-defold-prototype/tools/verify-local-session.mjs
```

Resultado: todos passaram. Não havia Lua, LuaJIT ou Defold CLI disponível no
PATH; o GUI script não foi compilado e a janela do jogo não foi validada
manualmente. Avisos e licenças da base foram preservados.

## Pendência

O painel funcional ainda não desenha uma montaria 3D nem anima o personagem
montando. Assim, a integração de dados passou em loopback, mas a apresentação
visual e o gameplay manual continuam sem validação. A Etapa 5 (refino e
progressão) é o próximo marco, seguida da entidade 3D de montaria.
