@echo off
REM Thin wrapper only. All real logic lives in scripts\lyra-master\run-before-local.ts
REM (TypeScript, run via tsx). See run-before-local.ps1 for why: this file stays
REM pure ASCII and minimal on purpose, to avoid any encoding/parser surprises.
REM
REM Usage:
REM   run-before-local.cmd
REM   run-before-local.cmd --preflight-only
REM   run-before-local.cmd --replicates 5

cd /d "%~dp0"
npx tsx --conditions=react-server scripts/lyra-master/run-before-local.ts %*
exit /b %ERRORLEVEL%
