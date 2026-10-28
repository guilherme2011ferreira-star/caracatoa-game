# ADR 0358 — Backup e restauração isolada do estado local

- **Status:** aceita e implementada em 28/10/2026.
- **Relacionada:** ADRs 0324, 0351, 0353 e 0356.

## Contexto

O servidor local persiste dados em dois bancos SQLite, arquivos JSON de conta e
auditoria e catálogos JSON/SQL. Copiar bancos em modo WAL como arquivos comuns
pode omitir transações confirmadas que ainda estejam no WAL. Uma restauração
direta sobre o diretório corrente também poderia substituir contas e progresso
sem uma inspeção prévia.

## Decisão

1. Manter um utilitário Node.js sem dependências externas para criar um snapshot
   do estado e catálogos Caracatoa. A cópia de cada banco usa a API pública de
   backup de `node:sqlite`, consolida o resultado em journal mode `DELETE` e
   verifica `PRAGMA quick_check`. O snapshot inclui hashes SHA-256, tamanhos e
   caminhos relativos num manifesto versionado.
2. Exigir que o servidor esteja parado antes de criar um backup. A API SQLite
   oferece consistência por banco, mas não coordena uma fotografia atômica
   entre os dois bancos, os JSON e os catálogos.
3. Aceitar somente os arquivos de estado conhecidos e arquivos de catálogo
   JSON/SQL no primeiro nível; exigir os dois bancos e o conjunto atual de
   catálogos. Recusar links simbólicos, arquivos desconhecidos e destinos
   existentes.
4. Restaurar somente para uma pasta nova fora do checkout e da pasta de backup.
   Antes de copiar, conferir formato, caminhos permitidos, estrutura exata,
   tamanho, hash e integridade SQLite. Criar o resultado numa pasta de staging
   e renomeá-la para o destino ao final; nunca substituir o estado corrente.
   Validar também a sintaxe de cada JSON e de cada linha da auditoria JSONL,
   tanto na criação quanto na leitura do backup. Hash correto não torna um
   arquivo truncado legível pelo servidor. Erros mostram somente arquivo e
   número da linha, sem conteúdo de contas ou auditoria. Esta checagem não
   substitui validação semântica dos catálogos ou migração de schema.
5. Não executar automaticamente backup nem restauração no boot. Arquivos
   contêm hashes de senha/PIN e histórico de auditoria em dados locais; ficam
   sem criptografia fornecida pelo utilitário. Guardar a pasta em volume
   protegido e fora do repositório, sem anexá-la a issues ou commits.

## Consequências

- Há um caminho reproduzível para capturar e inspecionar uma cópia completa do
  estado antes de testar mudanças ou recuperar uma pasta separada.
- O requisito de desligamento evita um conjunto inconsistente entre SQLite,
  JSON e catálogos; não há backup quente coordenado entre esses armazenamentos.
- A validação de hashes detecta corrupção ou alteração após a criação, mas não
  autentica a origem do manifesto. O backup não é criptografado nem enviado a
  armazenamento externo.
- Uma restauração validada ainda precisa ser iniciada explicitamente com
  `CARACATOA_STATE_DIR` e `CARACATOA_DATA_DIR` apontando para as novas pastas.

## Implementação e validação

O CLI está em `server/caracatoa/local-state-backup.mjs`; o procedimento está
documentado no README do servidor. Os testes usam bases, hashes, auditoria e
catálogos descartáveis em diretórios temporários. Eles cobrem captura de WAL,
restauração preservando o snapshot original, arquivo adulterado, path traversal,
destino existente, hierarquia dentro da origem e catálogo obrigatório ausente.
O teste de reinício do servidor cria e restaura um backup, inicia uma segunda
instância com as pastas restauradas e confirma cadastro duplicado (409), login,
PIN, personagem, posição, atributos alocados e habilidade aprendida pelo
protocolo local. A segunda entrada no mundo precisa publicar os snapshots de
atributos, skills e equipamento persistidos, não apenas preservar as linhas no
SQLite. O teste também equipa a lâmina do inventário inicial e verifica o bônus
de dano no pacote do mundo após restaurar. Os cenários de JSON inválido cobrem
arquivos de conta, catálogos e auditoria tanto ao criar quanto ao restaurar.

