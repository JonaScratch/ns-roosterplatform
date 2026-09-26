@echo off
setlocal enabledelayedexpansion
title Lyra Demo Room
cd /d "%~dp0\.."

echo ============================================
echo   Lyra Demo Room - starten
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [FOUT] Node.js is niet gevonden. Installeer Node.js 20 of hoger en probeer opnieuw.
  echo Zie: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [FOUT] node_modules ontbreekt. Draai eerst: npm install
  pause
  exit /b 1
)

if not exist ".env" (
  echo [FOUT] .env ontbreekt. Kopieer .env.example naar .env en vul in:
  echo   - SESSION_SECRET
  echo   - NS_LOCAL_LLM_URL / NS_LOCAL_LLM_MODEL  ^(Ollama^)
  echo   - DEMO_ROOM_ACTOR_EMPLOYEE_NUMBER
  pause
  exit /b 1
)

echo Controleren of de database bereikbaar is...
call npx tsx --conditions=react-server scripts/dev-db.ts status
if errorlevel 1 (
  echo.
  echo [FOUT] De ontwikkeldatabase draait niet. Start hem met: npm run db:up
  pause
  exit /b 1
)

echo.
echo Controleren of Ollama bereikbaar is...
curl -s -o nul -w "%%{http_code}" http://127.0.0.1:11434/v1/models > "%TEMP%\demoroom_ollama_status.txt" 2>nul
set /p OLLAMA_STATUS=<"%TEMP%\demoroom_ollama_status.txt"
del "%TEMP%\demoroom_ollama_status.txt" >nul 2>nul
if not "%OLLAMA_STATUS%"=="200" (
  echo [WAARSCHUWING] Ollama lijkt niet bereikbaar op http://127.0.0.1:11434.
  echo Start Ollama ^(ollama serve^) voordat je een echte run start.
  echo Het dashboard start wel gewoon door, maar een run zal falen zonder lokaal model.
  echo.
)

echo.
echo Demo Room-dashboard starten op http://localhost:4173 ...
start "" http://localhost:4173
call npx tsx demo-room/src/server.ts

pause
