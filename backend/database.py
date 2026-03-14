from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
import sys
import shutil
from pathlib import Path


def _resolve_db_path() -> str:
    """
    Определяет путь к БД по следующей логике:
    1. Если задана переменная DB_PATH — используем её (Tauri передаёт AppData путь).
    2. Если DB_PATH не задана — fallback для локальной разработки (рядом со скриптом).

    Дополнительно: если DB_PATH задан но файл там не существует,
    ищем timetable.db рядом с исполняемым файлом (bundled БД)
    и копируем её в AppData как начальные данные.
    """
    db_path_env = os.environ.get("DB_PATH")

    if db_path_env:
        target = Path(db_path_env)
        target.parent.mkdir(parents=True, exist_ok=True)

        # Если БД в AppData ещё не существует — ищем bundled копию
        if not target.exists():
            bundled = _find_bundled_db()
            if bundled and bundled.exists():
                shutil.copy2(bundled, target)
                print(f"[DB] Copied bundled database from {bundled} to {target}")
            else:
                print(f"[DB] No bundled database found, a fresh one will be created at {target}")

        return f"sqlite:///{target}"

    # Fallback для разработки
    return "sqlite:///./timetable.db"


def _find_bundled_db() -> Path | None:
    """
    Ищет timetable.db рядом с исполняемым файлом.
    В PyInstaller-сборке exe лежит в папке установки,
    а _MEIPASS — временная папка распакованных ресурсов.
    """
    candidates = []

    # Папка рядом с exe (папка установки — здесь ищем в первую очередь)
    if getattr(sys, 'frozen', False):
        exe_dir = Path(sys.executable).parent
        candidates.append(exe_dir / "timetable.db")

    # Папка рядом со скриптом
    candidates.append(Path(__file__).parent / "timetable.db")

    for candidate in candidates:
        if candidate.exists():
            return candidate

    return None


SQLALCHEMY_DATABASE_URL = _resolve_db_path()

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    pool_pre_ping=True
)


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA synchronous = FULL")
    cursor.execute("PRAGMA journal_mode = WAL")
    cursor.execute("PRAGMA busy_timeout = 30000")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()