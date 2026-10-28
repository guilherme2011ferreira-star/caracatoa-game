# ADR 0353 — Prévia HTML5 local com servidor isolado

- **Status:** Aceita para playtest local da Etapa 1; publicação do pacote aberto regida pela ADR 0359.
- **Data:** 27/10/2026.
- **Relacionado:** ADRs 0347, 0349 e 0351.

## Contexto

O usuário quer abrir a prévia do cliente por um link no navegador. O cliente
Caracatoa é feito em Defold e sua versão Windows usa LuaSocket sobre TCP. No
HTML5 o Defold não oferece TCP/UDP de LuaSocket; a API `html5.run()` permite
chamar JavaScript pelo Lua. O bundle WebAssembly precisa ser servido por HTTP e
usar o MIME `application/wasm`; abrir o arquivo `index.html` diretamente não é
suficiente.

O login, cadastro, PIN, criação de personagem e entrada no mundo precisam
continuar usando o servidor autoritativo Caracatoa. A prévia não deve tocar os
dados nem encerrar o servidor persistente da máquina.

## Decisão

1. Compilar a mesma coleção Defold para o alvo `wasm-web`, sem criar um cliente
   de demonstração separado nem simular autenticação. O transporte, IDs,
   cabeçalhos e corpos de gameplay permanecem os do cliente Caracatoa.
2. Incluir no HTML gerado uma ponte JavaScript. O cliente chama a ponte por
   `html5.run()`: WebSocket binário transporta os frames de jogo e `fetch`
   same-origin envia o formulário de cadastro. Respostas de cadastro e frames
   recebidos voltam ao Lua em filas limitadas; os frames são decodificados pelo
   mesmo protocolo Lua usado no cliente Windows.
3. Executar `tools/preview/web-preview-server.mjs` somente em `127.0.0.1`. Ele
   serve os arquivos WebAssembly, encaminha o cadastro HTTP same-origin e
   retransmite os frames WebSocket binários para o listener TCP de um servidor
   Caracatoa temporário em loopback. No cliente Windows, o cadastro continua
   usando HTTP local do Lua; no navegador, usa `fetch`, pois LuaSocket HTTP não
   está disponível no alvo WebAssembly.
4. Iniciar o servidor temporário com cópia dos catálogos e diretório de estado
   descartável. Contas, PINs e personagens criados na sessão pertencem somente
   a esse sandbox; ao encerrar o processo da prévia, o servidor e o diretório
   temporário são removidos. A instância persistente em `8289/8765` não é usada
   nem modificada.
5. Restringir o WebSocket a uma origem local na mesma porta, aceitar apenas
   frames binários não fragmentados, limitar o tamanho de frames e não gravar
   corpos de cadastro ou pacotes em logs. A ponte é uma ferramenta de
   desenvolvimento local, não um gateway para hospedar o jogo publicamente.
6. Manter a validação manual da Etapa 1 pendente até o usuário testar a página,
   cadastro/login/PIN, seleção/criação de classe e entrada no Bastião. O build
   HTML5 e os testes de transporte não contam como aprovação de gameplay.

## Consequências

- O link local pode carregar o mesmo mundo e conversar com a autoridade de
  jogo sem depender de permissões de sockets TCP do navegador.
- O transporte adicional existe apenas no harness de prévia; nenhum serviço
  público, porta da rede local ou endpoint oficial é configurado.
- Navegador, WebAssembly e o canal local passam a ser uma superfície de teste
  além da build Windows; ainda será necessário verificar input e leitura visual
  no navegador do usuário.
- A sessão é descartável: parar a prévia também apaga as contas e personagens
  criados nela. O servidor fica ativo até a sessão ser encerrada pelo operador.

## Validação nesta revisão

- Defold/Bob `1.14.0` estável compilou e empacotou a bundle `wasm-web` em
  `work/caracatoa-defold-prototype/build-stage1-html5/`.
- `tools/preview/check-html5-bundle.mjs` confirmou os dois engines WebAssembly,
  a ponte presente e a sintaxe JavaScript válida.
- `node --test --test-reporter=spec tools/preview/web-preview-server.test.mjs`
  passou **3/3**: servir HTML/WASM com MIME correto, encaminhar cadastro e
  retransmitir frames binários para um listener TCP sintético.
- A prévia local iniciou o servidor Caracatoa isolado e respondeu HTTP 200 para
  a página e para o `.wasm` (`application/wasm`). O usuário ainda precisa fazer
  a inspeção visual e o playtest manual no navegador; não foi alegada aprovação.

## Correção do cadastro e tipografia — 27/10/2026

O primeiro relato do playtest apontou que “Criar conta” não concluía o cadastro
e que as fontes estavam apagadas e sem unidade visual. A origem técnica foi o
uso de `http.request` em Lua no alvo WebAssembly: o navegador não fornece a
camada LuaSocket necessária. A ponte passa a enviar o JSON por `fetch` same-
origin e devolver status/corpo à HUD por uma fila independente da conexão de
jogo. O envio e o retorno não escrevem formulário ou credenciais em logs.

