# Prévia HTML5 local do Caracatoa

A prévia usa o cliente Defold, o servidor Caracatoa e o protocolo deste projeto. O modo padrão inicia ambos em loopback e usa banco SQLite temporário.

## Abrir a build publicada

Na raiz, execute `INICIAR-PREVIA.cmd` ou `npm run preview`. Abra no Edge/Chrome o endereço `http://127.0.0.1:<porta>/` exibido pelo programa. Não abra `index.html` como arquivo: o WebAssembly exige HTTP.

Cadastros, PINs, personagens e progresso são descartáveis. Pare o processo com `Ctrl+C` para encerrar o servidor e apagar o sandbox. O listener não fica acessível para outros computadores.

## Executar testes

```powershell
npm run check:bundle
npm run test:preview
```

Os testes verificam MIME do WebAssembly, ponte local de transporte, cadastro sintético e elementos de layout/controles. Testes automatizados não substituem playtest visual.

## Compilar

Veja [`work/caracatoa-defold-prototype/README.md`](../../work/caracatoa-defold-prototype/README.md) para compilar o cliente Defold.
