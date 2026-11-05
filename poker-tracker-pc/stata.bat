@echo off
chcp 65001 >nul
title Покерный трекер
cd /d "%~dp0"
where python >nul 2>nul
if %errorlevel%==0 (
  python server.py
) else (
  where py >nul 2>nul
  if errorlevel 1 (
    echo Не найден Python. Установите его с https://www.python.org/downloads/ ^(галочка "Add python.exe to PATH"^) и запустите этот файл снова.
    pause
    exit /b 1
  )
  py -3 server.py
)
if errorlevel 1 pause
