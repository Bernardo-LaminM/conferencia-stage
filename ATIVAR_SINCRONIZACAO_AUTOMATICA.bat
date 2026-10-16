@echo off
title DHL - ATIVAR AUTOMACAO POWER BI EM SEGUNDO PLANO
color 0A
echo =======================================================================
echo          DHL SUPPLY CHAIN - AUTOMACAO CONTINUA POWER BI LIVE
echo =======================================================================
echo.
echo Este script configura o Windows para atualizar a base da AD HOC 80
echo automaticamente a cada 15 minutos em segundo plano (100%% invisivel).
echo.

cd /d "%~dp0"
set "TARGET_DIR=%~dp0"
set "VBS_PATH=%TARGET_DIR%executar_sync_silencioso.vbs"

echo [1/3] Testando conexao inicial com o Power BI...
pwsh.exe -NoProfile -ExecutionPolicy Bypass -Command "& '%TARGET_DIR%atualizar_powerbi.ps1' -OutputDir '%TARGET_DIR%'"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERRO] Falha no teste inicial de conexao. Verifique suas credenciais.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [2/3] Registrando Tarefa Agendada no Windows (A cada 15 minutos)...
schtasks /create /tn "DHL_PowerBI_Live_Sync" /tr "wscript.exe \"%VBS_PATH%\"" /sc minute /mo 15 /f

echo.
echo [3/3] Sincronizando com a pasta oficial...
if exist "C:\Users\blaminma\Downloads\Conferencia_Stage_Oficial" (
    copy /y "%TARGET_DIR%stage_data.js" "C:\Users\blaminma\Downloads\Conferencia_Stage_Oficial\stage_data.js" >nul
    copy /y "%TARGET_DIR%stage_data.json" "C:\Users\blaminma\Downloads\Conferencia_Stage_Oficial\stage_data.json" >nul
)

echo.
echo =======================================================================
echo              AUTOMACAO ATIVADA COM SUCESSO!
echo =======================================================================
echo A partir de agora, o Windows atualizara a base da AD HOC 80 sozinho
echo a cada 15 minutos em segundo plano, sem que voce precise abrir nada!
echo.
pause
