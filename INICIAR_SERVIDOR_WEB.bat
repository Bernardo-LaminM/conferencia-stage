@echo off
title SERVIDOR API & WEB - CONFERENCIA DE STAGE DHL
color 0A
echo =======================================================================
echo            DHL SUPPLY CHAIN - SERVIDOR API & WEB (ALTA PERFORMANCE)
echo =======================================================================
echo.
echo Iniciando servidor Node.js com streaming rapido para computadores e tablets...
echo.

cd /d "%~dp0"

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    start http://localhost:8080
    node server.js
    goto fim
)

echo [AVISO] Node.js nao localizado no PATH. Tentando via PowerShell...
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor_web.ps1" -Path "%~dp0" -Port 8080

:fim
pause
