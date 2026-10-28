# Etapa 1 — E2E nativo de cadastro, login e sessão

Data: 27/10/2026, 23:50 -03
Escopo: validar a versão atual do cliente Defold para Windows com o servidor
autoritativo Caracatoa, sem usar a base persistente ou contas reais.

## Build

Recompilei a fonte atual do cliente; `main/hud.gui_script` tinha timestamp
posterior aos builds nativos anteriores. Usei Defold/Bob 1.14.0, plataforma
`x86_64-win32`, um executor e `-Xmx512m`:

```powershell
$project = (Resolve-Path '.\work\caracatoa-defold-prototype').Path
$spike = '<pasta-de-build>'
$java = Join-Path $spike 'Defold\packages\jdk-25.0.4.1+1\bin\java.exe'
$bob = Join-Path $spike 'bob.jar'
$output = 'build-stage1-latest-native-e2e-20261027'
$common = @('-XX:ActiveProcessorCount=1','-Xmx512m','-jar',$bob,'--root',$project,'--platform','x86_64-win32','--max-cpu-threads','1','--output',(Join-Path $output 'build'))
Push-Location $project
try {
  & $java @common build --archive
  if ($LASTEXITCODE -ne 0) { throw "Defold build failed: $LASTEXITCODE" }
  & $java @common --bundle-output (Join-Path $output 'bundle') bundle
  if ($LASTEXITCODE -ne 0) { throw "Defold bundle failed: $LASTEXITCODE" }
} finally { Pop-Location }
```

Build e bundle terminaram com código 0. Bob avisou que não conseguiu limpar
dois diretórios temporários, mas gerou o executável de **7.912.776 bytes** em
`work/caracatoa-defold-prototype/build-stage1-latest-native-e2e-20261027/bundle/Caracatoa 3D Preview/Caracatoa3DPreview.exe`.

## Fluxo nativo de cadastro e login

```powershell
node .\work\caracatoa-defold-prototype\tools\verify-native-registration.mjs '.\work\caracatoa-defold-prototype\build-stage1-latest-native-e2e-20261027\bundle\Caracatoa 3D Preview\Caracatoa3DPreview.exe'
```

Resultado: passou. O harness iniciou `server.mjs` com banco e catálogos
temporários, e executou a lógica da HUD nativa para enviar o cadastro por HTTP,
autenticar a conta criada no listener de jogo, validar PIN e obter o roster
vazio. Os serviços usaram portas efêmeras de `127.0.0.1`; o harness removeu os
dados temporários ao encerrar. A saída não contém valores de autenticação.

## Sessões das quatro classes

```powershell
$exe = '.\work\caracatoa-defold-prototype\build-stage1-latest-native-e2e-20261027\bundle\Caracatoa 3D Preview\Caracatoa3DPreview.exe'
for ($classId = 0; $classId -le 3; $classId++) {
  node .\work\caracatoa-defold-prototype\tools\verify-local-session.mjs $exe "--class=$classId"
  if ($LASTEXITCODE -ne 0) { throw "Local session E2E failed for class ${classId}: $LASTEXITCODE" }
}
```

Resultado: **4/4 sessões passaram** com conta/personagem sintéticos e
armazenamento temporário:

- TransKnight: login/PIN, criação, movimento, mana, itemização inicial e Golpe
  da Forja; dano observado: 26.
- Foema: login/PIN, criação, movimento, abate e nível 2; Impacto Celeste causou
  25 de dano mágico, preservou a separação dos bônus físicos e persistiu a
  habilidade entre casts.
- BeastMaster: login/PIN, criação, movimento, mana e Garras de Cipó; dano: 25.
- Huntress: login/PIN, criação, movimento, mana e Flecha Perfurante a alcance
  5; dano: 24.

Os verificadores cobrem estados e respostas do servidor, inclusive movimento,
aprendizado e persistência específicos de cada sessão. Nenhuma conexão fora do
loopback foi aberta, nenhum dado de conta real foi usado ou impresso, e a base
persistente não recebeu cadastro.

## Limites e etapa

O teste de cadastro usa modo automatizado da HUD; confirma o caminho de código
do cliente nativo, mas não é um clique/digitação manual. Não confirma a conta
anterior relatada pelo usuário, nem prova tipografia, composição visual,
renderização da cidade ou sensação de gameplay. O teste das quatro classes é
sintético e não constitui aprovação de etapa. A Etapa 1 continua aguardando o
playtest manual conforme ADR 0347. Não houve mudança de protocolo ou de código
de produção nesta validação; não foi feito commit/push.
