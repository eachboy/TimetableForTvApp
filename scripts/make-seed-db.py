"""Делает чистую seed-БД из любой существующей: схема остаётся, все данные удаляются,
создаётся один аккаунт для первого входа.

    python scripts/make-seed-db.py <исходная.db> <результат.db> [логин] [пароль]

По умолчанию логин/пароль: admin / admin — смените пароль в панели после первого входа.
Требуется: pip install bcrypt
"""
import shutil
import sqlite3
import sys

import bcrypt

src, dst = sys.argv[1], sys.argv[2]
username = sys.argv[3] if len(sys.argv) > 3 else "admin"
password = sys.argv[4] if len(sys.argv) > 4 else "admin"

shutil.copyfile(src, dst)
conn = sqlite3.connect(dst)
conn.execute("PRAGMA journal_mode = DELETE")

tables = [r[0] for r in conn.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]
for t in tables:
    if t != "schema_version":  # версия схемы нужна для миграций
        conn.execute(f'DELETE FROM "{t}"')
if conn.execute("SELECT name FROM sqlite_master WHERE name = 'sqlite_sequence'").fetchone():
    conn.execute("DELETE FROM sqlite_sequence")

# приложение режет пароль до 72 байт (ограничение bcrypt) — тот же формат хэша ($2b$, cost 12)
hashed = bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt(12)).decode()
conn.execute("INSERT INTO accounts (username, password_hash) VALUES (?, ?)", (username, hashed))
conn.commit()
conn.execute("VACUUM")
conn.close()
print(f"{dst}: схема сохранена, данные очищены, аккаунт '{username}' создан")
