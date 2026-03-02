# Timetable Admin Panel Backend

FastAPI бэкенд для админ-панели расписания.

## Установка

1. Создайте виртуальное окружение (если еще не создано):
```bash
python -m venv venv
```

2. Активируйте виртуальное окружение:
- Windows:
```bash
venv\Scripts\activate
```
- Linux/Mac:
```bash
source venv/bin/activate
```

3. Установите зависимости:
```bash
pip install -r requirements.txt
```

## Запуск

Запустите сервер с помощью uvicorn:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Сервер будет доступен по адресу: http://localhost:8000

## API Документация

После запуска сервера доступна интерактивная документация:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Endpoints

### Преподаватели
- `GET /api/teachers` - получить список преподавателей
- `POST /api/teachers` - создать преподавателя
- `DELETE /api/teachers/{id}` - удалить преподавателя

### Новости
- `GET /api/news` - получить список новостей
- `POST /api/news` - создать новость
- `DELETE /api/news/{id}` - удалить новость

### Медиа
- `GET /api/media` - получить список медиа файлов
- `POST /api/media` - загрузить медиа файл
- `DELETE /api/media/{id}` - удалить медиа файл

### Кабинеты
- `GET /api/rooms` - получить список кабинетов
- `POST /api/rooms` - создать кабинет
- `DELETE /api/rooms/{id}` - удалить кабинет

### Расписание
- `GET /api/schedule` - получить расписание (с фильтрами)
- `POST /api/schedule` - создать запись в расписании
- `PUT /api/schedule/{id}` - обновить запись в расписании
- `DELETE /api/schedule/{id}` - удалить запись из расписания

## База данных

Используется SQLite база данных `timetable.db`, которая создается автоматически при первом запуске.

## Сборка с PyInstaller

Для создания исполняемого файла (exe) используйте PyInstaller:

1. Убедитесь, что все зависимости установлены:
```bash
pip install -r requirements.txt
```

2. Запустите скрипт сборки:
```bash
build.bat
```

3. После успешной сборки исполняемый файл будет находиться в папке `dist\backend.exe`

4. Для запуска собранного приложения:
```bash
run_backend.bat
```

Или запустите напрямую:
```bash
dist\backend.exe
```

**Примечания:**
- База данных `timetable.db` будет создана в той же директории, где находится исполняемый файл
- Директория `media` для загруженных файлов также будет создана автоматически рядом с exe файлом
- Сервер будет доступен по адресу: http://localhost:8000

## Структура проекта

```
backend/
├── main.py          # Основной файл FastAPI приложения
├── database.py      # Настройка базы данных
├── models.py        # SQLAlchemy модели
├── schemas.py       # Pydantic схемы для валидации
├── run_server.py    # Скрипт запуска для собранного приложения
├── requirements.txt # Зависимости
├── backend.spec     # Конфигурация PyInstaller
├── build.bat        # Скрипт сборки
├── run_backend.bat  # Скрипт запуска собранного приложения
└── media/           # Директория для загруженных медиа файлов (создается автоматически)
```

