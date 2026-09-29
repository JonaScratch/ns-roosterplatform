@echo off
REM Thin wrapper only. All real logic lives in scripts\lyra-master\run-after-local.ts
REM (TypeScript, run via tsx). See run-after-local.ps1 for why: this file stays
REM pure ASCII and minimal on purpose, to avoid any encoding/parser surprises.
REM
REM Usage:
REM   run-after-local.cmd
REM   run-after-local.cmd --preflight-only
REM   run-after-local.cmd --replicates 5
REM   run-after-local.cmd --skip-adversarial

cd /d "%~dp0"
npx tsx --conditions=react-server scripts/lyra-master/run-after-local.ts %*
exit /b %ERRORLEVEL%
