@echo off
echo ========================================
echo Запуск backend сервера
echo ========================================
echo.

REM Проверка наличия исполняемого файла
if not exist "dist\backend.exe" (
    echo ОШИБКА: Исполняемый файл не найден!
    echo Сначала выполните сборку: build.bat
    pause
    exit /b 1
)

REM Запуск сервера
echo Запуск сервера на http://localhost:8000
echo Для остановки нажмите Ctrl+C
echo.
dist\backend.exe

pause
