# ADR 0332 - Previsualizar modelos e arquitetura antes da integração

## Status

Aceita como fluxo de produção visual em 27/10/2026.

## Contexto

O usuário quer ver modelos de itens e arquitetura antes que entrem no jogo. A arte aprovada deve orientar o 3D com materiais, silhuetas e iluminação próximos, e o projeto não deve trocar esses desenhos por formas genéricas ou primitivas simples.

## Decisão

1. Para novos itens equipáveis e módulos de arquitetura, produzir primeiro uma prancha de direção visual e uma prévia 3D isolada do cliente.
2. Apresentar a prévia antes da integração. Se o usuário apontar mudanças, ajustá-la. Se não fizer comentários, o Lead decide e prossegue com base na direção visual aprovada.
3. Distinguir arte conceitual de malha 3D e de asset integrado. Uma imagem de render não prova a existência de malha; GLB estático não prova rig, animação, textura final, funcionamento no renderer ou aparência no jogo.
4. A revisão visual deve verificar silhueta de classe, leitura em câmera de gameplay, materiais, proporção, bordas trabalhadas e coerência com ferro escuro, bronze envelhecido, ouro controlado, pedra carvão, tecido carmesim e luz âmbar/lunar.
5. A arquitetura precisa ser plausível e delimitada, com parede, piso, vãos, apoio estrutural e acabamento coerente; evitar cenários infinitos ou superfícies genéricas.
6. Integrar somente modelos originais ou licenciados. Preservar avisos e atribuições. A referência a franquias existentes orienta o tema amplo, sem reproduzir personagens, logotipos ou emblemas protegidos.

## Prévia atual

A revisão arquitetônica atual é o Portão Astral de Valedourada em `docs/art/concept/portao-astral-3d-v1/`: GLB estático original com material procedural e galeria de revisão. O usuário aprovou o modelo, e ele foi adaptado e integrado à cena da cidade no Defold. A build confirma importação/empacotamento, mas a validação de câmera, escala e colisões dentro do mundo continua separada.

## Consequências

- A avaliação visual acontece antes de mudar o avatar ou os mapas ativos.
- Modelos aprovados passam por adequação de escala e otimização para Defold; builds confirmam importação, enquanto revisão manual em gameplay confirma apresentação e uso.
- Pré-visualizações podem ficar em revisão local sem afetar o jogo.
