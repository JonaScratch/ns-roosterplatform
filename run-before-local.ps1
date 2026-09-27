#Requires -Version 5.1
<#
.SYNOPSIS
  Draait de bevroren LYRA MASTER PROGRAM BEFORE-benchmark lokaal, met het echte
  Ollama/Qwen-model, tegen commit 588c1e5.

.DESCRIPTION
  Dit script hoort thuis in de repository-root (waar package.json staat) en
  wordt lokaal gedraaid, niet in de cloud-omgeving van Claude Code — daar is
  geen Ollama bereikbaar (zie docs/lyra-knowledge/current-state.md, "Wat
  blijft LOCAL REQUIRED").

  Wat dit script doet, in volgorde, en waarom:

  1. Controleert dat git/node/Ollama/curl aanwezig zijn.
  2. Vereist een SCHONE werkmap (geen ongecommit werk) — een BEFORE-meting
     tegen een werkmap met eigen, niet-vastgelegde wijzigingen erin zou geen
     eerlijke "vóór"-meting meer zijn.
  3. Zet de werkmap op EXACT commit 588c1e5 (git checkout, detached HEAD) —
     tenzij die daar al op staat. Dit is de bevroren BEFORE-codebaseline; de
     lokale-modelroute, de golden suite en het regelbestand moeten precies
     zijn zoals op dat moment, niet zoals na latere Fase 2+-documentatie- en
     testcommits.
  4. Controleert de ontwikkeldatabase (npm run db:status-equivalent) en
     Ollama-bereikbaarheid, en dat NS_AGENT_FORCE_STUB NIET gezet is — een
     BEFORE-meting via de stub zou niets bewijzen (zie §29 van de opdracht).
  5. Genereert een gecombineerd voor-manifest (git+model+hashes+expliciete
     database/engine/kwaliteitsmodel/regelset-versies).
  6. Draait de bevroren 43-item golden suite N keer (replicates) — nooit
     één keer, want temperatuur 0 gaf in v1.0.6 al aantoonbaar variatie
     (docs/v1.0.6/n0-n1-vergelijking.md: 7 van de 43 items verschilden tussen
     twee identieke-code-runs). Elke replicaat krijgt een uniek "meting"-pad
     (nooit overschreven, zelfs bij een herhaalde scriptrun).
  7. Beoordeelt elke replicaat (grade + fabricatiecontrole) en telt daarna de
     spreiding over de replicaten (item-agreement, mean/median/worst).
  8. Schrijft één BEFORE-VERIFICATION.json die alles samenvat — dit is het
     bestand dat je terugstuurt naar (of laat inlezen door) Claude Code.
  9. Zet de werkmap terug op de branch waar hij vóór dit script op stond
     (tenzij -BlijfOpBaseline is gegeven).

.PARAMETER Replicates
  Aantal keer dat de golden suite tegen het echte model wordt gedraaid.
  Standaard 3 (het minimum dat §41 van de opdracht als redelijk noemt).

.PARAMETER BaselineCommit
  De te controleren/uit te checken bevroren commit. Standaard 588c1e5.

.PARAMETER BlijfOpBaseline
  Als gezet: laat de werkmap na afloop op de gedetachte 588c1e5-checkout
  staan in plaats van terug te schakelen naar de vorige branch.

.EXAMPLE
  .\run-before-local.ps1
.EXAMPLE
  .\run-before-local.ps1 -Replicates 5
#>

param(
  [int]$Replicates = 3,
  [string]$BaselineCommit = "588c1e5",
  [switch]$BlijfOpBaseline
)

$ErrorActionPreference = "Stop"
$RepoRoot = $PSScriptRoot
Set-Location $RepoRoot

function Write-Stap($tekst) {
  Write-Host ""
  Write-Host "=== $tekst ===" -ForegroundColor Cyan
}

function Mislukt($tekst) {
  Write-Host "[FOUT] $tekst" -ForegroundColor Red
  exit 1
}

# ── 1. Vereisten ─────────────────────────────────────────────────────────────
Write-Stap "Vereisten controleren"

foreach ($cmd in @("git", "node", "npx", "curl")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Mislukt "'$cmd' is niet gevonden op PATH. Installeer het en probeer opnieuw."
  }
}
if (-not (Test-Path (Join-Path $RepoRoot "package.json"))) {
  Mislukt "Geen package.json gevonden in $RepoRoot. Draai dit script vanuit de repository-root."
}
if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) {
  Mislukt "node_modules ontbreekt. Draai eerst: npm install"
}
if (-not (Test-Path (Join-Path $RepoRoot ".env"))) {
  Mislukt "`.env` ontbreekt. Kopieer .env.example naar .env en vul NS_LOCAL_LLM_URL / NS_LOCAL_LLM_MODEL / de databaseconfiguratie in."
}

