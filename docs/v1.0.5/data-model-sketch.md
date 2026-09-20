# Gegevensmodel v1.0.5 — ontwerpschets

*Fase 0: het ontwerp, nog geen migratie. De definitieve velden komen in fase 1 (agent),
fase 4 (geheugen) en fase 8 (experimenten), telkens met een eigen migratie. Bestaande
modellen worden hergebruikt; hieronder staat alleen wat erbij komt.*

## Wat blijft zoals het is

`GenerationRun` (opdracht, voortgang, journaal, stoppen), `CandidateRoster` (kandidaat,
hash, herkomst, validatie), `HumanLineReview` en `HumanPairwisePreference` (oordelen,
redencodes, modelversies), `RosterCommitteeAdjustment` (herbouwdoelen),
`AuditLogEntry` (formeel spoor), `QuarterlyFeedback` (tevredenheid per profiel).

## Agent

```prisma
model AgentSession {
  id            String   @id @default(uuid())
  locationCode  String
  rosterPeriodId String?
  title         String
  createdByUserId String
  createdAt     DateTime @default(now())
  lastMessageAt DateTime?
  messages      AgentMessage[]
  jobs          AgentJob[]
  @@index([locationCode, lastMessageAt])
}

model AgentMessage {
  id         String   @id @default(uuid())
  sessionId  String
  session    AgentSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  role       AgentRole            // USER | AGENT | SYSTEM
  text       String
  /// Waar de gebruiker naar keek: project, rooster, regel, kandidaat.
  uiContext  Json?
  /// Welke tools zijn aangeroepen en met welk resultaatkenmerk (geen ruwe modeluitvoer).
  toolCalls  Json?
  /// Welke leeritems zijn geraadpleegd, zodat een antwoord herleidbaar is.
  knowledgeUsed String[]
  createdAt  DateTime @default(now())
  @@index([sessionId, createdAt])
}

model AgentCapabilityGrant {
  id            String   @id @default(uuid())
  locationCode  String
  rosterPeriodId String?
  /// Losse capabilities; niveau A/B/C is alleen een voorinstelling in het scherm.
  capabilities  String[]
  maxRounds     Int      @default(0)
  maxSolverSeconds Int   @default(0)
  allowedStrategies String[]
  /// Roosters of regels die met rust gelaten moeten worden.
  protectedRosters String[]
  grantedByUserId String
  grantedAt     DateTime @default(now())
  revokedAt     DateTime?
  @@index([locationCode, revokedAt])
}

model AgentJob {
  id             String   @id @default(uuid())
  sessionId      String?
  locationCode   String
  goal           Json     // getypeerd verbeterdoel (zie FeedbackIntent)
  /// Momentopname van de grant op het moment van starten: achteraf verruimen kan niet.
  grantSnapshot  Json
  status         AgentJobStatus // PLANNED RUNNING PAUSED STOPPING STOPPED COMPLETED FAILED
  state          String         // stap uit de toestandsmachine (§25)
  round          Int      @default(0)
  maxRounds      Int
  usedSolverSeconds Int   @default(0)
  stopReason     String?
  conclusion     String?  // ook "geen betere kandidaat gevonden" is een uitkomst
  createdByUserId String
  createdAt      DateTime @default(now())
  heartbeatAt    DateTime?
  rounds         AgentJobRound[]
  events         AgentEvent[]
  @@index([locationCode, status])
}

model AgentJobRound {
  id          String   @id @default(uuid())
  jobId       String
  job         AgentJob @relation(fields: [jobId], references: [id], onDelete: Cascade)
  roundNumber Int
  /// Sleutel voor idempotentie: dezelfde ronde wordt na een herstart niet dubbel gedraaid.
  roundKey    String   @unique
  hypothesis  String
  strategy    String
  generationRunId String?
  outcome     Json?    // maten van de kandidaten, poortuitslagen
  verdict     String?  // AANGENOMEN | AFGEWEZEN met reden
  startedAt   DateTime @default(now())
  finishedAt  DateTime?
  @@index([jobId, roundNumber])
}

model AgentEvent {
  id         String   @id @default(uuid())
  jobId      String?
  job        AgentJob? @relation(fields: [jobId], references: [id], onDelete: Cascade)
  sessionId  String?
  at         DateTime @default(now())
  kind       String   // FEEDBACK_ONTVANGEN, DOEL_OPGESTELD, RONDE_GESTART, KANDIDAAT_AFGEWEZEN, ...
  message    String   // wat het paneel toont
  detail     Json?    // waar de uitleg op steunt
  @@index([jobId, at])
}
```

