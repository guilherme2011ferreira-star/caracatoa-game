# Servidor local Caracatoa

Servidor autoritativo do protótipo. Requer Node.js 24.x; usa somente módulos nativos, incluindo `node:sqlite`.

## Testar com o cliente

Na raiz do repositório, execute `INICIAR-PREVIA.cmd` ou `npm run preview`. O launcher cria uma sessão isolada com estado temporário, vincula os listeners a `127.0.0.1` e remove contas, PINs e personagens ao encerrar com `Ctrl+C`.

## Iniciar o servidor diretamente para desenvolvimento

`node server/caracatoa/server.mjs` inicia os endpoints locais. Por padrão, o painel HTTP usa a porta 8765 e o protocolo do jogo usa 8289. Os dados persistentes ficam em `data/state/`; escolha esse modo somente se quiser conservar estado entre reinicializações. Variáveis `CARACATOA_PORT`, `CARACATOA_GAME_PORT`, `CARACATOA_DATA_DIR` e `CARACATOA_STATE_DIR` permitem apontar portas/diretórios locais. Não exponha os listeners na rede.

## Verificações

```powershell
npm run test:server
```

Os testes criam contas, dados e listeners sintéticos em diretórios/portas temporários de loopback. Consulte `docs/adr/` para decisões de arquitetura e `docs/roadmap/` para etapas e aprovação manual.

## Avisos

A licença do código original está na raiz do repositório. A lógica de navegação derivada de WYDBot MIT mantém atribuição em `THIRD_PARTY_NOTICES.md`. O código de referência não está incluso.
