# ADR 0356 — Modo persistente da prévia HTML5 local

- **Status:** Aceita
- **Data:** 27/10/2026
- **Relacionada:** ADR 0353 — Prévia HTML5 local com servidor isolado.

## Contexto

A ADR 0353 define a prévia isolada como opção segura para playtest: contas e
personagens são temporários. A Etapa 1 também precisa permitir validar cadastro
e login contra o banco local autoritativo depois que a prévia ou a aba fechar.
Trocar a prévia padrão para o banco persistente faria um teste visual gravar
dados permanentes sem intenção clara.

## Decisão

1. Manter o modo isolado como padrão. Ele continua iniciando e limpando o próprio
   servidor e o estado temporário conforme ADR 0353.
2. Adicionar o modo explícito `--persistent-local` ao servidor da prévia HTML5.
   Esse modo verifica a disponibilidade e encaminha o cadastro para
   `127.0.0.1:8765` e os frames de jogo para `127.0.0.1:8289`.
3. Vincular a ponte HTML5 somente a `127.0.0.1`. O modo persistente não inicia,
   configura, encerra ou remove estado dos servidores Caracatoa existentes; ao
   receber `Ctrl+C`, fecha apenas a ponte web.
4. Informar no terminal e na documentação que cadastros, PINs, personagens e
   progresso deste modo ficam no banco persistente. O título da aba e os
   cabeçalhos HTTP da prévia identificam o modo de armazenamento; prévias
   isoladas exibem também um ID curto por instância, pois cada processo possui
   seu próprio banco temporário. Não enviar dados de conta automaticamente
   durante inicialização ou verificação de prontidão.
5. Não mudar as regras de aprovação manual da Etapa 1 nem tratar handshake ou
   cadastro sintético como playtest visual.

## Consequências

- O jogador pode testar um cadastro que continue válido após fechar a prévia,
  com o servidor Caracatoa local real.
- A opção exige que ambos os listeners persistentes estejam disponíveis e que
  o operador escolha explicitamente o modo que grava dados duráveis.
- O modo isolado continua apropriado para automação e continua sendo o padrão.
- O título e os cabeçalhos deixam visível quando uma conta é temporária e
  ajudam a distinguir prévias isoladas que não compartilham o mesmo estado.
- Nenhum serviço fica acessível pela rede local ou pela Internet; a ponte e os
  destinos permanecem limitados a loopback.

## Validação

- A suíte da prévia cobre o bind em loopback, o encaminhamento HTTP e TCP e
  confirma que fechar a ponte não encerra os serviços de backend.
- A inicialização local verifica `GET /` em `8765` e a abertura TCP em `8289`;
  nenhuma credencial ou cadastro é enviado nessa verificação.
- `web-preview-server.test.mjs` verifica título e cabeçalhos para distinguir
  modo isolado temporário de modo persistente.
- A Etapa 1 ainda exige o teste manual de cadastro/login/PIN e gameplay do
  usuário conforme ADR 0347.
