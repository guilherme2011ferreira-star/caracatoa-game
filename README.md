# Caracatoa — prévia jogável e projeto aberto

Caracatoa é um MMORPG original em desenvolvimento: cliente 3D Defold, servidor autoritativo próprio em Node.js e sessão de teste local. Esta publicação é uma **pré-alfa** para testar no Windows; ainda não é um jogo completo nem um serviço online.

## Baixar e abrir o jogo

1. Baixe `Caracatoa-Playtest-Windows-HTML5-0.1.0.zip` na página [Releases](https://github.com/guilherme2011ferreira-star/caracatoa-game/releases/latest) e extraia a pasta inteira.
2. Instale Node.js **24.22.1** (ou outra versão 24.x) em [nodejs.org](https://nodejs.org/).
3. Dê duplo clique em `INICIAR-PREVIA.cmd`. A janela mostrará um endereço como `http://127.0.0.1:54321/`; abra-o no Edge ou Chrome **no mesmo computador**.
4. Crie uma conta de teste na tela inicial. O formulário pede ID, senha de 8 a 11 caracteres, confirmação e PIN de 4 a 6 dígitos. Entre, crie um personagem e teste a praça.
5. Para encerrar, volte à janela preta e pressione `Ctrl+C`. A conta e o progresso dessa prévia são temporários e apagados ao fechar.

A sessão abre apenas em `127.0.0.1`; seu irmão baixa e executa uma cópia no próprio computador. O endereço local não é um link de jogo hospedado na Internet. Não use senha que você usa em outros serviços.

### Controles atuais

- `W A S D`: mover; o servidor confirma cada passo.
- `V`: alternar os três enquadramentos de câmera em terceira pessoa.
- Roda do mouse: aproximar ou afastar a câmera.
- `1`, `2`, `3`: usar habilidade correspondente quando já estiver no mundo.
- Clique do mouse: interagir com os botões e elementos da interface.

## O que já foi implementado

Os itens abaixo têm testes automatizados locais; isso confirma regras e fluxos de código, não substitui o playtest visual:

- Cadastro, autenticação, PIN e persistência local em SQLite; seleção das classes TransKnight, Foema, BeastMaster e Huntress.
- Entrada no mapa inicial, movimento validado pelo servidor, câmera em terceira pessoa com três modos e zoom pela roda do mouse.
- Alvo, combate e habilidades iniciais, recursos HP/MP, experiência, níveis e distribuição de atributos.
- Inventário, equipamento, itens e drops; também há protótipos locais de montarias, troca e feira.
- Cliente WebAssembly para a prévia e servidor Caracatoa iniciado em sandbox isolado com dados temporários.
- Testes de protocolo e fixtures sintéticas executados em loopback, sem contas reais nem servidores de terceiros.

Validação local desta publicação: **283/283 testes automatizados passaram**; a bundle foi checada e servida por HTTP com WebAssembly `application/wasm`. O relatório e os limites estão em [`docs/reports/caracatoa-open-source-playtest-validation-20261028.md`](docs/reports/caracatoa-open-source-playtest-validation-20261028.md). Isso não substitui o teste manual.

## O que falta concluir

1. **Etapa 1 — primeiro personagem:** playtest manual de cadastro, login/PIN, escolha de classe e entrada no mundo; a etapa ainda aguarda aprovação do jogador.
2. **Apresentação:** revisar e melhorar silhuetas/animações de personagens e monstros, telhados/parede das estruturas, materiais, sombras, leitura e encaixe do texto. A versão atual ainda tem arte provisória e problemas visuais conhecidos.
3. **Cidade e combate:** validar sensação de movimento, câmera, colisões, ataque e retorno visual em uso real; expandir NPCs, atividades e conteúdo de jogo.
4. **Etapas seguintes:** progressão completa, variedade de itens, montarias e economia/social precisam de integração e aprovação jogável por etapas. Novos mapas, missões, PvP e guerras ainda não estão concluídos.
5. **Multijogador e operação:** esta publicação roda uma sessão local isolada. Não há servidor público de jogo, matchmaking nem infraestrutura de produção.

O roteiro e os critérios de cada etapa estão em [`docs/roadmap/etapas-de-gameplay-caracatoa.md`](docs/roadmap/etapas-de-gameplay-caracatoa.md); o estado técnico e as decisões estão em `docs/`.

## Rodar os testes e trabalhar no código

Requisitos: Windows 10/11, Node.js 24.22.1 e PowerShell. O jogo usa módulos nativos do Node, inclusive `node:sqlite`; não precisa instalar dependências npm.

Para rodar a suíte no clone do repositório:

```powershell
node tools/run-tests.mjs
```

No ZIP de playtest da página Releases, a bundle HTML5 fica em `release/html5`; ela pode ser conferida e servida com `node tools/preview/check-html5-bundle.mjs release/html5` e `node tools/preview/web-preview-server.mjs release/html5`. No clone, primeiro compile o cliente como abaixo. Se NPM estiver instalado, `npm test` executa a mesma suíte.

Para compilar o cliente a partir do código, instale Defold **1.14.0** e passe a pasta dessa instalação:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\work\caracatoa-defold-prototype\tools\build-defold-spike.ps1 `
  -DefoldRoot 'C:\caminho\para\Defold' `
  -OutputRoot 'build-publication' `
  -Platform wasm-web
$bundle = '.\work\caracatoa-defold-prototype\build-publication\bundle\Caracatoa 3D Preview'
node .\tools\preview\check-html5-bundle.mjs $bundle
node .\tools\preview\web-preview-server.mjs $bundle
```

O servidor imprime uma URL local para abrir no Edge/Chrome; pare com `Ctrl+C`. O script de build pode usar o JDK/Bob distribuído com Defold. Os recursos e fixtures de protocolo já versionados permitem compilar sem o checkout de referência externo. Para montar um cliente Windows, troque `wasm-web` por `x86_64-win32`.

## Licenças

O código original do Caracatoa usa MIT. Modelos, fonte e runtime mantêm suas licenças próprias; consulte [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) e `licenses/`. Os avisos do runtime Defold estão em `licenses/defold-1.14.0/`. Assets de origem/licença não verificada da pasta MODELOS do usuário não foram incluídos.
