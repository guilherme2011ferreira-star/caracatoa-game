# Etapa 3 — Drops e equipamento itemizado Caracatoa (26/10/2026)

## Resultado revisado

A base itemizada inclui raridades, pools de afixos, caps, loot tables, criação de instâncias, migração SQLite v13 e entrega idempotente. O servidor liga o Golem de Pedra ativo à tabela `field-common`, persiste UUID/raridade/nível/stats/afixos e envia os detalhes ao cliente próprio por `0x7F0A`. Instâncias válidas ocupam os seis slots de equipamento atuais.

A revalidação encontrou uma integração adicional já presente no código e nos testes: além de dano físico e defesa, stats-base e afixos de HP/MP máximo alteram os tetos autoritativos do personagem. Ao reduzir um teto, o servidor limita o recurso atual ao novo valor; equipar uma peça que aumente o teto não restaura automaticamente recursos.

## Evidência de código

- `item-affix-system.mjs` valida chance, raridade, quantidade de afixos, escala por nível e caps; valores aleatórios usam o gerador criptográfico do servidor, com injeção determinística apenas nos testes.
- `caracatoa-itemized-monster-loot.mjs` aceita apenas catálogo/monstro/loot configurados e delega a gravação transacional ao `PlayerAccountStore`.
- `wyd-727-item-equipment.mjs` reconstrói stats pela configuração, preserva UUID e agrega `physicalDamageFlat`, `physicalDefenseFlat`, `maxHpFlat` e `maxMpFlat` dentro dos hard caps.
- `game-listener.mjs` recalcula HP/MP máximos, limita recursos atuais e sincroniza a ficha alterada ao cliente.
- `caracatoa-itemized-monster-loot.test.mjs` cobre morte duplicada, migração v12→v15, afixos físicos e HP/MP; `player-account-store.test.mjs` cobre persistência/clamp dos recursos.
- A comparação dos arquivos autorais atuais com o worktree de publicação confirmou que o código do servidor (93 arquivos-fonte) e do cliente (207 arquivos-fonte filtrados) já está no `main` do GitHub. Este avanço corrige e publica o estado técnico/documental, sem duplicar arquivos de build.

## Verificação executada

| Comando/ação | Resultado |
| --- | --- |
| `node --test` em 39 arquivos `server/caracatoa/*.test.mjs` e `work/caracatoa-defold-prototype/tools/*.test.mjs` | **174/174 PASS** |
| Testes focalizados de loot itemizado, protocolo, equipamento e store | **38/38 PASS** |
| `node work/caracatoa-defold-prototype/tools/generate-caracatoa-items.mjs --check` | PASS |
| `node --check` em `item-affix-system.mjs`, `caracatoa-itemized-monster-loot.mjs` e `server.mjs` | PASS |
| `node tools/verify-local-session.mjs … --itemized-vitals` | Não iniciou: `EADDRINUSE` em `127.0.0.1:8289`; listener Node em uso preservado |

A suíte e o gerador são evidência local automatizada. Não houve sessão visual manual nem validação de drops após abate pela janela. A E2E de ataque/defesa de versão anterior usa peças sintéticas; a fixture separada cobre drop e claim. A revalidação de HP/MP comprova store/equipamento e código de sincronização, mas a E2E dedicada não pôde ser repetida nesta sessão por causa da porta ocupada.

## Limites

A etapa segue parcial. Apenas quatro grupos de atributos afetam o jogo: dano físico, defesa física, HP máximo e MP máximo. Os outros afixos continuam informativos. O único monstro vivo com loot itemizado é o Golem de Pedra; elite, boss, zonas perigosas, comércio, refinação, telemetria de farm e PvP ainda não estão completos. Não se afirma equilíbrio final.

A decisão atualizada fica nas ADRs [0313](../adr/0313-sistema-de-itens-afixos-e-drops-caracatoa.md) e [0314](../adr/0314-equipamento-de-itens-itemizados-caracatoa.md); a especificação está em [`etapa-3-itens-drops-caracatoa.md`](../technical/etapa-3-itens-drops-caracatoa.md).
