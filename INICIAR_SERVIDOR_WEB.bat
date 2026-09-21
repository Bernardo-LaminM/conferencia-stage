@echo off
title SERVIDOR WEB - CONFERENCIA DE STAGE DHL
color 0A
echo =======================================================================
echo            DHL SUPPLY CHAIN - SERVIDOR WEB LOCAL / WI-FI
echo =======================================================================
echo.
echo Iniciando servidor web para testes no computador e coletores...
echo.

cd /d "%~dp0"

set "TARGET_DIR=%~dp0"
if exist "%~dp0Conferencia_Stage\index.html" set "TARGET_DIR=%~dp0Conferencia_Stage"
if exist "%~dp0index.html" set "TARGET_DIR=%~dp0"

echo Pasta identificada: %TARGET_DIR%
echo.

pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%TARGET_DIR%\servidor_web.ps1" -Path "%TARGET_DIR%" -Port 8080

if %ERRORLEVEL% NEQ 0 (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TARGET_DIR%\servidor_web.ps1" -Path "%TARGET_DIR%" -Port 8080
)

pause
