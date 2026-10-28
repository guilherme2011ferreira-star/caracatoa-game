# ADR 0351 — Encerramento gracioso do servidor Caracatoa

- **Status:** Aceita e implementada em 27/10/2026.
- **Contexto:** O servidor abre dois listeners e bancos SQLite locais. Encerrar
  diretamente o processo pode cortar sessões de jogo sem aguardar handlers que
  já estejam persistindo estado, e os listeners não tinham uma rotina comum de
  fechamento por sinal do sistema operacional.

## Decisão

1. Tratar `SIGINT` e `SIGTERM` como pedidos de encerramento coordenado.
2. Parar de aceitar conexões, pausar entrada de dados nas sessões abertas e
   esperar a fila de pacotes já decodificados terminar antes de encerrar os
   sockets do jogo.
3. Dar até cinco segundos para as conexões fecharem; depois destruir os sockets
   restantes e aguardar seus eventos de fechamento para executar a limpeza de
   sessão, inclusive o encerramento de montarias em uso.
4. Fechar os bancos SQLite depois dos listeners e das sessões. Manter fechamento
   idempotente para o handler de saída do processo.
5. Em caso de falha no boot parcial, fechar listeners já iniciados e limpar a
   instância do listener de jogo antes de propagar o erro original.

## Consequências

- `SIGINT` sai com código 130 e `SIGTERM` com 143 depois de um fechamento
  limpo; falhas do procedimento usam código 1.
- O encerramento não é instantâneo: sessões têm uma janela curta para concluir
  operações e fechar. O timeout impede que sockets presos mantenham o processo
  aberto indefinidamente.
- A regra assume o servidor local de processo único e não fornece eleição,
  drenagem distribuída ou migração de sessões entre processos.

## Validação

`node --test --test-reporter=dot` passou com exit code 0 para os 51 arquivos de
teste `*.test.mjs` em `server/caracatoa`. O teste do listener abre uma conexão
em loopback, pede encerramento, confirma EOF remoto, evento de desconexão,
parada de aceitação e idempotência. A integração `server-restart.integration.test.mjs`
também percorre o servidor completo com conta, personagem e sessão no mundo:
em uma rodada encerra por `SIGINT`, reinicia e recupera conta/posição; depois
encerra por `SIGTERM` com o jogador conectado e confirma EOF e saída limpa.
Os códigos confirmados são 130 e 143, respectivamente, e os logs registram o
fechamento de listeners, sessões e bancos. O relay de teste usa IPC para chamar
os handlers de sinal dentro do processo filho; não simula a entrega de Ctrl+C
pelo console do Windows. O smoke
`node tools/smoke-native-world-start.mjs` passou em portas loopback efêmeras e
confirmou mapa nativo, Golem e inicialização dos listeners; esse smoke encerra
o processo filho ao fim e não é evidência de drenagem graciosa.

Uma execução manual anterior pelo console PowerShell iniciou o servidor em
`127.0.0.1:48745`/`127.0.0.1:48746` e recebeu Ctrl+C. Os logs confirmaram o
pedido `SIGINT` e o fechamento, mas o console da automação retornou código 1;
essa tentativa não confirma entrega/exit code do sinal do sistema operacional.
As duas rotas internas de encerramento, agora, são exercitadas pela integração
isolada do servidor em loopback.
