"""
Скрипт запуска сервера для собранного приложения PyInstaller
"""
import uvicorn
import sys
import os

if __name__ == "__main__":
    # Определяем путь к main.py относительно текущего файла
    # В собранном приложении это будет _internal директория
    if getattr(sys, 'frozen', False):
        # Если приложение собрано в exe
        application_path = sys._MEIPASS
    else:
        # Если запускается как скрипт
        application_path = os.path.dirname(os.path.abspath(__file__))
    
    # Запускаем uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )
