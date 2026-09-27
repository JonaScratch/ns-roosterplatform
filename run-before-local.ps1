#Requires -Version 5.1
# Thin wrapper only. All real logic lives in scripts/lyra-master/run-before-local.ts
# (TypeScript, run via tsx) so it works identically on every platform and is not
# subject to PowerShell parser/encoding differences between versions.
#
# This file is pure ASCII on purpose. A previous version mixed Dutch text with
# em-dashes and other non-ASCII characters directly into this script; under
# Windows PowerShell 5.1, a .ps1 file without a byte-order mark can be read
# using the system's ANSI code page instead of UTF-8, which can corrupt a
# multi-byte character inside a string literal and cascade into false
# "missing closing brace" parse errors. Keeping this wrapper ASCII-only and
# letting TypeScript (always read as UTF-8 by Node) do the real work avoids
# that failure mode entirely, regardless of the machine's code page.
#
# Usage:
#   .\run-before-local.ps1
#   .\run-before-local.ps1 -PreflightOnly
#   .\run-before-local.ps1 -Replicates 5

param(
  [int]$Replicates = 3,
  [string]$Baseline = "588c1e5",
  [string]$SubjectPath = "",
  [switch]$PreflightOnly
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$scriptArgs = @("tsx", "--conditions=react-server", "scripts/lyra-master/run-before-local.ts")
$scriptArgs += "--replicates"
$scriptArgs += "$Replicates"
$scriptArgs += "--baseline"
$scriptArgs += "$Baseline"
if ($SubjectPath -ne "") {
  $scriptArgs += "--subject-path"
  $scriptArgs += "$SubjectPath"
}
if ($PreflightOnly) {
  $scriptArgs += "--preflight-only"
}

& npx @scriptArgs
exit $LASTEXITCODE