De auditlog blijft het formele spoor; `AgentEvent` is de leesbare tijdlijn. Beide
worden geschreven, niet één van de twee.

## Geheugen

```prisma
model KnowledgeItem {
  id            String   @id @default(uuid())
  kind          KnowledgeKind   // PREFERENCE | PATTERN | REJECTION | ENGINE_INSIGHT
  scope         KnowledgeScope  // PROJECT | LOCATION | NETWORK | ENGINE
  locationCode  String?
  rosterPeriodId String?
  rosterProfile String?
  /// Waar het item in ontstond: pakketversie en structuur, voor toepasbaarheid.
  dutyPackageId String?
  structureHash String?
  statement     String   // de voorkeur in gewone taal
  interpretation Json    // gestructureerd: doel, richting, maat, bereik
  rationale     String
  status        KnowledgeStatus // HYPOTHESIS PROPOSED APPROVED_LOCAL APPROVED_NETWORK DISPUTED SUPERSEDED WITHDRAWN
  confirmations Int      @default(0)
  counterExamples Int    @default(0)
  sourceKind    String   // MENSELIJK_OORDEEL | PAARVERGELIJKING | HERHAALD_PATROON | EXPERIMENT
  approvedByUserId String?
  approvedAt    DateTime?
  validFrom     DateTime?
  validUntil    DateTime?
  supersedesId  String?
  supersedes    KnowledgeItem? @relation("Opvolging", fields: [supersedesId], references: [id])
  supersededBy  KnowledgeItem[] @relation("Opvolging")
  qualityModelVersion String?
  engineVersion String?
  createdAt     DateTime @default(now())
  evidence      KnowledgeEvidence[]
  activations   PreferenceActivation[]
  @@index([scope, locationCode, status])
}

model KnowledgeEvidence {
  id        String @id @default(uuid())
  itemId    String
  item      KnowledgeItem @relation(fields: [itemId], references: [id], onDelete: Cascade)
  /// Waar het bewijs staat: kandidaat, beoordeling, paarvergelijking, run of experiment.
  refType   String
  refId     String
  supports  Boolean  // tegenvoorbeeld = false
  note      String?
  createdAt DateTime @default(now())
  @@index([itemId, supports])
}

model PreferenceActivation {
  id            String @id @default(uuid())
  itemId        String
  item          KnowledgeItem @relation(fields: [itemId], references: [id], onDelete: Cascade)
  locationCode  String
  rosterPeriodId String?
  activatedByUserId String
  activatedAt   DateTime @default(now())
  deactivatedAt DateTime?
  note          String?
  @@index([locationCode, rosterPeriodId, deactivatedAt])
}
```

Een correctie maakt een nieuw item met `supersedesId`; het oude blijft staan met status
`SUPERSEDED`. Zo verdwijnt geen auditinformatie en komt een ingetrokken interpretatie
niet opnieuw bovendrijven (test 13, test 25).

## Experimenten

```prisma
model EngineExperiment {
  id            String   @id @default(uuid())
  question      String
  hypothesis    String
  /// Vóór uitvoering vastgelegd, zoals decision-rules.json in v1.0.4.
  acceptanceCriteria Json
  baselinePhase String
  variant       Json     // engineprofiel, variant, gewichten
  datasets      String[]
  sandboxPath   String
  codeFingerprint String?
  status        String   // VOORGESTELD GOEDGEKEURD LOPEND KLAAR AFGEWEZEN GEPROMOVEERD
  result        Json?
  regressions   Json?
  verdict       String?
  proposedByAgent Boolean @default(true)
  approvedByUserId String?
  createdAt     DateTime @default(now())
  finishedAt    DateTime?
}
```

## Rechten

Geen nieuw model: de agentcapabilities komen in `src/server/security/permissions.ts`
bij de bestaande lijst, en `AgentCapabilityGrant` legt per project vast welke daarvan
aan staan en binnen welke grenzen. `requirePermission()` blijft de enige poort.

## Standplaatssleutel

Fase 7 maakt de sleutel uniform. Nu: `BaseRoster.depot` (tekst), `DutyPackage.depot` +
`locationId`, `GenerationRun.locationCode`, `CandidateRoster.locationCode`. Alle nieuwe
modellen gebruiken `locationCode`; de migratie in fase 7 vult dat aan bij `BaseRoster`
en `DutyPackage` en laat de oude velden voorlopig staan.
