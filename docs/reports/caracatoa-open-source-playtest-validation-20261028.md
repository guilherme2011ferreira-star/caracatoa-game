# Validação do pacote de playtest aberto — 28/10/2026

Ambiente: Windows, Node.js v24.22.1. O bundle HTML5 foi compilado a partir do cliente Defold 1.14.0 e copiado para o pacote de distribuição.

## Testes automatizados

Comando executado na raiz do pacote:

```powershell
$env:TEMP = '<diretório de QA fora do checkout>'
$env:TMP = $env:TEMP
node tools/run-tests.mjs
```

Resultado: **283/283 testes passaram, sem falhas**. A suíte inclui contas e protocolo local, persistência e reinício, navegação, combate/progressão, inventário, câmera, controles, layout e registro HTTP no sandbox HTML5. Dados e portas usados nos testes foram sintéticos e temporários. `TEMP`/`TMP` foram apontados para um diretório de QA fora do checkout, como a política de backup exige; o conteúdo do pacote não depende desse caminho.

Verificação da bundle:

```powershell
node tools/preview/check-html5-bundle.mjs release/html5
```

Resultado: passou; dois engines WebAssembly encontrados, ponte local presente e cadastro sintético pelo `fetch` retornou HTTP 201.

## Inicialização do servidor e entrega HTTP

O comando `node tools/preview/web-preview-server.mjs release/html5` iniciou o cliente e o servidor Caracatoa temporário. Uma solicitação à página retornou HTTP 200; o arquivo `Caracatoa3DPreview.wasm` retornou HTTP 200 com `Content-Type: application/wasm` (2.889.375 bytes). O listener ficou no loopback. O processo foi encerrado ao final do smoke test. Na revalidação, a asserção de backup passou a conferir que o ID do pó de incubação não aparece em nenhum slot após restauração, permitindo que a tabela de loot reutilize o slot; o teste de reinício passou 2/2 e a suíte completa passou 283/283.


## Publicação

- Repositório público: https://github.com/guilherme2011ferreira-star/caracatoa-game
- Commit inicial: `2f669f1e26ff7600e86df674d5dbc4f436881f51`
- Release marcada como latest: https://github.com/guilherme2011ferreira-star/caracatoa-game/releases/tag/v0.1.0-playtest
- Download direto: https://github.com/guilherme2011ferreira-star/caracatoa-game/releases/latest/download/Caracatoa-Playtest-Windows-HTML5-0.1.0.zip
- Asset publicado: 94.693.512 bytes; SHA-256 `B6CC22771ED4B9157AC88042C5416C3D40B9D58B086A859C3FBBE286E1417B48`.
## O que estes resultados não provam

São testes de integração e automação, sem avaliação humana da aparência ou sensação do jogo. Cadastro clicado por um jogador, leitura das fontes e molduras, modelos/monstros, movimento e apresentação continuam aguardando playtest manual. A Etapa 1 não está aprovada; esta release é pré-alfa.
