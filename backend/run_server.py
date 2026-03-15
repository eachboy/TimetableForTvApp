"""
Скрипт запуска сервера для собранного приложения PyInstaller
"""
import uvicorn
import sys
import os

if __name__ == "__main__":
    # Определяем путь к main.py относительно текущего файла
    # В собранном приложении это будет _MEIPASS директория
    if getattr(sys, 'frozen', False):
        # Если приложение собрано в exe
        application_path = sys._MEIPASS
    else:
        # Если запускается как скрипт
        application_path = os.path.dirname(os.path.abspath(__file__))

    # Устанавливаем рабочую директорию и добавляем в sys.path,
    # чтобы uvicorn мог импортировать main, database, models, schemas, migrate
    os.chdir(application_path)
    if application_path not in sys.path:
        sys.path.insert(0, application_path)

    # Запускаем uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )