# Cliente 3D Caracatoa — Defold 1.14.0

Cliente do MMORPG original Caracatoa. A bundle HTML5 pronta para o playtest está na página GitHub Releases; veja o README da raiz.

## Compilar a partir do código

Requisitos: Defold 1.14.0 e Node.js 24.x. No PowerShell, na raiz do repositório:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\work\caracatoa-defold-prototype\tools\build-defold-spike.ps1 `
  -DefoldRoot 'C:\caminho\para\Defold' `
  -OutputRoot 'build-local' `
  -Platform wasm-web
node .\tools\preview\check-html5-bundle.mjs `
  '.\work\caracatoa-defold-prototype\build-local\bundle\Caracatoa 3D Preview'
```

Use `x86_64-win32` em `-Platform` para gerar cliente nativo Windows. O script usa o JDK/Bob fornecido pela distribuição Defold. A saída de build é local e não deve ser commitada.

Para servir a build HTML5 com servidor próprio temporário e isolado:

```powershell
node .\tools\preview\web-preview-server.mjs `
  '.\work\caracatoa-defold-prototype\build-local\bundle\Caracatoa 3D Preview'
```

A navegação, os recursos e os dados de sessão devem permanecer no servidor Caracatoa. Assets e sua procedência estão descritos em `THIRD_PARTY_NOTICES.md` e `licenses/`.
