"""
Система миграций базы данных.

Логика работы:
- При каждом запуске приложения вызывается run_migrations().
- Каждая миграция имеет уникальный номер версии.
- Уже применённые миграции пропускаются (хранятся в таблице schema_version).
- Это позволяет обновлять приложение без потери данных:
  существующие строки остаются, новые колонки/таблицы добавляются безопасно.
"""

import logging
from sqlalchemy import text
from database import engine

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Список миграций. Каждая миграция — кортеж (version: int, description: str, sql: str).
# Добавляйте новые миграции В КОНЕЦ СПИСКА, никогда не изменяйте существующие.
# ─────────────────────────────────────────────────────────────────────────────
MIGRATIONS = [
    # Версия 1: начальная схема создаётся через SQLAlchemy create_all,
    # эта запись просто фиксирует факт первого запуска.
    (1, "Initial schema baseline", "SELECT 1"),

    # Пример добавления колонки в будущем:
    # (2, "Add display_name to teachers",
    #  "ALTER TABLE teachers ADD COLUMN display_name TEXT"),
    #
    # Пример добавления новой таблицы:
    # (3, "Create announcements table", """
    #  CREATE TABLE IF NOT EXISTS announcements (
    #      id INTEGER PRIMARY KEY AUTOINCREMENT,
    #      text TEXT NOT NULL,
    #      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    #  )
    # """),
]


def _ensure_version_table(conn):
    """Создаёт таблицу schema_version если её ещё нет."""
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS schema_version (
            version     INTEGER PRIMARY KEY,
            description TEXT    NOT NULL,
            applied_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """))
    conn.commit()


def _get_applied_versions(conn) -> set:
    """Возвращает множество уже применённых версий миграций."""
    rows = conn.execute(text("SELECT version FROM schema_version")).fetchall()
    return {row[0] for row in rows}


def run_migrations():
    """
    Применяет все ещё не применённые миграции.
    Вызывать один раз при старте приложения — до create_all.
    """
    with engine.connect() as conn:
        _ensure_version_table(conn)
        applied = _get_applied_versions(conn)

        for version, description, sql in MIGRATIONS:
            if version in applied:
                continue

            logger.info(f"Applying migration v{version}: {description}")
            try:
                # Поддержка многострочных миграций (несколько SQL-выражений)
                for statement in sql.strip().split(";"):
                    statement = statement.strip()
                    if statement:
                        conn.execute(text(statement))

                conn.execute(
                    text("INSERT INTO schema_version (version, description) VALUES (:v, :d)"),
                    {"v": version, "d": description}
                )
                conn.commit()
                logger.info(f"Migration v{version} applied successfully")
            except Exception as e:
                conn.rollback()
                logger.error(f"Migration v{version} FAILED: {e}")
                raise RuntimeError(f"Database migration v{version} failed: {e}") from e

    logger.info("All migrations up to date")