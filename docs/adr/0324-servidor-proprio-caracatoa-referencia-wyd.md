# ADR 0324 — Servidor próprio Caracatoa e WYD como referência técnica

## Status

Aceita — 26/10/2026. Confirma a prioridade de `server/caracatoa` definida na
ADR 0298 e esclarece o papel dos clientes WYD existentes.

## Contexto

O objetivo atual é desenvolver o servidor e a infraestrutura do jogo original
Caracatoa. O usuário delimitou que a arquitetura e o gameplay de um cliente
WYD existente servem como referência de dados e protocolos em validações
locais. O protótipo Defold e `server/caracatoa` já oferecem login, personagens,
movimento, combate e persistência parciais em loopback; sistemas de montarias,
economia, mapas e outras regras ainda precisam de implementação.

A análise estática da cópia local de `rok.exe` identificou na build de SHA-256
`CF4439CF25C3A79C4DA8F130B4BBAEEE2B920C9560D0C8CC7922C0FF5FE7769F`
um marcador inicial de sessão, a porta 8289 e um login `0x20D` de 152 bytes.
Essa evidência ajuda a documentar diferenças de protocolo; ela não demonstra
compatibilidade do cliente WYD com o servidor Caracatoa nem define o cliente
WYD como produto.

## Decisão

1. Priorizar `server/caracatoa` como servidor autoritativo do jogo original.
   Novas regras de conta, personagem, combate, itens, montarias, mundo e
   economia pertencem a esse servidor e à persistência Caracatoa.
2. Continuar a experiência jogável própria em
   `work/caracatoa-defold-prototype`, seguindo a direção visual da ADR 0323.
   O cliente WYD instalado permanece fora do repositório e da distribuição.
3. Usar Snalmir, OpenWYD e análises de clientes WYD como referências técnicas
   isoladas para formatos, dados, fluxos e fixtures sintéticas. Não trocar a
   base autoritativa por esses servidores nem incorporar assets proprietários.
4. Validar protocolos e regras em `127.0.0.1`, com dados de teste locais.
   Uma observação estática de pacote não conta como sessão ou gameplay
   funcional; cada afirmação de integração requer teste correspondente.
5. Escolher as próximas fatias por lacunas do produto Caracatoa, mantendo
   contas, combate, inventário e progressão existentes como base de evolução.

## Consequências

- O trabalho focal sobre a build `rok.exe` permanece como evidência de
  referência; não se torna uma adaptação obrigatória do servidor Snalmir.
- A infraestrutura e os sistemas originais do Caracatoa continuam sendo o
  critério de conclusão do projeto.
- A distribuição final depende de código e arte próprios ou licenciados, com
  os avisos de terceiros preservados.

## Evidências

- `server/caracatoa/README.md` e relatórios de sessão local do projeto.
- `work/re-tools/ghidra-roklocal-current-192-20261026/focused-query.log`,
  `send-path-query.log` e `socket-send-query.log`, somente análise estática.
- [ADR 0298 — cliente próprio e referências](0298-cliente-proprio-caracatoa-e-referencias-wow.md).
- [ADR 0323 — linguagem visual](0323-linguagem-visual-gotica-caracatoa.md).
