# ADR 0359 — distribuição aberta do cliente e do projeto para playtest

- **Status:** Aceita pelo usuário para publicação pública.
- **Data:** 28/10/2026.
- **Relacionado:** ADRs 0347, 0348, 0353, 0354, 0355 e 0358.

## Contexto

O usuário quer que familiares possam baixar e testar o jogo e pediu que o pacote inclua instruções, objetivos concluídos e objetivos em aberto. O checkout de desenvolvimento contém material alheio ao Caracatoa, ambientes locais e estado que não deve ser publicado.

## Decisão

1. Manter um repositório público separado, contendo apenas cliente, servidor Caracatoa, documentação selecionada, código de teste e avisos de licença. Não alterar a visibilidade nem publicar no repositório privado de outro projeto.
2. Fornecer uma release ZIP com bundle HTML5 e launcher para Windows. O jogador instala Node.js 24.x, extrai o ZIP, executa o launcher e abre a URL local impressa.
3. Iniciar a sessão em loopback, com servidor Caracatoa isolado e estado SQLite temporário. Encerrar a prévia remove a conta e os dados da sessão. O pacote não expõe endpoint público.
4. Incluir README em português com execução, build, resultados testados, limites e lista priorizada do trabalho restante.
5. Aplicar MIT ao código original e preservar avisos de WYDBot MIT, Quaternius CC0, Cinzel OFL e Defold/runtime. Excluir conteúdo proprietário e assets da pasta MODELOS sem licença de redistribuição verificada.
6. A release é pré-alfa. Testes técnicos não aprovam a Etapa 1; playtest manual de cadastro, personagem, controles e apresentação continua pendente.

## Consequências

- Familiares conseguem baixar e rodar uma cópia independente, sem depender do endereço de prévia local do desenvolvedor.
- Cada cópia mantém seu estado na própria máquina e não sincroniza contas entre jogadores.
- O código permanece aberto e o build distribuído é reproduzível a partir dos arquivos do projeto, com Defold 1.14.0 e Node.js 24.x.
- Alterações posteriores de gameplay e arte continuam passando por testes e pelo gate de avaliação manual definido na ADR 0347.