A continuação do mesmo ciclo usa uma cópia temporária do catálogo de itemização
para garantir Ração de Campo no abate do Golem, sem alterar os catálogos do
projeto. O teste confere `0x182`, EXP no `0x338`, avanço de nível, pontos e dano
derivado, depois cria o backup. A verificação posterior de moderação revive o
Golem antes do backup; a segunda instância recebe o monstro vivo e o snapshot
de progressão `0x7F02`, mantendo a ração na mesma pilha. Assim, a restauração é
observada pela sessão de gameplay e não só pelas linhas do SQLite.

A implementação usa `backup()` e `DatabaseSync` da
[API SQLite do Node.js 24](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html).

Na entrada do mundo, o servidor também publica `0x7F02` com o nível/EXP
restaurados. O roteador sintético do cliente Defold valida esse snapshot inicial
antes do de atributos e o teste de sessão exige o marcador de consumo do cliente;
isso detectou e fechou uma lacuna em que o teste do cliente rejeitava um pacote
assíncrono válido. A validação nativa cobre cadastro, login, PIN, criação,
entrada e snapshot inicial nas quatro classes, além do fluxo Foema de abate,
nível 2, ponto de atributo/habilidade e segundo cast. Esses testes usam somente
contas temporárias e loopback; não atestam aparência renderizada nem playtest
manual.

O ciclo de backup/reinício também exerce a montaria tutorial pelo protocolo
Caracatoa: entra um único ovo Equus, `0x7F0C` consome a Poeira de Oriharucon do
slot 2 e o transforma em montaria jovem, e outra ação seleciona a mesma
instância. Após backup, restauração em diretório novo e nova entrada, `0x7F0D`
confirma o UUID e os estados jovem/ativo, sem duplicar a recompensa; `0x114`
confirma que a poeira continua consumida. Este cenário não monta a criatura;
a sessão de montaria continua coberta pelos testes de gameplay próprios. Este
cenário complementa esses testes e não substitui avaliação visual da
representação 3D.

O mesmo ciclo também autentica um admin sintético no painel local enquanto o
jogador está no mundo e ressuscita o Golem abatido. O backup/restauração precisa
trazer o Golem vivo com HP máximo e preservar os registros `requested/applied`
da ressurreição. Já na instância restaurada, o admin abate o monstro; o teste
confirma a resposta da API, a morte no `0x338` do cliente e os registros
`requested/applied` correspondentes no JSONL. Assim, o teste distingue estado e
auditoria realmente restaurados das novas alterações feitas depois do restore;
não revisa a interface do painel nem substitui avaliação manual.

Um segundo cenário do servidor real cria um anúncio de armadura itemizada com
vendedor e comprador sintéticos. O vendedor desconecta, o servidor encerra, e
backup/restauração levam o anúncio ativo e os dados completos da instância do
item para o segundo processo. O comprador lista e adquire o item pelo protocolo
Caracatoa; `0x7F23` confirma o recibo e os deltas `0x182` atualizam a mochila.
Um terceiro processo recebe a repetição do mesmo `requestId` de compra após
login; devolve o recibo já registrado e reapresenta o item sem duplicar a
transação. Depois de encerrar o terceiro processo, a reabertura do SQLite
confirma o débito/crédito de gold, o mesmo UUID, raridade e afixo no comprador,
remoção do item do vendedor, anúncio vendido, uma única receipt e apenas a
auditoria `listed/purchased/sold`. O teste prepara contas e saldo sintéticos
diretamente no banco, portanto verifica a feira e a transação depois da
inicialização, não o cadastro HTTP nem a interface visual.

Validação focal após essa integração: `server-restart.integration.test.mjs`
passou 2/2 e a suíte de listener, backup, contas/admin, progressão, loot,
montarias, feira e troca passou 81/81. A segunda tentativa usa o mesmo
`requestId` em um processo novo e confirma que o cliente recebe o recibo/item
já persistidos sem uma segunda transação. Os testes executam somente com dados
sintéticos e loopback; o playtest visual da Etapa 1 continua pendente.
