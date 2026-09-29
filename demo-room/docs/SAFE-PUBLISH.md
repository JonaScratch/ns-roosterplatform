# Safe publish, versies en rollback

Zie ook `demo-room/src/publish/versions.ts`, `demo-room/src/publish/safePublish.ts`.

## Het architectuurprincipe

> Demo Room mag experimenteren. Demo Room mag aanbevelen. Demo Room mag een
> promotion candidate maken. **Jonathan publiceert.** En iedere
> productieversie moet volledig herstelbaar zijn.

Geen enkele functie in deze codebase publiceert zonder een expliciete
menselijke bevestiging (`--confirm` op de CLI, of de bevestigingsknop in het
publiceer-reviewscherm van het dashboard).

## Wat "publiceren" hier technisch betekent

De vierde en laatste minimale, gecontroleerde koppeling met de hoofdapp (zie
`ARCHITECTURE.md`): `LocalModelConfig.systemPromptOverride` (al bestond sinds
v0.1) wordt in productie standaard gevuld door
`productionOverrideFromDisk()` in `src/server/agent/model/local.ts`, die de
**inhoud** van het bestand waar `NS_PRODUCTION_PROMPT_FILE` naar wijst bij
élke aanvraag opnieuw leest. Publiceren is daarmee **het schrijven van een
bestand** — geen source-wijziging, geen build, geen herstart. Ontbreekt het
bestand of de omgevingsvariabele, dan geldt gewoon de standaardinstructie:
er is geen foutpad waarop de agent kan uitvallen.

Dit dekt vandaag de drie variantcategorieën die Demo Room zelf kan maken
(`PROMPT`, `TOOL_ROUTING`, `CONTEXT_POLICY` — alle drie leven als tekst in
dezelfde systeeminstructie). `ENGINE`-categorie experimenten (optimizer-
gewichten/strategie) publiceren via de bestaande hoofdapp-weg
(`NS_ENGINE_PROFILE`/`NS_ENGINE_VARIANT`, zie `promotieStappen()` in
`src/server/agent/experiments.ts`) — `safePublish.ts` weigert die expliciet
in de preflight-stap.

## Versies

Elke gepubliceerde (of ooit-actieve) versie is een eigen, onveranderlijk
bestand: `demo-room/data/lyra-versions/<id>.json`
(`lyra-prod-YYYY-MM-DD-NN`). Een aparte wijzer (`current.json`) zegt welke nu
live is; de daadwerkelijke tekst staat in `current-prompt.txt`. Dit zijn
runtime-omgevingsbestanden van *deze* lokale installatie — net als een
`.env` niet in git getrackt (zie `.gitignore`), terwijl het *verhaal* van
elke publicatie (waarom, met welke cijfers) wél in git terechtkomt via het
journaal (`reports/history/`).

### De releasedienst (sinds fase Q): transactioneel en op naam

Het wisselen van de actieve versie loopt uitsluitend via
`src/lib/lyra-release.ts` (`commitRelease`), en het NS Roosterplatform leest
de actieve versie via dezelfde module (`getActiveLyraVersion`, aangeroepen
door `src/server/agent/model/local.ts`):

- de tekst komt inhoud-geadresseerd in `prompts/<sha256>.txt` (nooit
  overschreven); daarna wisselt `current.json` atomisch (tmp + rename) met
  id, hash, generatie, goedkeurder en reden. Dat is het enige commitmoment:
  een crash ervoor laat de oude versie volledig actief;
- klopt de hash in de wijzer niet met de tekst, dan gebruikt het platform
  **geen** toevoeging (kale standaardinstructie) en meldt het dat;
- `current-prompt.txt` wordt ná het commitmoment bijgewerkt, alleen voor een
  `NS_PRODUCTION_PROMPT_FILE` die er nog naar wijst;
- elke activatie vereist een benoemde mens (id + rol) en een reden, en komt in
  `activations.jsonl` (append-only). Soorten: `ACTIVATE`, `ROLLBACK`,
  `AUTO_ROLLBACK` (het automatische herstel bij een mislukte publicatie, op
  naam van wie publiceerde);
