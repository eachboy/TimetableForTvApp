from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from pathlib import Path

SQLALCHEMY_DATABASE_URL = "sqlite:///./timetable.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, 
    connect_args={"check_same_thread": False},
    pool_pre_ping=True  # Проверка соединений перед использованием
)

# Настраиваем SQLite для надежного сохранения данных
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_conn, connection_record):
    """Устанавливает настройки SQLite для надежного сохранения"""
    cursor = dbapi_conn.cursor()
    # FULL синхронизация - гарантирует, что данные записаны на диск
    cursor.execute("PRAGMA synchronous = FULL")
    # WAL режим для лучшей производительности и надежности
    cursor.execute("PRAGMA journal_mode = WAL")
    # Увеличиваем таймаут для блокировок
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

