@echo off
title DHL - DESATIVAR AUTOMACAO POWER BI
color 0C
echo =======================================================================
echo          DHL SUPPLY CHAIN - DESATIVAR TAREFA AGENDADA
echo =======================================================================
echo.
schtasks /delete /tn "DHL_PowerBI_Live_Sync" /f
echo.
echo Tarefa agendada removida com sucesso.
echo.
pause
