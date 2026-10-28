[CmdletBinding()]
param(
    [string]$BuildRoot = 'build-stage1-sandbox-validation',
    [switch]$ServerOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$repositoryRoot = (Resolve-Path (Join-Path $projectRoot '..\..')).Path
$serverRoot = Join-Path $repositoryRoot 'server\caracatoa'
$catalogSource = Join-Path $serverRoot 'data\catalogs'
$buildPath = if ([System.IO.Path]::IsPathRooted($BuildRoot)) {
    [System.IO.Path]::GetFullPath($BuildRoot)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $projectRoot $BuildRoot))
}
$clientPath = Join-Path $buildPath 'bundle\Caracatoa 3D Preview\Caracatoa3DPreview.exe'
if (-not (Test-Path -LiteralPath $clientPath -PathType Leaf)) {
    throw "Build isolada da Etapa 1 não encontrada: $clientPath. Compile com tools\build-defold-spike.ps1 -OutputRoot build-stage1-sandbox-validation."
}

$existingClient = @(Get-Process -Name 'Caracatoa3DPreview' -ErrorAction SilentlyContinue)
if (-not $ServerOnly -and $existingClient.Count -gt 0) {
    throw 'Feche a janela Caracatoa 3D Preview já aberta antes de iniciar o sandbox, para evitar dois clientes e conflito no arquivo de log.'
}

$node = (Get-Command node -ErrorAction Stop).Source
$nodeVersion = (& $node --version).Trim()
if ($nodeVersion -ne 'v24.22.1') {
    throw "O servidor Caracatoa requer Node.js v24.22.1; encontrado $nodeVersion."
}

function New-FreeLoopbackPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return [int]$listener.LocalEndpoint.Port
    } finally {
        $listener.Stop()
    }
}

