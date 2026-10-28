# ADR 0352 — Avaliação da malha-base masculina de MODELOS

- **Status:** Aceita para prévia local; aptidão visual e integração pendentes.
- **Data:** 27/10/2026.
- **Relacionado:** ADRs 0332, 0350 e 0347.

## Contexto

O usuário pediu que o conteúdo de `pasta MODELOS fornecida pelo usuário` fosse
usado e registrado nas ADRs. A pasta contém um único arquivo:
`free_pack_male_base_mesh.obj`. Não há arquivo MTL, textura, rig nem
documentação de licença junto do OBJ. O cabeçalho declara unidades em
centímetros e referencia o MTL ausente.

O nome, o autor e a contagem geométrica correspondem à página “Free Pack -
Male Base Mesh”, de PolyOne Studio, no Sketchfab. A página lista 4.395 vértices
e cerca de 8,8 mil triângulos e mostra a licença **CC Attribution**. A licença
permite adaptação e redistribuição com atribuição; conservar a página da obra,
o aviso de licença e a indicação das mudanças.

## Decisão

1. Tratar o OBJ como **candidata de corpo-base masculino** para avaliação isolada.
   A cópia de revisão está em
   `docs/art/concept/male-base-mesh-v1/free_pack_male_base_mesh.obj` e mantém o
   conteúdo do arquivo recebido; SHA-256: `3697580450336E407456C6FA8B6075564B2C8213F67F2CDF43E01635FCAFBA18`.
2. Preservar atribuição: “Free Pack - Male Base Mesh” por PolyOne Studio,
   Sketchfab, CC Attribution. O crédito, a página original e a licença estão no
   `README.md` do pacote de prévia. Não afirmar endosso do autor.
3. Não substituir os quatro avatares de classe nem integrá-la ao cliente nesta
   etapa. A página de origem descreve pose T; na renderização do arquivo local,
   os braços aparecem inclinados para baixo, mais próximos de uma pose A. A
   malha é um corpo sem armadura e não traz o MTL referenciado; o GLB de revisão
   usa material neutro. O OBJ não fornece estrutura de esqueleto/animação
   utilizável por este cliente.
4. A ferramenta `convert-obj-to-glb.mjs` preserva as posições, triangula as
   faces e converte centímetros para metros. `preview.html` permite órbita,
   zoom e inspeção local. `mesh-review-render.png` é uma renderização técnica
   por software da malha original, não captura do jogo.
5. Antes de qualquer integração, avaliar proporções e silhueta contra as
   referências WYD fornecidas, testar rig/animação no cliente e confirmar que
   equipamento e materiais produzem a leitura de personagem medieval gótico
   clássico. A prévia técnica não constitui aprovação estética do usuário.

## Consequências

- O projeto pode verificar se esta malha economiza tempo como corpo inicial
  sem confundi-la com um boneco Caracatoa pronto.
- A conversão usa material temporário porque o MTL original está ausente; não
  reproduz o acabamento ou as texturas do pacote integral.
- Para incluir o asset em builds/distribuições, manter o crédito CC Attribution
  e o link de licença junto do material. A transformação e o material temporário
  precisam ser declarados como modificações.
- Se as proporções ou o rig não atenderem ao cliente, manter apenas como
  referência de topologia e continuar usando os modelos de classe do protótipo.

## Evidências e validação

- Origem: <https://sketchfab.com/3d-models/free-pack-male-base-mesh-44b8e235695442fab39b4439a1588618>.
- Termos CC BY: <https://creativecommons.org/licenses/by/4.0/>.
- Leitura local: 4.395 posições, 5.087 UVs, 4.395 normais, 4.476 faces e 8.786
  triângulos após triangulação; caixa de limites convertida: aproximadamente
  0,769 × 0,969 × 0,158 m.
- A hash da cópia no projeto coincide com o arquivo recebido. O conversor e o
  renderizador da prévia usam somente Node.js integrado e a malha local.
- O visualizador Model Viewer é carregado de CDN; a inspeção por navegador
  automatizado não iniciou o kernel nesta sessão. A renderização PNG local foi
  aberta e inspecionada. Não houve teste no Defold.
