@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24.x e necessario. Instale em https://nodejs.org/ e tente novamente.
  pause
  exit /b 1
)
node --version
echo Iniciando Caracatoa em modo local isolado. Abra o endereco 127.0.0.1 impresso abaixo.
echo Para parar e apagar os dados temporarios, pressione Ctrl+C nesta janela.
node tools\preview\web-preview-server.mjs release\html5
if errorlevel 1 pause
