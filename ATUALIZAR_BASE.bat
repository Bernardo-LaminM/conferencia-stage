@echo off
title ATUALIZAR BASE - CONFERENCIA DE STAGE DHL
color 0E
echo =======================================================================
echo            DHL SUPPLY CHAIN - ATUALIZACAO DA BASE DE STAGE
echo =======================================================================
echo.
echo Processando planilhas (adhc8 / GUIA DE CONFERENCIA)...
echo.

cd /d "%~dp0"

pwsh.exe -ExecutionPolicy Bypass -Command "& '.\extrair_base.ps1' -DownloadsDir '..\' -TargetDir '.'"

if %ERRORLEVEL% NEQ 0 (
    powershell.exe -ExecutionPolicy Bypass -Command "& '.\extrair_base.ps1' -DownloadsDir '..\' -TargetDir '.'"
)

echo.
echo =======================================================================
echo Atualizacao finalizada! Pressione qualquer tecla para fechar esta janela.
echo =======================================================================
pause >nul