# ── 2. Schone werkmap vereist ────────────────────────────────────────────────
Write-Stap "Werkmap-status controleren"

$status = git status --porcelain
if ($status) {
  Write-Host $status
  Mislukt "De werkmap is niet schoon (zie hierboven). Commit of stash je wijzigingen eerst — een BEFORE-meting tegen een vervuilde werkmap is geen eerlijke voor-meting."
}
$vorigeBranch = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Host "Huidige branch: $vorigeBranch"

# ── 3. Op exact de bevroren baseline zetten ──────────────────────────────────
Write-Stap "Baseline-commit controleren ($BaselineCommit)"

git fetch origin 2>&1 | Out-Null
$huidigeCommit = (git rev-parse HEAD).Trim()
if (-not $huidigeCommit.StartsWith($BaselineCommit)) {
  Write-Host "HEAD is $huidigeCommit, niet $BaselineCommit — werkmap wordt (gedetacheerd) op $BaselineCommit gezet."
  git checkout $BaselineCommit 2>&1 | Write-Host
  if ($LASTEXITCODE -ne 0) { Mislukt "Kon niet naar $BaselineCommit uitchecken. Bestaat die commit lokaal (git fetch al gedraaid)?" }
} else {
  Write-Host "Werkmap staat al op $BaselineCommit."
}
$huidigeCommit = (git rev-parse HEAD).Trim()
if (-not $huidigeCommit.StartsWith($BaselineCommit)) {
  Mislukt "HEAD is na de checkout nog steeds niet $BaselineCommit (is $huidigeCommit). Stop."
}
Write-Host "HEAD bevestigd op $huidigeCommit" -ForegroundColor Green

# ── 4. Database, Ollama, stub-uitschakeling ──────────────────────────────────
Write-Stap "Ontwikkeldatabase controleren"
npx tsx --conditions=react-server scripts/dev-db.ts status
if ($LASTEXITCODE -ne 0) { Mislukt "De ontwikkeldatabase draait niet. Start hem met: npm run db:up" }

Write-Stap "Ollama-bereikbaarheid controleren"
$ollamaUrl = "http://127.0.0.1:11434"
try {
  $envLine = (Get-Content .env | Where-Object { $_ -match "^NS_LOCAL_LLM_URL=" } | Select-Object -First 1)
  if ($envLine) { $ollamaUrl = ($envLine -split "=", 2)[1].Trim().Trim('"') }
} catch { }
$ollamaStatus = & curl.exe -s -o $null -w "%{http_code}" "$ollamaUrl/v1/models" 2>$null
if ($ollamaStatus -ne "200") {
  Mislukt "Ollama lijkt niet bereikbaar op $ollamaUrl (HTTP $ollamaStatus). Start Ollama (ollama serve) en probeer opnieuw."
}
Write-Host "Ollama bereikbaar op $ollamaUrl." -ForegroundColor Green

Write-Stap "Stub-uitschakeling controleren"
if ($env:NS_AGENT_FORCE_STUB) {
  Write-Host "NS_AGENT_FORCE_STUB stond aan ($($env:NS_AGENT_FORCE_STUB)) — wordt voor deze sessie uitgeschakeld." -ForegroundColor Yellow
  Remove-Item Env:\NS_AGENT_FORCE_STUB -ErrorAction SilentlyContinue
}
Write-Host "NS_AGENT_FORCE_STUB is niet gezet — de echte lokale-modelroute wordt gebruikt." -ForegroundColor Green

# ── 5. Manifest ───────────────────────────────────────────────────────────────
$RunId = Get-Date -Format "yyyyMMdd-HHmmss"
Write-Stap "Voor-manifest genereren (run $RunId)"
npx tsx --conditions=react-server scripts/lyra-master/before-manifest.ts --run $RunId --phase before
if ($LASTEXITCODE -ne 0) { Mislukt "Manifest-generatie faalde (zie foutmelding hierboven) — meestal: model onbereikbaar, stub actief, of werkmap niet exact op $BaselineCommit." }

# ── 6/7. Replicates draaien en beoordelen ────────────────────────────────────
$fout = $false
for ($r = 1; $r -le $Replicates; $r++) {
  $meting = "before-$RunId-r$r"
  Write-Stap "Replicaat $r/$Replicates — meting '$meting'"

  npx tsx --conditions=react-server scripts/v106/golden-bench.ts --meting $meting
  if ($LASTEXITCODE -ne 0) { $fout = $true; Write-Host "[FOUT] golden-bench.ts faalde voor $meting" -ForegroundColor Red; continue }

  npx tsx --conditions=react-server scripts/v106/golden-grade.ts --meting $meting
  if ($LASTEXITCODE -ne 0) { $fout = $true; Write-Host "[FOUT] golden-grade.ts faalde voor $meting" -ForegroundColor Red; continue }

  npx tsx --conditions=react-server scripts/v106/golden-fabricatie.ts --meting $meting
  if ($LASTEXITCODE -ne 0) { $fout = $true; Write-Host "[FOUT] golden-fabricatie.ts faalde voor $meting" -ForegroundColor Red; continue }
}

