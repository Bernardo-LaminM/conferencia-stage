@echo off
title DHL RPA - INICIAR SINCRONIZADOR AUTOMATICO
color 0A
echo =======================================================================
echo     DHL SUPPLY CHAIN - INICIAR RPA (SHAREPOINT -> GITHUB PAGES)
echo =======================================================================
echo.
echo O RPA monitora o arquivo ADHOC_80.csv do SharePoint e atualiza
echo o site para todos os tablets automaticamente na nuvem.
echo.

cd /d "%~dp0"

echo [1/2] Iniciando o RPA em segundo plano (100%% invisivel)...
wscript.exe "%~dp0executar_rpa_silencioso.vbs"

echo.
echo [2/2] Registrando no Agendador do Windows para ligar com o PC...
schtasks /create /tn "DHL_RPA_Stage_Sync" /tr "wscript.exe \"%~dp0executar_rpa_silencioso.vbs\"" /sc onlogon /f >nul 2>nul

echo.
echo =======================================================================
echo               RPA ATIVADO COM SUCESSO!
echo =======================================================================
echo O robo ja esta rodando em segundo plano.
echo Voce pode acompanhar os logs no arquivo: rpa_sync.log
echo.
pause