- `expectedGeneration` voorkomt dat twee mensen tegelijk "gelijk" krijgen:
  wie een verouderde generatie zag, krijgt een conflict.

CLI: `publish|rollback ... --confirm --door <naam> --rol <rol> --reden <tekst>`.
API: `confirm: true`, `actorId`, `role`, `reason` (anders 400).

Er bestaat altijd een `lyra-prod-baseline`-versie (geen override — de kale
hardcoded instructie) als impliciet vertrekpunt, ook als er nog nooit
gepubliceerd is.

## De veilige publicatiepijplijn

`safePublish.publishExperiment(experimentId)`, in deze volgorde:

1. **Preflight** — bestaat het experiment, is het besluit `PROMOTION_CANDIDATE`,
   is het een publiceerbare categorie, is de exacte varianttekst
   reproduceerbaar (nooit een parafrase of een ongeteste combinatie van
   meerdere experimenten), is het nog niet de huidige productieversie?
2. **Backup** — het herstelpunt is de huidige actieve versie zelf; die blijft
   als eigen bestand bestaan (nooit overschreven), dus een "backup maken" is
   hier een controle, geen kopieeractie.
3. **Toepassen** — de nieuwe versie wordt live via de releasedienst
   (tekst inhoud-geadresseerd, dan één atomische wijzerwissel, op naam van
   de goedkeurder); statussen daarna bijgewerkt. Zonder goedkeuring stopt
   de pijplijn al bij de preflight.
4. **Typecheck** — `npx tsc --noEmit` over de hele hoofdapp. Faalt dit, dan
   is er iets structureel mis (zelden veroorzaakt door deze specifieke
   wijziging, maar een publish-moment is een redelijk moment om het sowieso
   te controleren) → automatische rollback.
5. **Smoke benchmark** — een klein, vast setje echte vragen door het
   productiepad (géén `modelOverride` — dit is de enige manier om te
   bewijzen dat `NS_PRODUCTION_PROMPT_FILE` daadwerkelijk gelezen wordt en
   het model bereikbaar is).
6. **Grondings-/veiligheidscontrole** — falen de grounding- of
   false-premise-items in die smoke-set, dan is dat een kritieke regressie
   → automatische rollback.
7. **Succes** → journaal geschreven, `HANDOFF.md` bijgewerkt, de nieuwe
   versie blijft actief. **Fout** (stap 4-6) → automatische rollback naar de
   vorige versie, met expliciete logregels `Publish failed` /
   `Rollback started` / `Rollback completed` (of `Rollback failed — manual
   intervention required`, nooit verborgen).

## Handmatig herstel

`safePublish.rollbackTo(versionId, runId, goedkeuring)` (CLI: `rollback --version-id ... --confirm --door ... --rol ... --reden ...`;
dashboard: tabblad "Lyra-versies" → "Herstel", met bevestiging) zet de wijzer
terug naar een gekozen eerdere versie. Omdat elke versie een eigen,
onveranderlijk bestand is, "verlies" je nooit de enige goede versie: de
huidige versie blijft gewoon staan (status `SUPERSEDED`) en is zelf later
weer met dezelfde actie terug te halen.

## Wat hier bewust (nog) niet gebeurt

- Geen automatische publicatie op basis van een drempelwaarde — altijd één
  expliciete menselijke bevestiging.
- Geen publicatie van een "optelsom" van meerdere experimenten: de
  preflight-stap controleert dat de gepubliceerde tekst letterlijk is wat in
  het gekoppelde `ProofOfValueResult`/journaal is gemeten.
- Geen ENGINE-categorie publish via deze pijplijn (zie boven).
- De smoke-benchmark en typecheck-stappen zijn **LOCAL REQUIRED**: zonder
  een lokaal taalmodel/database faalt de pijplijn hier bewust vóór stap 7 —
  nooit een "succesvolle" publicatie zonder dat er werkelijk gemeten is.
