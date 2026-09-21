@echo off
title Servidor de Conferencia de Stage - Cara-Cracha
cd /d "%~dp0"
pwsh.exe -ExecutionPolicy Bypass -File "iniciar_servidor.ps1"
if %ERRORLEVEL% NEQ 0 (
    powershell.exe -ExecutionPolicy Bypass -File "iniciar_servidor.ps1"
)
pause
