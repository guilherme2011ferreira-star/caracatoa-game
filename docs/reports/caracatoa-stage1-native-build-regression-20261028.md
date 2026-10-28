# Etapa 1 — build nativa e regressões do cliente

Data: 28/10/2026, 15:11 BRT
Escopo: revalidar a build Windows x64 do cliente Defold, os testes da prévia e
as sessões sintéticas das quatro classes contra o servidor Caracatoa local.

## Build reproduzível

A tentativa inicial de build no volume C: parou durante a geração de texturas
por falta de espaço livre (aproximadamente 0,01 GB disponível). O diretório
parcial produzido por essa tentativa foi movido para
`<pasta-de-build>\failed-partial`; não foi
apagado. A saída e o diretório temporário da nova build foram direcionados a D:.
Foi criado e verificado um junction ignorado pelo Git em
`work/caracatoa-defold-prototype/build-stage1-validation-on-d-20261028` para
`<pasta-de-build>`.

Comando executado na raiz do checkout:

```powershell
$env:TEMP='<pasta-de-build>\temp'
$env:TMP=$env:TEMP
.\work\caracatoa-defold-prototype\tools\build-defold-spike.ps1 `
  -DefoldRoot '<caminho-para-Defold-1.14.0>' `
  -OutputRoot 'build-stage1-validation-on-d-20261028' `
  -Platform 'x86_64-win32'
```

Resultado: build e bundle terminaram com código 0 usando Defold 1.14.0. O
executável tem 7.912.776 bytes e está em
`<pasta-de-build>\bundle\Caracatoa 3D Preview\Caracatoa3DPreview.exe`.
O script avisou que o harness externo de fixtures do cliente não estava
presente; por isso manteve os recursos de protocolo versionados. Bob também
avisou que não conseguiu limpar alguns diretórios temporários, sem impedir a
build.

## Regressões da prévia

```powershell
$tests = @(Get-ChildItem -LiteralPath '.\tools\preview' `
  -Filter '*.test.mjs' -File | ForEach-Object { $_.FullName })
node --test --test-reporter=spec $tests
```

Resultado: **49/49 testes passaram em 9 arquivos**. A suíte inclui cadastro
HTML5 até autenticação pelo listener local, layout da HUD, controles de câmera,
movimento, animações, modelos/materiais e antisserrilhado. São verificações
automatizadas; não inspecionam por completo a apresentação em pixels da build
nativa.

## Sessões do cliente nativo

```powershell
$exe = '<pasta-de-build>\bundle\Caracatoa 3D Preview\Caracatoa3DPreview.exe'
for ($classId = 0; $classId -le 3; $classId++) {
  node .\work\caracatoa-defold-prototype\tools\verify-local-session.mjs `
    $exe "--class=$classId" '--hud-input'
  if ($LASTEXITCODE -ne 0) { throw "Sessão da classe $classId falhou" }
}
```

Resultado: **4/4 sessões passaram** com contas, personagens, mapa e dados
temporários, somente em loopback. O harness percorreu a rota de entrada da HUD,
login/PIN, criação de personagem, movimento e habilidade com persistência. TK
causou 26 de dano, Foema 25 de dano mágico, BM 25 e HT 24 a alcance 5. Foema
também abateu o alvo de fixture e avançou ao nível 2. Nenhum dado de
autenticação foi registrado.

O harness de frames também passou:

```powershell
node .\work\caracatoa-defold-prototype\tools\verify-local-frame-loopback.mjs $exe
```

Resultado: o cliente recebeu três frames sintéticos, cobrindo fragmentação e
coalescência; rejeitou um checksum adulterado e fechou o socket. O runtime Lua
validou os builders/parsers. O único payload enviado foi o handshake; não houve
login nem uso de credenciais nesse cenário.

## Limites

Os testes verificam caminhos de código do cliente e respostas do servidor, mas
`--hud-input` é um harness sintético, não clique e digitação físicos. Ainda
faltam inspeção visual da build nativa e playtest/aprovação manual da Etapa 1,
conforme ADR 0347. A build não confirma a conta anteriormente relatada pelo
jogador. Nenhum servidor externo foi usado; não houve commit nem push.

O caminho legado `caminho legado do projeto (não disponível)`, a
ADR 0231 e o `BIG_PICKLE_HANDOFF.md` daquela pasta não existem neste checkout.
O arquivo `BIG_PICKLE_HANDOFF.md` na raiz `oi-caracatoa-stage4` é um handoff
histórico de Reborn of Kersef. Para o trabalho vigente, as referências são
`PROJECT.md`, ADRs 0347/0348 e `CARACATOA_HANDOFF.md`.
