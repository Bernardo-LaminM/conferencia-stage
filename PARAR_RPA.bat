@echo off
title DHL RPA - PARAR SINCRONIZADOR AUTOMATICO
color 0C
echo =======================================================================
echo     DHL SUPPLY CHAIN - PARAR RPA (SHAREPOINT -> GITHUB PAGES)
echo =======================================================================
echo.

taskkill /f /im node.exe /fi "WINDOWTITLE eq *" >nul 2>nul
schtasks /delete /tn "DHL_RPA_Stage_Sync" /f >nul 2>nul

echo.
echo Robô RPA finalizado e tarefa agendada removida.
echo.
pause
