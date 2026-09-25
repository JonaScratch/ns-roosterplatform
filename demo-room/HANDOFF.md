# HANDOFF — Lyra Demo Room

Laatst bijgewerkt: (nog niet — dit is de v0.1-oplevering, nog geen enkele run uitgevoerd)

> Plak dit bestand in een nieuwe Claude- of ChatGPT-chat om direct te weten waar dit project staat.

## Stand van zaken

- Beste sandboxvariant: **(nog geen — er is nog geen run uitgevoerd)**
- Huidige productievariant: **lokaal:qwen3 (productie-instructie, ongewijzigd — zie model/local.ts)**
- Beste benchmarkscore tot nu toe: (nog niet gemeten — LOCAL REQUIRED, zie demo-room/README.md)

## Nog niet gepromoveerde experimenten

_geen — v0.1 is net opgeleverd, nog geen enkel experiment gedraaid_

## Promotion candidates (wachten op menselijke/Claude-beoordeling)

_geen_

## Belangrijkste bekende zwaktes

_nog geen zwaktes vastgelegd — dit vergt een echte lokale run_

## Laatste 10 relevante experimenten

_nog geen experimenten uitgevoerd_

## Open hypotheses

_geen — start met een korte gecontroleerde run (§36 Fase I van de opdracht)_

## Regressies

_geen bekende regressies_

## Aanbevolen volgende stap(pen)

- Start Ollama en de hoofddatabase lokaal (zie `demo-room/README.md`).
- Draai een korte gecontroleerde benchmark: `npx tsx --conditions=react-server demo-room/src/cli.ts benchmark --suite dev`.
- Draai daarna `npx tsx --conditions=react-server demo-room/src/cli.ts run-challenge --id L1-nacht-vroeg-overgangen` als eerste, kleine challenge.
- Draai pas een volledige 60-minutenrun (`autonomous --minutes 60`) nadat de korte run stabiel bleek (§36 Fase K).
- Draai na elke run `npx tsx --conditions=react-server demo-room/src/cli.ts report` om dit bestand bij te werken.
