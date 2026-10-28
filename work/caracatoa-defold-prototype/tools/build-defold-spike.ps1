[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$DefoldRoot,
    [string]$OutputRoot,
    [ValidateSet('x86_64-win32','wasm-web')][string]$Platform = 'x86_64-win32'
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$defoldRoot = (Resolve-Path $DefoldRoot).Path
$node = (Get-Command node -ErrorAction Stop).Source
$java = Join-Path $defoldRoot 'packages\jdk-25.0.4.1+1\bin\java.exe'
$bob = Join-Path $defoldRoot 'packages\bob.jar'
if (-not (Test-Path -LiteralPath $bob)) { $bob = Join-Path (Split-Path $defoldRoot -Parent) 'bob.jar' }
if (-not (Test-Path -LiteralPath $java)) { throw "JDK 25 local do Defold não encontrado: $java" }
if (-not (Test-Path -LiteralPath $bob)) { throw "bob.jar não encontrado ao lado da distribuição Defold: $bob" }
$outputRootRelative = '.'
if (-not [string]::IsNullOrWhiteSpace($OutputRoot)) {
    if ([System.IO.Path]::IsPathRooted($OutputRoot)) {
        throw 'OutputRoot precisa ser relativo à raiz do projeto Defold. Use uma junção local para redirecionar o destino a outro volume.'
    }
    $outputRootRelative = $OutputRoot.Trim().Trim('\','/')
    $segments = $outputRootRelative -split '[\\/]'
    if ([string]::IsNullOrWhiteSpace($outputRootRelative) -or $segments -contains '..') {
        throw 'OutputRoot precisa nomear um diretório relativo dentro do projeto Defold.'
    }
}
$buildOutputRelative = Join-Path $outputRootRelative 'build'
$bundleOutputRelative = Join-Path $outputRootRelative 'bundle'
$buildOutput = Join-Path $projectRoot $buildOutputRelative
$bundleOutput = Join-Path $projectRoot $bundleOutputRelative
$clientHarness = Join-Path $projectRoot '..\client-references\wydbot-parser-harness'
$sessionFixtureScript = Join-Path $clientHarness 'verify-session-packet-fixtures.mjs'
$sessionLoader = Join-Path $clientHarness 'loader.mjs'
$sessionFixtureData = Join-Path $clientHarness 'fixtures\wyd727-session-requests.synthetic.json'
$hasSessionHarness = (Test-Path -LiteralPath $sessionFixtureScript) -and
    (Test-Path -LiteralPath $sessionLoader) -and
    (Test-Path -LiteralPath $sessionFixtureData)
$sessionLoaderUrl = $null
if ($hasSessionHarness) { $sessionLoaderUrl = ([Uri]::new((Resolve-Path -LiteralPath $sessionLoader).Path)).AbsoluteUri }
New-Item -ItemType Directory -Force -Path $buildOutput,$bundleOutput | Out-Null
$common = @('-XX:ActiveProcessorCount=1','-Xmx512m','-jar',$bob,'--root',$projectRoot,'--platform',$Platform,'--max-cpu-threads','1','--output',$buildOutputRelative)
Push-Location $projectRoot
try {
    if ($hasSessionHarness) {
        & $node '--disable-warning=ExperimentalWarning' '--experimental-transform-types' '--experimental-loader' $sessionLoaderUrl $sessionFixtureScript '--write-fixtures'
        if ($LASTEXITCODE -ne 0) { throw "Fixtures de sessão sintéticas falharam com exit code $LASTEXITCODE" }
    } else {
        Write-Warning 'Harness de fixtures de sessão ausente; build visual seguirá sem regenerar esses fixtures.'
    }
    & $node 'tools/generate-caracatoa-skills.mjs'
    if ($LASTEXITCODE -ne 0) { throw "Geração de metadados de habilidades Caracatoa falhou com exit code $LASTEXITCODE" }
    & $node 'tools/generate-caracatoa-items.mjs'
    if ($LASTEXITCODE -ne 0) { throw "Geração de metadados de itens Caracatoa falhou com exit code $LASTEXITCODE" }
    & $node 'tools/integrate-gothic-gate.mjs'
    if ($LASTEXITCODE -ne 0) { throw "Integração do modelo aprovado Portão Astral falhou com exit code $LASTEXITCODE" }
    & $node 'tools/generate-caracatoa-town.mjs'
    if ($LASTEXITCODE -ne 0) { throw "Geração da cidade inicial 3D Caracatoa falhou com exit code $LASTEXITCODE" }
    & $node 'tools/generate-caracatoa-stone-monster.mjs'
    if ($LASTEXITCODE -ne 0) { throw "Texturização do Golem de Pedra Caracatoa falhou com exit code $LASTEXITCODE" }
    & $node 'tools/generate-caracatoa-altar.mjs'
    if ($LASTEXITCODE -ne 0) { throw "Geração do salão de criação Caracatoa falhou com exit code $LASTEXITCODE" }
    & $node 'tools/generate-caracatoa-class-gear.mjs'
    if ($LASTEXITCODE -ne 0) { throw "Geração de rostos, armaduras e armas das classes Caracatoa falhou com exit code $LASTEXITCODE" }
    & $node 'tools/generate-caracatoa-attack-animations.mjs'
    if ($LASTEXITCODE -ne 0) { throw "Geração das animações articuladas de combate Caracatoa falhou com exit code $LASTEXITCODE" }
    if ($hasSessionHarness) {
        & $node 'tools/generate-protocol-resources.mjs'
        if ($LASTEXITCODE -ne 0) { throw "Geração dos recursos de protocolo falhou com exit code $LASTEXITCODE" }
    } else {
        Write-Warning 'Recursos de protocolo mantidos como versionados porque o harness externo não está neste checkout.'
    }
    & $node 'tools/trim-caracatoa-class-assets.mjs' '--check'
    if ($LASTEXITCODE -ne 0) { throw "Verificação dos modelos 3D de personagem falhou com exit code $LASTEXITCODE" }
    & $java @common build --archive
    if ($LASTEXITCODE -ne 0) { throw "Bob build falhou com exit code $LASTEXITCODE" }
    & $java @common --bundle-output $bundleOutputRelative bundle
    if ($LASTEXITCODE -ne 0) { throw "Bob bundle falhou com exit code $LASTEXITCODE" }
    if ($Platform -eq 'wasm-web') {
        $htmlEntry = Get-ChildItem -LiteralPath $bundleOutput -Filter 'index.html' -File -Recurse | Select-Object -First 1
        if (-not $htmlEntry) { throw "Bob não gerou index.html HTML5 em $bundleOutput" }
        & $node 'tools/inject-caracatoa-html5-bridge.mjs' $htmlEntry.Directory.FullName
        if ($LASTEXITCODE -ne 0) { throw "Injeção da ponte de rede HTML5 falhou com exit code $LASTEXITCODE" }
    }
} finally {
    Pop-Location
}
Get-ChildItem -LiteralPath $bundleOutput -File -Recurse | Select-Object FullName,Length