function Test-LoopbackPort([int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        if (-not $task.Wait(500)) { return $false }
        return $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

$httpPort = New-FreeLoopbackPort
do { $gamePort = New-FreeLoopbackPort } while ($gamePort -eq $httpPort)
$sandboxRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('caracatoa-stage1-playtest-' + [guid]::NewGuid().ToString('N'))
$catalogPath = Join-Path $sandboxRoot 'catalogs'
$statePath = Join-Path $sandboxRoot 'state'
$stdoutPath = Join-Path $sandboxRoot 'server.stdout.log'
$stderrPath = Join-Path $sandboxRoot 'server.stderr.log'
$serverProcess = $null
$clientProcess = $null
$environmentNames = @(
    'CARACATOA_ADMIN_PASSWORD', 'CARACATOA_DATA_DIR', 'CARACATOA_STATE_DIR',
    'CARACATOA_PORT', 'CARACATOA_GAME_PORT', 'CARACATOA_GAME_ASSET_DIR',
    'CARACATOA_MONSTER_RESPAWN_MS', 'CARACATOA_START_X', 'CARACATOA_START_Y',
    'CARACATOA_SERVER_PORT', 'CARACATOA_REGISTRATION_PORT',
    'CARACATOA_TEST_PORT', 'CARACATOA_TEST_TRACE', 'CARACATOA_SESSION_TEST_MODE',
    'CARACATOA_SESSION_TEST_CLASS_ID', 'CARACATOA_SESSION_TEST_SKILL_ID',
    'CARACATOA_SESSION_TEST_ATTRIBUTE_ID', 'CARACATOA_SESSION_TEST_ITEMIZED_EQUIPMENT',
    'CARACATOA_SESSION_TEST_ITEMIZED_VITALS'
)
$originalEnvironment = @{}
foreach ($name in $environmentNames) {
    $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

try {
    New-Item -ItemType Directory -Path $catalogPath,$statePath -Force | Out-Null
    Get-ChildItem -LiteralPath $catalogSource -Filter '*.json' -File | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $catalogPath
    }

    $randomBytes = [byte[]]::new(32)
    $randomGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $randomGenerator.GetBytes($randomBytes)
        $temporaryAdminPassword = [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    } finally {
        $randomGenerator.Dispose()
        [Array]::Clear($randomBytes, 0, $randomBytes.Length)
    }

    $serverEnvironment = @{
        CARACATOA_ADMIN_PASSWORD = $temporaryAdminPassword
        CARACATOA_DATA_DIR = $catalogPath
        CARACATOA_STATE_DIR = $statePath
        CARACATOA_PORT = [string]$httpPort
        CARACATOA_GAME_PORT = [string]$gamePort
        CARACATOA_GAME_ASSET_DIR = $null
        CARACATOA_MONSTER_RESPAWN_MS = '60000'
        CARACATOA_START_X = '128'
        CARACATOA_START_Y = '128'
    }
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    foreach ($name in $serverEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $serverEnvironment[$name], 'Process')
    }
    try {
        $serverProcess = Start-Process -FilePath $node -ArgumentList 'server.mjs' -WorkingDirectory $serverRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    } finally {
        foreach ($name in $environmentNames) {
            [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process')
        }
    }
    $temporaryAdminPassword = $null
    $serverEnvironment['CARACATOA_ADMIN_PASSWORD'] = $null
    $serverEnvironment = $null

    $serverReady = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($serverProcess.HasExited) { break }
        if (Test-LoopbackPort $gamePort) {
            try {
                $response = Invoke-WebRequest -Uri "http://127.0.0.1:$httpPort/" -TimeoutSec 2 -UseBasicParsing
                if ([int]$response.StatusCode -eq 200 -and $response.Content.Contains('Caracatoa')) {
                    $serverReady = $true
                    break
                }
            } catch { }
        }
        Start-Sleep -Milliseconds 250
    }
    if (-not $serverReady) {
        $details = @()
        foreach ($log in @($stdoutPath, $stderrPath)) {
            if (Test-Path -LiteralPath $log) { $details += Get-Content -LiteralPath $log -Tail 20 }
        }
        throw "Servidor temporário não iniciou nas portas locais escolhidas. $($details -join ' ')"
    }

    Write-Host "Sandbox da Etapa 1 pronto: conta, personagens e posições ficam temporários e serão apagados quando o cliente fechar."
    Write-Host "Servidor de jogo: 127.0.0.1:$gamePort | Cadastro/painel: http://127.0.0.1:$httpPort"
    if ($ServerOnly) {
        Write-Host 'Validação do servidor isolado concluída; encerrando sem abrir o cliente.'
        return
    }
    Write-Host 'Crie a conta e o PIN dentro do cliente; nenhum dado de conta é pré-preenchido.'

    $clientEnvironment = @{
        CARACATOA_SERVER_PORT = [string]$gamePort
        CARACATOA_REGISTRATION_PORT = [string]$httpPort
    }
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    foreach ($name in $clientEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $clientEnvironment[$name], 'Process')
    }
    try {
        $clientProcess = Start-Process -FilePath $clientPath -WorkingDirectory (Split-Path $clientPath -Parent) -PassThru
    } finally {
        foreach ($name in $environmentNames) {
            [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process')
        }
    }
    Write-Host 'Feche a janela do jogo para encerrar e remover o sandbox temporário.'
    $clientProcess.WaitForExit()
    Write-Host "Cliente encerrado (código $($clientProcess.ExitCode))."
} finally {
    $temporaryAdminPassword = $null
    if ($serverEnvironment) {
        $serverEnvironment['CARACATOA_ADMIN_PASSWORD'] = $null
        $serverEnvironment = $null
    }
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
        try { $serverProcess.WaitForExit(5000) | Out-Null } catch { }
    }
    $temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $resolvedSandbox = [System.IO.Path]::GetFullPath($sandboxRoot)
    $leaf = Split-Path -Leaf $resolvedSandbox
    if ($resolvedSandbox.StartsWith($temporaryRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
        $leaf -match '^caracatoa-stage1-playtest-[0-9a-f]{32}$' -and
        (Test-Path -LiteralPath $resolvedSandbox)) {
        Remove-Item -LiteralPath $resolvedSandbox -Recurse -Force
    }
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process')
    }
}
