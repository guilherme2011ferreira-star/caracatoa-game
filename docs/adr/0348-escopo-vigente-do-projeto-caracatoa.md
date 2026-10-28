# ADR 0348 — Escopo vigente do projeto Caracatoa

- **Status:** Aceita
- **Data:** 27/10/2026

## Contexto

O `PROJECT.md` na raiz ainda descrevia o objetivo histórico de entregar um
cliente nativo macOS para Reborn of Kersef. As instruções atuais definem outro
produto: Caracatoa original, com cliente Windows próprio e servidor
autoritativo próprio. Manter o objetivo antigo como instrução vigente poderia
desviar implementações e verificações para um produto/serviço de terceiros.

## Decisão

- `PROJECT.md` passa a ser o charter vigente de Caracatoa e resume o objetivo,
  critérios amplos, etapas e fontes de verdade.
- A versão anterior é preservada em
  `docs/history/PROJECT-reborn-macos-as-of-2026-10-15.md`; seu conteúdo não é
  uma direção ativa.
- `CARACATOA.md` continua como referência técnica e de estado detalhado, e
  `CARACATOA_HANDOFF.md` como checkpoint operacional mais recente.
- Só retomar desenvolvimento do cliente Reborn/macOS mediante nova instrução
  explícita do usuário.

## Consequências

- Ferramentas e colaboradores que consultam `PROJECT.md` recebem o escopo atual
  do produto sem perder o registro histórico anterior.
- O código legado `work/native-client` permanece histórico e só deve ser usado
  quando resolver uma necessidade técnica concreta de Caracatoa, respeitando
  licenças, procedência e os limites já registrados.
- Esta ADR esclarece o escopo; não declara gameplay, assets ou etapas aprovadas.
