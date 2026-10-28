# ADR 0349 — Sandbox interativo para o playtest da Etapa 1

- **Status:** Aceita
- **Data:** 27/10/2026

## Contexto

O launcher interativo padrão reutiliza o servidor Caracatoa persistente. Isso
faz uma conta nova de teste permanecer na base local normal. A avaliação da
Etapa 1 precisa permitir cadastro, login, PIN, criação de personagem e entrada
no mundo sem exigir que o usuário limpe dados depois. O cliente também usa
portas fixas, o que impede iniciar um servidor isolado enquanto o servidor
persistente está aberto.

## Decisão

- O cliente mantém host fixo em `127.0.0.1`, com defaults HTTP `8765` e jogo
  `8289`. Variáveis por processo `CARACATOA_REGISTRATION_PORT` e
  `CARACATOA_SERVER_PORT` aceitam inteiros de 1 a 65535 e mudam somente as
  portas de loopback usadas pelo cliente.
- Os verificadores sintéticos passam a usar `CARACATOA_SERVER_PORT`, a mesma
  configuração do cliente interativo. O antigo override
  `CARACATOA_TEST_PORT` é removido; `CARACATOA_TEST_TRACE` continua apenas
  escrevendo traces de teste temporários.
- `start-caracatoa-stage1-sandbox.ps1` inicia o servidor em duas portas
  loopback livres, com catálogos copiados e estado SQLite/contas novos numa
  pasta temporária. Uma senha admin aleatória é entregue apenas ao processo do
  servidor; o usuário cria suas próprias credenciais de jogo no cliente.
- O launcher recusa uma segunda instância do cliente para evitar conflito de
  logs. Ao fechar o cliente, encerra o servidor isolado e apaga somente a pasta
  criada pelo próprio launcher sob `%TEMP%`.
- `start-caracatoa-3d-playable.ps1` permanece como launcher da instalação
  persistente nos defaults 8289/8765.

## Consequências

- O usuário consegue repetir o cadastro e apagar automaticamente todos os
  dados do playtest sem tocar no servidor persistente.
- Os endpoints HTTP e TCP continuam limitados a loopback, sem configuração de
  domínio/IP externo.
- A build do sandbox é separada da build corrente, permitindo abrir uma sessão
  isolada sem interromper o servidor ou dados que o usuário já mantém.
- Fechar à força apenas a janela do PowerShell pode impedir a limpeza automática;
  os dados restantes ficam identificados por prefixo e sob a pasta temporária.

## Validação

O build de sandbox deve passar o verificador de frames e as sessões E2E das
quatro classes usando a variável genérica de porta. O launcher deve ser
validado com servidor/painel em portas efêmeras e base isolada; a criação de
conta pela UI continua exigindo playtest manual do usuário.
