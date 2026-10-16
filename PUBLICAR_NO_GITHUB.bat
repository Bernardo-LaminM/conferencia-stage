@echo off
title PUBLICAR ATUALIZACOES NO GITHUB PAGES
color 0A
echo =======================================================================
echo          DHL SUPPLY CHAIN - PUBLICAR NO GITHUB PAGES (ONLINE)
echo =======================================================================
echo.
echo Enviando commits e base de dados para https://github.com/Bernardo-LaminM/conferencia-stage...
echo.

cd /d "%~dp0"
set "GIT_PATH=C:\Users\blaminma\AppData\Local\Programs\Git\cmd\git.exe"

"%GIT_PATH%" push origin main

echo.
if %ERRORLEVEL% EQU 0 (
    echo =======================================================================
    echo  PUBLICACAO CONCLUIDA COM SUCESSO!
    echo  Acesse nos tablets: https://bernardo-laminm.github.io/conferencia-stage/index.html
    echo =======================================================================
) else (
    echo [ERRO] O push nao foi concluido. Verifique se o GitHub pediu login.
)
echo.
pause
