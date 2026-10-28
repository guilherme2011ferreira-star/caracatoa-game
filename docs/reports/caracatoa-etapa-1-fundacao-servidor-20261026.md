# Etapa 1 — fundação do servidor Caracatoa (26/10/2026)

## Entrega

- SQLite de jogadores migra v14→v15 com banco por conta e guildas relacionais.
  As tabelas anteriores já guardam conta, personagem, atributos, habilidade,
  inventário, itemização e montaria.
- `CaracatoaFoundationStore` implementa consulta de banco, transferência
  transacional de ouro e pilhas comuns, criação de guilda com líder e consulta
  de guilda. `PlayerAccountStore` oferece wrappers com ID de conta normalizado.
  A transferência confere o ID contra o catálogo autoral para impedir que
  equipamentos sem instância sejam tratados como material empilhável.
- `docs/technical/etapa-1-servidor-caracatoa.md` documenta modelo, quadros,
  fases de sessão, carregamento/salvamento e limites.
- ADR 0326 registra as decisões de migração e propriedade dos dados.

## Verificação local

| Comando | Resultado |
| --- | --- |
| `node --check server/caracatoa/caracatoa-foundation-store.mjs` | passou |
| `node --test server/caracatoa/caracatoa-foundation-store.test.mjs` | 3/3 passaram |
| `node --test server/caracatoa/player-account-store.test.mjs` | 24/24 passaram |
| `node --test server/caracatoa/caracatoa-mount-store.test.mjs` | 3/3 passaram |
| `node --test server/caracatoa/caracatoa-itemized-monster-loot.test.mjs` | 8/8 passaram |
| `node --test server/caracatoa/protocol.test.mjs` | 6/6 passaram |
| `node --test server/caracatoa/wyd-727-profile.test.mjs` | 5/5 passaram |
| `node --test server/caracatoa/wyd-727-session-flow.test.mjs` | 7/7 passaram |
| `node --test server/caracatoa/game-listener.test.mjs` | 2/2 passaram |

Os testes usam bancos descartáveis e fixtures locais. O listener de produção
teve handshake/decodificação testados; a ordem de autenticação e entrada foi
validada por sessão sintética. Não foi executado teste manual de banco/guilda
pela UI, pois os comandos de cliente ainda não existem. O processo local
anterior à edição segue com a versão carregada em memória; a migração v15
ocorre quando essa instância for reiniciada.

## Limites da etapa

Banco e guildas são APIs internas. Não há exposição por opcode, UI de banco,
convites de guilda ou suporte a item individualizado dentro do banco. Os mapas,
drops, montarias jogáveis e refinamento pertencem às Etapas 2–5 e aguardam o
comando do usuário. Nenhum commit/push foi feito sem validação explícita,
conforme `AGENTS.md`.