As telas de login, cadastro, PIN, seleção de personagem e escolha de classe
passam a usar Cinzel, em tom marfim/bronze com contraste elevado, em vez da
fonte padrão pixelada em partes do fluxo. O `.font` usa a fonte Cinzel já
presente, sob SIL Open Font License.

Essa correção foi compilada em nova bundle, `build-stage1-html5-signup-fix`, com
Defold/Bob 1.14.0. O verificador executou a ponte com `fetch` sintético e
recebeu HTTP 201; os testes do gateway passaram 3/3. Um smoke test separado
confirmou HTTP 201 no proxy local usando conta descartável em sandbox, encerrado
e limpo após o teste. O preview atual está aberto em
`http://127.0.0.1:59680/`, com sandbox limpo para o playtest do usuário.

O fluxo visível de cadastro, login/PIN, criação de personagem e entrada no
Bastião ainda precisa ser clicado pelo usuário. A automação do navegador não
inicializou nesta sessão, então não foi feita inspeção visual da tipografia nem
dos estados de foco e erro.

## Referências técnicas

- Defold HTML5: <https://defold.com/manuals/html5/>.
- API `html5.run()` no Defold 1.14.0: <https://defold.com/ref/html5-lua/>.
- Limitações do LuaSocket no HTML5: <https://defold.com/ref/socket-lua/>.
- Bob e alvos WebAssembly: <https://defold.com/manuals/bob/>.

## Correção de interação após playtest — 27/10/2026

Após novo relato de que o botão “Criar conta” não avançava, encontrei campos
com nomes repetidos entre login e cadastro. `field_for` buscava só pelo nome e
podia atualizar o campo oculto da tela de login enquanto cadastro estava ativo.
A busca agora combina nome e tela atual. O clique do HUD usa hitboxes retangulares
explícitas, com pequena área de tolerância, sobre a arte estática. A build
`build-stage1-html5-registration-ui-fix` compila; verificador da bundle passou,
testes do gateway passaram 3/3 e a nova sessão local `60024` responde HTTP 200 e
aceita o handshake sintético. O usuário ainda precisa confirmar a abertura da
tela e a digitação real no navegador.

### Verificação do cadastro no servidor isolado — 27/10/2026

Adicionei `tools/preview/web-preview-registration.integration.test.mjs`. O
teste cria um servidor Caracatoa filho com catálogos e SQLite temporários,
envia um cadastro sintético pelo mesmo proxy HTML5, confirma HTTP 201 e que uma
segunda tentativa com o mesmo ID recebe HTTP 409. Também confirma três erros de
validação HTTP 400 e que a sexta tentativa no período recebe HTTP 429, conforme
a política de cinco tentativas por dez minutos. O sandbox é removido ao final;
o teste não acessa o preview de playtest nem o servidor persistente.

Validação: os testes de transporte e integração passaram **4/4**. A bundle
`build-stage1-html5-registration-ui-fix` passou a checagem HTML5; a prévia
`60024` respondeu HTTP 200 e completou o handshake sintético, sem enviar dados
de conta. Isso verifica o endpoint e o caminho de rede, mas não confirma o
clique visual em “Criar conta”; esse reteste manual permanece pendente.

### Formulário de cadastro após o relato do jogador — 27/10/2026

A captura do jogador mostra que o botão da tela inicial abre o formulário de
cadastro. A conta não foi criada porque senha, repetição da senha e PIN estavam
vazios; a validação aparecia apenas na linha de estado no rodapé, pequena demais
para deixar claro o próximo passo. O teste sintético anterior confirmou que o
proxy local e o armazenamento descartável criam uma conta com dados válidos.

Ampliei o painel de cadastro para 600×680, com camadas de ferro e bronze,
medalhões laterais, campos maiores e textos Cinzel ampliados. Uma placa dentro
do painel agora mostra a validação; ao enviar dados incompletos, o foco vai ao
primeiro campo que precisa de atenção. O envio é bloqueado enquanto aguarda a
resposta, e valores digitados são preservados quando o servidor rejeita uma
tentativa. O fluxo de sucesso ainda exige os quatro campos válidos: ID de 1–15
caracteres, senha de 8–11, confirmação igual e PIN de 4–6 dígitos.

A bundle nova foi compilada em
`work/caracatoa-defold-prototype/build-stage1-html5-registration-form-ux/`.
`check-html5-bundle.mjs` passou e os testes de transporte/cadastro isolado
passaram **4/4**. A prévia isolada abriu em `http://127.0.0.1:60536/`; o
handshake de jogo passou sem envio de conta ou credenciais. A inspeção manual
de aparência e do clique ainda depende do jogador; a automação da janela não
inicializou nesta máquina.

## Publicação para playtest aberto — 28/10/2026

O repositório e o ZIP de playtest podem ser publicados publicamente, conforme a ADR 0359. A publicação conserva a restrição técnica desta decisão: cada jogador executa localmente o mesmo servidor Caracatoa isolado, somente em 127.0.0.1, com dados temporários. Ela não transforma o harness em servidor de Internet nem habilita conexões externas.
