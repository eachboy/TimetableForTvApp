from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
import sys
import shutil
from pathlib import Path


def _resolve_db_path() -> str:
    db_path_env = os.environ.get("DB_PATH")

    if db_path_env:
        target = Path(db_path_env)
        target.parent.mkdir(parents=True, exist_ok=True)

        if not target.exists():
            bundled = _find_bundled_db()
            if bundled and bundled.exists():
                shutil.copy2(bundled, target)
                print(f"[DB] Copied bundled database from {bundled} to {target}")
            else:
                print(f"[DB] No bundled database found, fresh DB will be created at {target}")

        return f"sqlite:///{target}"

    return "sqlite:///./timetable.db"


def _find_bundled_db() -> Path | None:
    """
    Ищет шаблонную БД рядом с исполняемым файлом или в директории приложения.
    Tauri на Windows копирует resources рядом с .exe.
    Tauri также может скопировать timetable.db без расширения — проверяем оба варианта.
    """
    candidates = []

    if getattr(sys, 'frozen', False):
        exe_dir = Path(sys.executable).parent
        # Tauri кладёт resources рядом с .exe
        candidates.append(exe_dir / "timetable.db")
        candidates.append(exe_dir / "timetable")
        # Иногда Tauri кладёт resources в подпапку _up_
        candidates.append(exe_dir.parent / "timetable.db")
        # _MEIPASS — внутренний каталог PyInstaller
        if hasattr(sys, '_MEIPASS'):
            meipass = Path(sys._MEIPASS)
            candidates.append(meipass / "timetable.db")
            candidates.append(meipass / "timetable")

    # Для dev-запуска — рядом со скриптом
    candidates.append(Path(__file__).parent / "timetable.db")
    candidates.append(Path(__file__).parent / "timetable")

    for candidate in candidates:
        if candidate.exists() and candidate.stat().st_size > 0:
            print(f"[DB] Found bundled database: {candidate}")
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