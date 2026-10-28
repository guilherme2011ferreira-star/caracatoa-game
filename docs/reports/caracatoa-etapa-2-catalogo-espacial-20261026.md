# Etapa 2 — catálogo espacial e spawns Caracatoa (26/10/2026)

## Entrega

- Criados Map_IDs autorais 001–010 em `server/caracatoa/data/world/maps.json`,
  cada um com limites, nível recomendado, entrada segura, áreas de caça,
  portais de dados, materiais arquitetônicos, clima, luz, névoa, vegetação e
  paleta.
- Criadas 20 linhas de spawn em `spawns.json` com nível, posição, raio,
  respawn, IA, tipo de ataque, tier e estado. O Golem de Pedra do mapa 001 é o
  único ativo; 19 criaturas aguardam terreno, modelos e regras de combate.
- `caracatoa-world-catalog.mjs` valida IDs, limites, zonas, portais e
  correspondência com monstros ativos. O servidor recusa uma coordenada inicial
  fora da zona segura e expõe ao listener a fronteira jogável do mapa 001.
- Documentação: ADR 0327, especificação da Etapa 2 e README do servidor.

## Verificação

| Comando | Resultado |
| --- | --- |
| `node --check server/caracatoa/server.mjs` | passou |
| `node --check server/caracatoa/game-listener.mjs` | passou |
| `node --test server/caracatoa/caracatoa-world-catalog.test.mjs` | 4/4 passaram |
| `node --test server/caracatoa/caracatoa-world-catalog.test.mjs server/caracatoa/game-listener.test.mjs server/caracatoa/wyd-727-world-commands.test.mjs` | 10/10 passaram |
| `node --test server/caracatoa/*.test.mjs` | 170/170 passaram no Windows/PowerShell (arquivo a arquivo) |

## Limites

Portais ainda não transportam personagens. As regiões 002–010 e 19 spawns não
são gameplay ativo porque o cliente não tem os respectivos terrenos/recursos e
o servidor ainda não persiste Map_ID nem sincroniza entidades por região.
Nenhuma taxa de drop foi atribuída nesta etapa; drops ficam para a Etapa 3.
Se uma instância de conteúdo apontar para um catálogo de monstros vazio, o
servidor mantém o painel disponível e suspende os spawns sem correspondente.
