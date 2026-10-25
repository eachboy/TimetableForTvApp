//! Локальная SQLite БД для приложения Timetable (тот же формат, что и Python-бэкенд).

use chrono::{Datelike, TimeZone};
use rusqlite::{Connection, params, OptionalExtension};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;

/// Состояние БД: путь к файлу и к папке медиа.
pub struct DbState {
    pub db_path: std::path::PathBuf,
    pub media_dir: std::path::PathBuf,
}

lazy_static::lazy_static! {
    static ref DB_STATE: Mutex<Option<DbState>> = Mutex::new(None);
}

pub fn init(db_path: &Path, media_dir: &Path) -> Result<(), String> {
    ensure_tables(db_path)?;
    let mut state = DB_STATE.lock().unwrap();
    *state = Some(DbState {
        db_path: db_path.to_path_buf(),
        media_dir: media_dir.to_path_buf(),
    });
    Ok(())
}

/// Создаёт таблицы, если их ещё нет (совместимо со схемой Python-бэкенда).
fn ensure_tables(db_path: &Path) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS teachers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS news (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT,
            published_at TEXT DEFAULT CURRENT_TIMESTAMP,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_type TEXT,
            file_size INTEGER,
            uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            number TEXT UNIQUE NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS schedule_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER NOT NULL REFERENCES rooms(id),
            teacher_id INTEGER NOT NULL REFERENCES teachers(id),
            subject TEXT NOT NULL,
            groups TEXT NOT NULL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            week_type TEXT NOT NULL,
            class_number INTEGER NOT NULL,
            day_of_week INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            description TEXT NOT NULL,
            applied_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS system_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cpu_percent REAL NOT NULL,
            memory_percent REAL NOT NULL,
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            read INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        ",
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn with_conn<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, rusqlite::Error>,
{
    let state = DB_STATE.lock().unwrap();
    let db_path = state
        .as_ref()
        .ok_or_else(|| "DB not initialized".to_string())?
        .db_path
        .clone();
    drop(state);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA synchronous = FULL; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 30000;",
    )
    .map_err(|e| e.to_string())?;
    f(&conn).map_err(|e| e.to_string())
}

fn media_dir() -> Result<std::path::PathBuf, String> {
    let state = DB_STATE.lock().unwrap();
    state
        .as_ref()
        .ok_or_else(|| "DB not initialized".to_string())
        .map(|s| s.media_dir.clone())
}

/// Читает колонку как Option<String> и возвращает строку (для nullable дат в SQLite).
fn opt_datetime(row: &rusqlite::Row, idx: usize) -> Result<String, rusqlite::Error> {
    row.get::<_, Option<String>>(idx).map(|o| o.unwrap_or_else(|| "1970-01-01 00:00:00".to_string()))
}

// ─── Модели ответов (совместимы с API бэкенда) ─────────────────────────────

