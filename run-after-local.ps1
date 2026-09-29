#Requires -Version 5.1
# Thin wrapper only. All real logic lives in scripts/lyra-master/run-after-local.ts
# (TypeScript, run via tsx) so it works identically on every platform and is not
# subject to PowerShell parser/encoding differences between versions.
#
# This file is pure ASCII on purpose - same reason as run-before-local.ps1.
#
# Usage:
#   .\run-after-local.ps1
#   .\run-after-local.ps1 -PreflightOnly
#   .\run-after-local.ps1 -Replicates 5
#   .\run-after-local.ps1 -SkipAdversarial
#     (runs Fase 9 + 11 only, skips Fase 12's adversarial holdout)

param(
  [int]$Replicates = 3,
  [switch]$SkipAdversarial,
  [switch]$PreflightOnly
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$scriptArgs = @("tsx", "--conditions=react-server", "scripts/lyra-master/run-after-local.ts")
$scriptArgs += "--replicates"
$scriptArgs += "$Replicates"
if ($SkipAdversarial) {
  $scriptArgs += "--skip-adversarial"
}
if ($PreflightOnly) {
  $scriptArgs += "--preflight-only"
}

& npx @scriptArgs
exit $LASTEXITCODE
