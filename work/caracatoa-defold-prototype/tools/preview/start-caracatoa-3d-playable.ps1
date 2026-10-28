[CmdletBinding()]
param(
    [string]$BuildRoot = (Join-Path $PSScriptRoot '..\..\build-current-local-validation')
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$repositoryRoot = (Resolve-Path (Join-Path $projectRoot '..\..')).Path
$serverRoot = Join-Path $repositoryRoot 'server\caracatoa'
$serverStateRoot = Join-Path $serverRoot 'data\state'
$previewCandidates = @(
    (Join-Path $BuildRoot 'bundle\Caracatoa 3D Preview\Caracatoa3DPreview.exe'),
    (Join-Path $projectRoot 'bundle\Caracatoa 3D Preview\Caracatoa3DPreview.exe'),
    (Join-Path $projectRoot 'build-portao-astral-validation-final\bundle\Caracatoa 3D Preview\Caracatoa3DPreview.exe'),
    (Join-Path $projectRoot 'build-portao-astral-validation\bundle\Caracatoa 3D Preview\Caracatoa3DPreview.exe')
)
$preview = $previewCandidates |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    ForEach-Object { Get-Item -LiteralPath $_ } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $preview) {
    throw 'Build Caracatoa ausente. Compile com tools\build-defold-spike.ps1 antes de abrir a prévia.'
}

function Test-LocalTcpPort([int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $connection = $client.ConnectAsync('127.0.0.1', $Port)
        if (-not $connection.Wait(800)) { return $false }
        return $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Test-CaracatoaPanel {
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8765/' -TimeoutSec 2 -UseBasicParsing
        return [int]$response.StatusCode -eq 200 -and $response.Content.Contains('Caracatoa')
    } catch {
        return $false
    }
}

$gameListening = Test-LocalTcpPort 8289
$panelListening = Test-LocalTcpPort 8765
if ($gameListening -and $panelListening) {
    if (-not (Test-CaracatoaPanel)) {
        throw 'As portas locais 8289/8765 estão ocupadas, mas o painel não confirmou ser Caracatoa. Nenhuma conexão de jogo foi iniciada.'
    }
    Write-Host 'Servidor Caracatoa local já está ativo em 127.0.0.1.'
} elseif ($gameListening -or $panelListening) {
    throw 'Uma das portas locais 8289/8765 já está ocupada. O launcher não iniciou outro servidor para evitar conflito.'
} else {
    $node = (Get-Command node -ErrorAction Stop).Source
    New-Item -ItemType Directory -Force -Path $serverStateRoot | Out-Null
    $accountsPath = Join-Path $serverStateRoot 'accounts.json'
    $stdoutPath = Join-Path $serverStateRoot ('preview-server-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.out.log')
    $stderrPath = Join-Path $serverStateRoot ('preview-server-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.err.log')

    if (-not (Test-Path -LiteralPath $accountsPath)) {
        $securePassword = Read-Host 'Senha inicial do administrador local (12 a 128 caracteres)' -AsSecureString
        $secureConfirmation = Read-Host 'Confirme a senha do administrador local' -AsSecureString
        $securePasswordPointer = [IntPtr]::Zero
        $secureConfirmationPointer = [IntPtr]::Zero
        $passwordPointer = [IntPtr]::Zero
        $confirmationPointer = [IntPtr]::Zero
        try {
            $securePasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
            $secureConfirmationPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureConfirmation)
            $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($securePasswordPointer)
            $passwordPointer = [Runtime.InteropServices.Marshal]::StringToBSTR($plainPassword)
            $plainConfirmation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secureConfirmationPointer)
            $confirmationPointer = [Runtime.InteropServices.Marshal]::StringToBSTR($plainConfirmation)
            if ($plainPassword.Length -lt 12 -or $plainPassword.Length -gt 128) {
                throw 'A senha precisa ter de 12 a 128 caracteres.'
            }
            if ($plainPassword -cne $plainConfirmation) {
                throw 'As senhas não coincidem.'
            }
            $env:CARACATOA_ADMIN_PASSWORD = $plainPassword
            $serverProcess = Start-Process -FilePath $node -ArgumentList '.\server.mjs' -WorkingDirectory $serverRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
        } finally {
            if ($passwordPointer -ne [IntPtr]::Zero) {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
            }
            if ($confirmationPointer -ne [IntPtr]::Zero) {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmationPointer)
            }
            if ($securePasswordPointer -ne [IntPtr]::Zero) {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($securePasswordPointer)
            }
            if ($secureConfirmationPointer -ne [IntPtr]::Zero) {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secureConfirmationPointer)
            }
            Remove-Item Env:\CARACATOA_ADMIN_PASSWORD -ErrorAction SilentlyContinue
            $securePassword.Dispose()
            $secureConfirmation.Dispose()
            Remove-Variable plainPassword,plainConfirmation -ErrorAction SilentlyContinue
        }
    } else {
        $serverProcess = Start-Process -FilePath $node -ArgumentList '.\server.mjs' -WorkingDirectory $serverRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    }

    $serverReady = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        Start-Sleep -Milliseconds 500
        if ($serverProcess.HasExited) { break }
        if ((Test-LocalTcpPort 8289) -and (Test-LocalTcpPort 8765) -and (Test-CaracatoaPanel)) {
            $serverReady = $true
            break
        }
    }
    if (-not $serverReady) {
        throw "O servidor Caracatoa não iniciou em 127.0.0.1. Consulte os logs locais: $stdoutPath e $stderrPath"
    }
    Write-Host 'Servidor Caracatoa iniciado em 127.0.0.1:8289 e 127.0.0.1:8765.'
}

$existingClient = Get-Process -Name 'Caracatoa3DPreview' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $preview.FullName -and $_.MainWindowTitle -eq 'Caracatoa 3D Preview' } |
    Select-Object -First 1
if ($existingClient) {
    Write-Host "A prévia Caracatoa já está aberta (PID $($existingClient.Id))."
    return
}

$clientProcess = Start-Process -FilePath $preview.FullName -WorkingDirectory $preview.DirectoryName -PassThru
Write-Host "Prévia aberta: $($preview.FullName) (PID $($clientProcess.Id))."