if ($fout) { Mislukt "Minstens één replicaat is mislukt (zie hierboven). Los het probleem op en draai het script opnieuw — elke run krijgt een nieuwe RunId, dus niets wordt overschreven." }

# ── 8. Aggregatie + verificatiebestand ───────────────────────────────────────
Write-Stap "Replicaten aggregeren"
npx tsx --conditions=react-server scripts/lyra-master/aggregate-replicates.ts --run $RunId --replicates $Replicates --phase before
if ($LASTEXITCODE -ne 0) { Mislukt "Aggregatie faalde." }

$doelMap = Join-Path $RepoRoot "docs\lyra-knowledge\benchmarks\before\$RunId"
$manifest = Get-Content (Join-Path $doelMap "manifest.json") -Raw | ConvertFrom-Json
$aggregate = Get-Content (Join-Path $doelMap "aggregate.json") -Raw | ConvertFrom-Json

$verificatie = [ordered]@{
  schema        = "ns-lyra-master-before-verification/1"
  runId         = $RunId
  phase         = "before"
  baselineCommit = $manifest.git.headCommit
  recordedAt    = (Get-Date).ToString("o")
  replicates    = $Replicates
  metingen      = $aggregate.metingen
  model         = $manifest.localModel.model
  stubExplicitlyDisabled = $manifest.stubExplicitlyDisabled
  itemAgreementRate = $aggregate.itemAgreementRate
  overall       = $aggregate.overall
  instabieleItemsCount = $aggregate.instabieleItems.Count
  paden = [ordered]@{
    manifest  = "docs/lyra-knowledge/benchmarks/before/$RunId/manifest.json"
    aggregate = "docs/lyra-knowledge/benchmarks/before/$RunId/aggregate.json"
    replicaten = ($aggregate.metingen | ForEach-Object { "docs/v1.0.6/benchmarks/$_/golden.json (+golden-grade.json, +golden-fabricatie via console-output)" })
  }
  status = if ($manifest.localModel.reachable -and $manifest.stubExplicitlyDisabled -and (-not $fout)) { "PASS" } else { "FAIL" }
}
$verificatiePad = Join-Path $doelMap "BEFORE-VERIFICATION.json"
$verificatie | ConvertTo-Json -Depth 10 | Set-Content -Path $verificatiePad -Encoding utf8

Write-Stap "PASS/FAIL-samenvatting"
Write-Host "Status: $($verificatie.status)" -ForegroundColor $(if ($verificatie.status -eq "PASS") { "Green" } else { "Red" })
Write-Host "Model: $($verificatie.model) · stub uitgeschakeld: $($verificatie.stubExplicitlyDisabled)"
Write-Host "Item-agreement over $Replicates replicaten: $([math]::Round($verificatie.itemAgreementRate * 100, 1))% · instabiele items: $($verificatie.instabieleItemsCount)"
Write-Host "Gemiddeld slagingspercentage: $([math]::Round($verificatie.overall.meanPct, 1))% (mediaan $([math]::Round($verificatie.overall.medianPct, 1))%, worst $([math]::Round($verificatie.overall.worstPct, 1))%)"
Write-Host ""
Write-Host "Verificatiebestand: $verificatiePad" -ForegroundColor Green
Write-Host ""
Write-Host "VOLGENDE STAP: stuur de map 'docs\lyra-knowledge\benchmarks\before\$RunId\' (manifest.json," -ForegroundColor Yellow
Write-Host "aggregate.json, BEFORE-VERIFICATION.json) terug naar Claude Code — als bestandsupload in de chat," -ForegroundColor Yellow
Write-Host "of via 'git add docs/lyra-knowledge docs/v1.0.6/benchmarks/before-$RunId-r*' + commit + push" -ForegroundColor Yellow
Write-Host "op een aparte branch (bijv. lyra-before-results-$RunId), zodat de sessie de resultaten kan inlezen." -ForegroundColor Yellow

# ── 9. Terug naar de vorige branch ───────────────────────────────────────────
if (-not $BlijfOpBaseline) {
  Write-Stap "Terug naar branch '$vorigeBranch'"
  git checkout $vorigeBranch 2>&1 | Write-Host
}

if ($verificatie.status -ne "PASS") { exit 1 }
exit 0