#[derive(Debug, Serialize)]
pub struct MediaRow {
    pub id: i64,
    pub name: String,
    pub file_path: String,
    pub file_type: Option<String>,
    pub file_size: Option<i64>,
    pub uploaded_at: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct NewsRow {
    pub id: i64,
    pub title: String,
    pub content: Option<String>,
    pub published_at: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct RoomRow {
    pub id: i64,
    pub number: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct TeacherRow {
    pub id: i64,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct ScheduleItemRow {
    pub id: i64,
    pub room_id: i64,
    pub teacher_id: i64,
    pub subject: String,
    pub groups: String,
    pub start_date: String,
    pub end_date: String,
    pub week_type: String,
    pub class_number: i64,
    pub day_of_week: i64,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub room: Option<RoomRow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub teacher: Option<TeacherRow>,
}

// ─── Запросы ──────────────────────────────────────────────────────────────

pub fn get_media(skip: i64, limit: i64) -> Result<Vec<MediaRow>, String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, file_path, file_type, file_size, uploaded_at, created_at
             FROM media ORDER BY uploaded_at DESC LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt.query_map(params![limit, skip], |row| {
            Ok(MediaRow {
                id: row.get(0)?,
                name: row.get(1)?,
                file_path: row.get(2)?,
                file_type: row.get(3)?,
                file_size: row.get(4)?,
                uploaded_at: opt_datetime(&row, 5)?,
                created_at: opt_datetime(&row, 6)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
    })
}

/// Возвращает абсолютный путь к файлу медиа для convertFileSrc, или None.
pub fn get_media_file_path(media_id: i64) -> Result<Option<std::path::PathBuf>, String> {
    let path_opt: Option<String> = with_conn(|conn| {
        let path: Option<String> = conn
            .query_row(
                "SELECT file_path FROM media WHERE id = ?1",
                params![media_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(path)
    })?;
    let path_str = match path_opt {
        Some(p) => p,
        None => return Ok(None),
    };
    let path = Path::new(&path_str);
    if path.is_absolute() && path.exists() {
        return Ok(Some(path.to_path_buf()));
    }
    let base = media_dir()?;
    // Пробуем путь как есть (относительный)
    let full = base.join(&path_str);
    if full.exists() {
        return Ok(Some(full));
    }
    // Иначе только имя файла (БД могла быть скопирована с другой машины с другими путями)
    if let Some(name) = path.file_name() {
        let by_name = base.join(name);
        if by_name.exists() {
            return Ok(Some(by_name));
        }
    }
    Ok(Some(path.to_path_buf()))
}

pub fn get_news(skip: i64, limit: i64) -> Result<Vec<NewsRow>, String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, title, content, published_at, created_at
             FROM news ORDER BY published_at DESC LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt.query_map(params![limit, skip], |row| {
            Ok(NewsRow {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                published_at: opt_datetime(&row, 3)?,
                created_at: opt_datetime(&row, 4)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
    })
}

pub fn get_rooms(skip: i64, limit: i64) -> Result<Vec<RoomRow>, String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, number, created_at FROM rooms ORDER BY id LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt.query_map(params![limit, skip], |row| {
            Ok(RoomRow {
                id: row.get(0)?,
                number: row.get(1)?,
                created_at: opt_datetime(&row, 2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
    })
}

pub fn get_schedule(
    room_id: Option<i64>,
    teacher_id: Option<i64>,
    day_of_week: Option<i64>,
    skip: i64,
    limit: i64,
) -> Result<Vec<ScheduleItemRow>, String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT s.id, s.room_id, s.teacher_id, s.subject, s.groups, s.start_date, s.end_date,
                    s.week_type, s.class_number, s.day_of_week, s.created_at,
                    r.id, r.number, r.created_at,
                    t.id, t.name, t.created_at
             FROM schedule_items s
             LEFT JOIN rooms r ON s.room_id = r.id
             LEFT JOIN teachers t ON s.teacher_id = t.id
             WHERE (?1 IS NULL OR s.room_id = ?1)
               AND (?2 IS NULL OR s.teacher_id = ?2)
               AND (?3 IS NULL OR s.day_of_week = ?3)
             ORDER BY s.day_of_week, s.class_number
             LIMIT ?4 OFFSET ?5",
        )?;
        let rows = stmt.query_map(
            params![room_id, teacher_id, day_of_week, limit, skip],
            |row| {
                let room = Some(RoomRow {
                    id: row.get(11)?,
                    number: row.get(12)?,
                    created_at: opt_datetime(&row, 13)?,
                });
                let teacher = Some(TeacherRow {
                    id: row.get(14)?,
                    name: row.get(15)?,
                    created_at: opt_datetime(&row, 16)?,
                });
                Ok(ScheduleItemRow {
                    id: row.get(0)?,
                    room_id: row.get(1)?,
                    teacher_id: row.get(2)?,
                    subject: row.get(3)?,
                    groups: row.get(4)?,
                    start_date: row.get(5)?,
                    end_date: row.get(6)?,
                    week_type: row.get(7)?,
                    class_number: row.get(8)?,
                    day_of_week: row.get(9)?,
                    created_at: opt_datetime(&row, 10)?,
                    room,
                    teacher,
                })
            },
        )?;
        rows.collect::<Result<Vec<_>, _>>()
    })
}

/// Следующие пары: сегодня и позже, с джойнами room/teacher.
pub fn get_schedule_upcoming(limit: i64) -> Result<Vec<ScheduleItemRow>, String> {
    with_conn(|conn| {
        // Текущая дата в формате SQLite (YYYY-MM-DD)
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let current_dow = chrono::Local::now().weekday().num_days_from_monday() as i64; // 0-6, понедельник=0

        let mut stmt = conn.prepare(
            "SELECT s.id, s.room_id, s.teacher_id, s.subject, s.groups, s.start_date, s.end_date,
                    s.week_type, s.class_number, s.day_of_week, s.created_at,
                    r.id, r.number, r.created_at,
                    t.id, t.name, t.created_at
             FROM schedule_items s
             LEFT JOIN rooms r ON s.room_id = r.id
             LEFT JOIN teachers t ON s.teacher_id = t.id
             WHERE s.start_date <= ?1 AND s.end_date >= ?1 AND s.day_of_week >= ?2
             ORDER BY s.day_of_week, s.class_number
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![today, current_dow, limit], |row| {
            let room = Some(RoomRow {
                id: row.get(11)?,
                number: row.get(12)?,
                created_at: opt_datetime(&row, 13)?,
            });
            let teacher = Some(TeacherRow {
                id: row.get(14)?,
                name: row.get(15)?,
                created_at: opt_datetime(&row, 16)?,
            });
            Ok(ScheduleItemRow {
                id: row.get(0)?,
                room_id: row.get(1)?,
                teacher_id: row.get(2)?,
                subject: row.get(3)?,
                groups: row.get(4)?,
                start_date: row.get(5)?,
                end_date: row.get(6)?,
                week_type: row.get(7)?,
                class_number: row.get(8)?,
                day_of_week: row.get(9)?,
                created_at: opt_datetime(&row, 10)?,
                room,
                teacher,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
    })
}

// ─── Teachers (list + CRUD) ──────────────────────────────────────────────────
pub fn get_teachers(skip: i64, limit: i64) -> Result<Vec<TeacherRow>, String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, created_at FROM teachers ORDER BY id LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt.query_map(params![limit, skip], |row| {
            Ok(TeacherRow {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: opt_datetime(&row, 2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
    })
}

pub fn create_teacher(name: &str) -> Result<TeacherRow, String> {
    with_conn(|conn| {
        conn.execute("INSERT INTO teachers (name) VALUES (?1)", params![name])?;
        let id = conn.last_insert_rowid();
        let mut stmt = conn.prepare("SELECT id, name, created_at FROM teachers WHERE id = ?1")?;
        stmt.query_row(params![id], |row| {
            Ok(TeacherRow {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: opt_datetime(&row, 2)?,
            })
        })
    })
}

pub fn delete_teacher(id: i64) -> Result<(), String> {
    with_conn(|conn| {
        let n = conn.execute("DELETE FROM teachers WHERE id = ?1", params![id])?;
        if n == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        Ok(())
    })
}

// ─── News CRUD ───────────────────────────────────────────────────────────────
pub fn create_news(title: &str, content: Option<&str>) -> Result<NewsRow, String> {
    with_conn(|conn| {
        conn.execute(
            "INSERT INTO news (title, content, published_at, created_at) VALUES (?1, ?2, datetime('now', 'localtime'), datetime('now', 'localtime'))",
            params![title, content],
        )?;
        let id = conn.last_insert_rowid();
        let mut stmt =
            conn.prepare("SELECT id, title, content, published_at, created_at FROM news WHERE id = ?1")?;
        stmt.query_row(params![id], |row| {
            Ok(NewsRow {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                published_at: opt_datetime(&row, 3)?,
                created_at: opt_datetime(&row, 4)?,
            })
        })
    })
}

pub fn delete_news(id: i64) -> Result<(), String> {
    with_conn(|conn| {
        let n = conn.execute("DELETE FROM news WHERE id = ?1", params![id])?;
        if n == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        Ok(())
    })
}

// ─── Rooms CRUD ──────────────────────────────────────────────────────────────
pub fn create_room(number: &str) -> Result<RoomRow, String> {
    with_conn(|conn| {
        conn.execute("INSERT INTO rooms (number) VALUES (?1)", params![number])?;
        let id = conn.last_insert_rowid();
        let mut stmt = conn.prepare("SELECT id, number, created_at FROM rooms WHERE id = ?1")?;
        stmt.query_row(params![id], |row| {
            Ok(RoomRow {
                id: row.get(0)?,
                number: row.get(1)?,
                created_at: opt_datetime(&row, 2)?,
            })
        })
    })
}

pub fn delete_room(id: i64) -> Result<(), String> {
    with_conn(|conn| {
        let n = conn.execute("DELETE FROM rooms WHERE id = ?1", params![id])?;
        if n == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        Ok(())
    })
}

// ─── Schedule CRUD ───────────────────────────────────────────────────────────
fn fetch_schedule_item_by_id(conn: &Connection, id: i64) -> Result<ScheduleItemRow, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.room_id, s.teacher_id, s.subject, s.groups, s.start_date, s.end_date,
                s.week_type, s.class_number, s.day_of_week, s.created_at,
                r.id, r.number, r.created_at,
                t.id, t.name, t.created_at
         FROM schedule_items s
         LEFT JOIN rooms r ON s.room_id = r.id
         LEFT JOIN teachers t ON s.teacher_id = t.id
         WHERE s.id = ?1",
    )?;
    stmt.query_row(params![id], |row| {
        let room = Some(RoomRow {
            id: row.get(11)?,
            number: row.get(12)?,
            created_at: opt_datetime(&row, 13)?,
        });
        let teacher = Some(TeacherRow {
            id: row.get(14)?,
            name: row.get(15)?,
            created_at: opt_datetime(&row, 16)?,
        });
        Ok(ScheduleItemRow {
            id: row.get(0)?,
            room_id: row.get(1)?,
            teacher_id: row.get(2)?,
            subject: row.get(3)?,
            groups: row.get(4)?,
            start_date: row.get(5)?,
            end_date: row.get(6)?,
            week_type: row.get(7)?,
            class_number: row.get(8)?,
            day_of_week: row.get(9)?,
            created_at: opt_datetime(&row, 10)?,
            room,
            teacher,
        })
    })
}

pub fn create_schedule_item(
    room_id: i64,
    teacher_id: i64,
    subject: &str,
    groups: &str,
    start_date: &str,
    end_date: &str,
    week_type: &str,
    class_number: i64,
    day_of_week: i64,
) -> Result<ScheduleItemRow, String> {
    with_conn(|conn| {
        conn.execute(
            "INSERT INTO schedule_items (room_id, teacher_id, subject, groups, start_date, end_date, week_type, class_number, day_of_week) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                room_id, teacher_id, subject, groups, start_date, end_date, week_type,
                class_number, day_of_week
            ],
        )?;
        let id = conn.last_insert_rowid();
        fetch_schedule_item_by_id(conn, id)
    })
}

pub fn update_schedule_item(
    id: i64,
    room_id: i64,
    teacher_id: i64,
    subject: &str,
    groups: &str,
    start_date: &str,
    end_date: &str,
    week_type: &str,
    class_number: i64,
    day_of_week: i64,
) -> Result<ScheduleItemRow, String> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE schedule_items SET room_id=?1, teacher_id=?2, subject=?3, groups=?4, start_date=?5, end_date=?6, week_type=?7, class_number=?8, day_of_week=?9 WHERE id=?10",
            params![
                room_id, teacher_id, subject, groups, start_date, end_date, week_type,
                class_number, day_of_week, id
            ],
        )?;
        fetch_schedule_item_by_id(conn, id)
    })
}

pub fn delete_schedule_item(id: i64) -> Result<(), String> {
    with_conn(|conn| {
        let n = conn.execute("DELETE FROM schedule_items WHERE id = ?1", params![id])?;
        if n == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        Ok(())
    })
}

// ─── Media CRUD ──────────────────────────────────────────────────────────────
pub fn create_media(
    name: &str,
    file_path: &str,
    file_type: Option<&str>,
    file_size: Option<i64>,
) -> Result<MediaRow, String> {
    with_conn(|conn| {
        conn.execute(
            "INSERT INTO media (name, file_path, file_type, file_size, uploaded_at, created_at) VALUES (?1, ?2, ?3, ?4, datetime('now', 'localtime'), datetime('now', 'localtime'))",
            params![name, file_path, file_type, file_size],
        )?;
        let id = conn.last_insert_rowid();
        let mut stmt = conn.prepare(
            "SELECT id, name, file_path, file_type, file_size, uploaded_at, created_at FROM media WHERE id = ?1",
        )?;
        stmt.query_row(params![id], |row| {
            Ok(MediaRow {
                id: row.get(0)?,
                name: row.get(1)?,
                file_path: row.get(2)?,
                file_type: row.get(3)?,
                file_size: row.get(4)?,
                uploaded_at: opt_datetime(&row, 5)?,
                created_at: opt_datetime(&row, 6)?,
            })
        })
    })
}

pub fn delete_media(id: i64) -> Result<String, String> {
    let path_opt: Option<String> = with_conn(|conn| {
        conn.query_row("SELECT file_path FROM media WHERE id = ?1", params![id], |row| row.get(0))
            .optional()
    })?;
    with_conn(|conn| {
        let n = conn.execute("DELETE FROM media WHERE id = ?1", params![id])?;
        if n == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        Ok(())
    })?;
    Ok(path_opt.unwrap_or_default())
}

// ─── Accounts & Auth ─────────────────────────────────────────────────────────
#[derive(Debug, serde::Deserialize, Serialize)]
pub struct AccountRow {
    pub id: i64,
    pub username: String,
    pub created_at: String,
}

pub fn get_accounts(skip: i64, limit: i64) -> Result<Vec<AccountRow>, String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, username, created_at FROM accounts ORDER BY id LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt.query_map(params![limit, skip], |row| {
            Ok(AccountRow {
                id: row.get(0)?,
                username: row.get(1)?,
                created_at: opt_datetime(&row, 2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
    })
}

pub fn get_account_by_id(id: i64) -> Result<Option<AccountRow>, String> {
    with_conn(|conn| {
        conn.query_row(
            "SELECT id, username, created_at FROM accounts WHERE id = ?1",
            params![id],
            |row| {
                Ok(AccountRow {
                    id: row.get(0)?,
                    username: row.get(1)?,
                    created_at: opt_datetime(&row, 2)?,
                })
            },
        )
        .optional()
    })
}

pub fn get_account_by_username(username: &str) -> Result<Option<(AccountRow, String)>, String> {
    with_conn(|conn| {
        conn.query_row(
            "SELECT id, username, created_at, password_hash FROM accounts WHERE LOWER(username) = LOWER(?1)",
            params![username],
            |row| {
                Ok((
                    AccountRow {
                        id: row.get(0)?,
                        username: row.get(1)?,
                        created_at: opt_datetime(&row, 2)?,
                    },
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
    })
}

pub fn create_account(username: &str, password_hash: &str) -> Result<AccountRow, String> {
    with_conn(|conn| {
        conn.execute(
            "INSERT INTO accounts (username, password_hash) VALUES (?1, ?2)",
            params![username, password_hash],
        )?;
        let id = conn.last_insert_rowid();
        let mut stmt = conn.prepare("SELECT id, username, created_at FROM accounts WHERE id = ?1")?;
        stmt.query_row(params![id], |row| {
            Ok(AccountRow {
                id: row.get(0)?,
                username: row.get(1)?,
                created_at: opt_datetime(&row, 2)?,
            })
        })
    })
}

pub fn update_account(id: i64, username: Option<&str>, password_hash: Option<&str>) -> Result<AccountRow, String> {
    with_conn(|conn| {
        if let Some(u) = username {
            conn.execute("UPDATE accounts SET username = ?1 WHERE id = ?2", params![u, id])?;
        }
        if let Some(h) = password_hash {
            conn.execute("UPDATE accounts SET password_hash = ?1 WHERE id = ?2", params![h, id])?;
        }
        let mut stmt = conn.prepare("SELECT id, username, created_at FROM accounts WHERE id = ?1")?;
        stmt.query_row(params![id], |row| {
            Ok(AccountRow {
                id: row.get(0)?,
                username: row.get(1)?,
                created_at: opt_datetime(&row, 2)?,
            })
        })
    })
}

pub fn delete_account(id: i64) -> Result<(), String> {
    with_conn(|conn| {
        let n = conn.execute("DELETE FROM accounts WHERE id = ?1", params![id])?;
        if n == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        Ok(())
    })
}

// ─── Dashboard: free rooms, week_number ──────────────────────────────────────
fn week_number_today() -> Result<i64, String> {
    let now = chrono::Local::now().date_naive();
    let (y, m, d) = (now.year(), now.month(), now.day());
    let academic_year_start = if m < 9 || (m == 9 && d < 1) {
        chrono::NaiveDate::from_ymd_opt(y - 1, 9, 1).unwrap()
    } else {
        chrono::NaiveDate::from_ymd_opt(y, 9, 1).unwrap()
    };
    let days_since = (now - academic_year_start).num_days();
    let start_dow = academic_year_start.weekday().num_days_from_monday() as i64;
    let adjusted = start_dow + 1;
    let week_from_start = (days_since + adjusted + 6) / 7;
    let week_number = if week_from_start <= 23 {
        week_from_start
    } else if week_from_start <= 46 {
        week_from_start - 23
    } else {
        let next_sept = chrono::NaiveDate::from_ymd_opt(y, 9, 1).unwrap();
        let days_next = (now - next_sept).num_days();
        let next_dow = next_sept.weekday().num_days_from_monday() as i64;
        let w = (days_next + next_dow + 1 + 6) / 7;
        if w <= 23 {
            w
        } else {
            w - 23
        }
    };
    Ok(week_number)
}

pub fn get_free_rooms() -> Result<(Vec<String>, i64, i64), String> {
    let now = chrono::Local::now();
    let current_date = now.format("%Y-%m-%d").to_string();
    let current_dow = now.weekday().num_days_from_monday() as i64;
    let current_time = now.time();

    if current_dow == 6 {
        return with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT number FROM rooms")?;
            let list: Vec<String> = stmt.query_map([], |row| row.get(0))?.collect::<Result<_, _>>()?;
            let n = list.len() as i64;
            Ok((list, n, n))
        });
    }

    let class_times: [(i64, (u32, u32), (u32, u32)); 7] = [
        (1, (8, 0), (9, 30)),
        (2, (9, 45), (11, 15)),
        (3, (11, 30), (13, 0)),
        (4, (13, 30), (15, 0)),
        (5, (15, 15), (16, 45)),
        (6, (17, 0), (18, 30)),
        (7, (18, 45), (20, 15)),
    ];
    let mut current_class_number: Option<i64> = None;
    for (num, (sh, sm), (eh, em)) in &class_times {
        let start = chrono::NaiveTime::from_hms_opt(*sh, *sm, 0).unwrap();
        let end = chrono::NaiveTime::from_hms_opt(*eh, *em, 0).unwrap();
        if current_time >= start && current_time <= end {
            current_class_number = Some(*num);
            break;
        }
    }

    let all_rooms: Vec<String> = with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT number FROM rooms")?;
        stmt.query_map([], |row| row.get(0)).and_then(|m| m.collect())
    })?;
    let total = all_rooms.len() as i64;

    let Some(class_num) = current_class_number else {
        let mut r = all_rooms;
        r.sort();
        return Ok((r, total, total));
    };

    let is_odd = week_number_today()? % 2 == 1;
    let occupied: std::collections::HashSet<String> = with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT r.number, s.week_type FROM schedule_items s JOIN rooms r ON s.room_id = r.id
             WHERE s.start_date <= ?1 AND s.end_date >= ?1 AND s.day_of_week = ?2 AND s.class_number = ?3",
        )?;
        let list: Vec<(String, String)> = stmt
            .query_map(params![&current_date, current_dow, class_num], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_, _>>()?;
        let mut set = std::collections::HashSet::new();
        for (num, week_type) in list {
            let include_room = week_type == "both"
                || (week_type == "odd" && is_odd)
                || (week_type == "even" && !is_odd);
            if include_room {
                set.insert(num);
            }
        }
        Ok(set)
    })?;

    let mut free: Vec<String> = all_rooms
        .into_iter()
        .filter(|r| !occupied.contains(r))
        .collect::<Vec<_>>();
    free.sort();
    let n = free.len() as i64;
    Ok((free, n, total))
}

// ─── Dashboard: active schedule ──────────────────────────────────────────────
#[derive(Debug, Serialize)]
pub struct ActiveScheduleItem {
    pub id: i64,
    pub room: String,
    pub subject: String,
    pub teacher: String,
    pub group: String,
    pub status: String,
}

pub fn get_active_schedule_list() -> Result<Vec<ActiveScheduleItem>, String> {
    let now = chrono::Local::now();
    let current_date = now.format("%Y-%m-%d").to_string();
    let current_dow = now.weekday().num_days_from_monday() as i64;
    if current_dow == 6 {
        return Ok(vec![]);
    }
    let is_odd = week_number_today()? % 2 == 1;
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT s.id, r.number, s.subject, t.name, s.groups, s.class_number, s.week_type
             FROM schedule_items s
             JOIN rooms r ON s.room_id = r.id
             JOIN teachers t ON s.teacher_id = t.id
             WHERE s.start_date <= ?1 AND s.end_date >= ?1 AND s.day_of_week = ?2",
        )?;
        let rows = stmt.query_map(params![&current_date, current_dow], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?;
        let mut items: Vec<(ActiveScheduleItem, i64)> = vec![];
        for row in rows {
            let (id, room, subject, teacher, groups, class_number, week_type) = row?;
            let include_it = week_type == "both"
                || (week_type == "odd" && is_odd)
                || (week_type == "even" && !is_odd);
            if include_it {
                items.push((
                    ActiveScheduleItem {
                        id,
                        room,
                        subject,
                        teacher,
                        group: groups,
                        status: "Активна".to_string(),
                    },
                    class_number,
                ));
            }
        }
        items.sort_by_key(|(_, cn)| *cn);
        Ok(items.into_iter().map(|(a, _)| a).collect())
    })
}

// ─── Notifications ──────────────────────────────────────────────────────────
#[derive(Debug, Serialize)]
pub struct NotificationRow {
    pub id: i64,
    pub r#type: String,
    pub title: String,
    pub message: String,
    pub read: bool,
    pub created_at: String,
    pub time: String,
}

fn format_time_ago(created: &str) -> String {
    let parsed = chrono::NaiveDateTime::parse_from_str(created, "%Y-%m-%d %H:%M:%S")
        .map(|n| chrono::Utc.from_utc_datetime(&n))
        .unwrap_or_else(|_| chrono::Utc::now());
    let now = chrono::Utc::now();
    let diff = now.signed_duration_since(parsed);
    let secs = diff.num_seconds();
    if secs < 60 {
        "только что".to_string()
    } else if secs < 3600 {
        let m = (secs / 60) as i32;
        if m == 1 {
            "1 минуту назад".to_string()
        } else if m < 5 {
            format!("{} минуты назад", m)
        } else {
            format!("{} минут назад", m)
        }
    } else if secs < 86400 {
        let h = (secs / 3600) as i32;
        if h == 1 {
            "1 час назад".to_string()
        } else if h < 5 {
            format!("{} часа назад", h)
        } else {
            format!("{} часов назад", h)
        }
    } else {
        let d = (secs / 86400) as i32;
        if d == 1 {
            "1 день назад".to_string()
        } else {
            format!("{} дней назад", d)
        }
    }
}

pub fn get_notifications(limit: i64) -> Result<(Vec<NotificationRow>, i64), String> {
    with_conn(|conn| {
        let unread: i64 = conn.query_row(
            "SELECT COUNT(*) FROM notifications WHERE read = 0",
            [],
            |row| row.get(0),
        )?;
        let mut stmt = conn.prepare(
            "SELECT id, type, title, message, read, created_at FROM notifications ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |row| {
            let created = opt_datetime(&row, 5)?;
            let time = format_time_ago(&created);
            Ok(NotificationRow {
                id: row.get(0)?,
                r#type: row.get(1)?,
                title: row.get(2)?,
                message: row.get(3)?,
                read: row.get::<_, i64>(4)? != 0,
                created_at: created,
                time,
            })
        })?;
        let list = rows.collect::<Result<Vec<_>, _>>()?;
        Ok((list, unread))
    })
}

pub fn mark_notification_read(id: i64) -> Result<NotificationRow, String> {
    with_conn(|conn| {
        conn.execute("UPDATE notifications SET read = 1 WHERE id = ?1", params![id])?;
        let mut stmt = conn.prepare(
            "SELECT id, type, title, message, read, created_at FROM notifications WHERE id = ?1",
        )?;
        stmt.query_row(params![id], |row| {
            let created = opt_datetime(&row, 5)?;
            Ok(NotificationRow {
                id: row.get(0)?,
                r#type: row.get(1)?,
                title: row.get(2)?,
                message: row.get(3)?,
                read: row.get::<_, i64>(4)? != 0,
                created_at: created.clone(),
                time: format_time_ago(&created),
            })
        })
    })
}

// ─── Metrics history ─────────────────────────────────────────────────────────
#[derive(Debug, Serialize)]
pub struct SystemMetricPoint {
    pub id: i64,
    pub cpu_percent: f64,
    pub memory_percent: f64,
    pub timestamp: String,
}

pub fn get_metrics_history(days: i64) -> Result<Vec<SystemMetricPoint>, String> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, cpu_percent, memory_percent, timestamp FROM system_metrics
             WHERE timestamp >= datetime('now', ?1) ORDER BY timestamp ASC",
        )?;
        let bound = format!("-{} days", days);
        let rows = stmt.query_map(params![&bound], |row| {
            Ok(SystemMetricPoint {
                id: row.get(0)?,
                cpu_percent: row.get(1)?,
                memory_percent: row.get(2)?,
                timestamp: row.get(3)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
    })
}

pub fn save_system_metric(cpu_percent: f64, memory_percent: f64) -> Result<(), String> {
    with_conn(|conn| {
        conn.execute(
            "INSERT INTO system_metrics (cpu_percent, memory_percent) VALUES (?1, ?2)",
            params![cpu_percent, memory_percent],
        )?;
        Ok(())
    })
}

/// Возвращает (число кабинетов, число медиа). Нужно для проверки «пустая ли БД».
pub fn count_rooms_and_media() -> Result<(i64, i64), String> {
    with_conn(|conn| {
        let rooms: i64 = conn.query_row("SELECT COUNT(*) FROM rooms", [], |r| r.get(0))?;
        let media: i64 = conn.query_row("SELECT COUNT(*) FROM media", [], |r| r.get(0))?;
        Ok((rooms, media))
    })
}

// ─── DB path for export/restore ──────────────────────────────────────────────
pub fn get_db_path() -> Result<std::path::PathBuf, String> {
    let state = DB_STATE.lock().unwrap();
    state
        .as_ref()
        .ok_or_else(|| "DB not initialized".to_string())
        .map(|s| s.db_path.clone())
}

pub fn replace_database_from_path(path: &Path) -> Result<(), String> {
    let state = DB_STATE.lock().unwrap();
    let db_path = state
        .as_ref()
        .ok_or_else(|| "DB not initialized".to_string())?
        .db_path
        .clone();
    drop(state);
    let backup = db_path.with_extension("db.backup");
    if db_path.exists() {
        std::fs::copy(&db_path, &backup).map_err(|e| e.to_string())?;
    }
    std::fs::copy(path, &db_path).map_err(|e| e.to_string())?;
    ensure_tables(&db_path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_init_and_empty_queries() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("test.db");
        let media_dir = dir.path().join("media");
        fs::create_dir_all(&media_dir).expect("create media dir");
        init(&db_path, &media_dir).expect("init");
        let media = get_media(0, 10).expect("get_media");
        assert!(media.is_empty());
        let rooms = get_rooms(0, 10).expect("get_rooms");
        assert!(rooms.is_empty());
        let (r, m) = count_rooms_and_media().expect("count");
        assert_eq!(r, 0);
        assert_eq!(m, 0);
    }
}
