//! Standalone API-сервер для admin panel (без окна Tauri).
//! Запуск: из корня репозитория или frontend:
//!   cd frontend/src-tauri && cargo run --bin api-server
//! Или с путями: DB_PATH=./backend/timetable.db MEDIA_DIR=./backend/media cargo run --bin api-server
//! По умолчанию: ./timetable.db и ./media в текущей директории.

use app_lib::api_server;
use app_lib::db;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let db_path = match std::env::var("DB_PATH") {
        Ok(p) => PathBuf::from(p),
        Err(_) => {
            // Ищем существующую БД: сначала backend (чтобы использовать те же данные, что и Python)
            let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            let candidates = [
                "backend/timetable.db",
                "../backend/timetable.db",
                "../../backend/timetable.db",
                "timetable.db",
            ];
            let mut chosen = PathBuf::from("timetable.db");
            for rel in &candidates {
                let full = cwd.join(rel);
                if full.exists() {
                    chosen = full;
                    println!("Using DB: {}", chosen.display());
                    break;
                }
            }
            if !chosen.exists() {
                // Копируем из backend, если локальной ещё нет
                for rel in &["backend/timetable.db", "../backend/timetable.db", "../../backend/timetable.db"] {
                    let full = cwd.join(rel);
                    if full.exists() {
                        let local = cwd.join("timetable.db");
                        std::fs::copy(&full, &local)?;
                        println!("Copied DB from {} to {}", full.display(), local.display());
                        chosen = local;
                        break;
                    }
                }
            }
            chosen
        }
    };
    let media_dir = std::env::var("MEDIA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            for rel in &["backend/media", "../backend/media", "../../backend/media"] {
                let full = cwd.join(rel);
                if full.exists() {
                    return full;
                }
            }
            cwd.join("media")
        });
    std::fs::create_dir_all(&media_dir)?;

    db::init(&db_path, &media_dir).map_err(|e| format!("DB init: {}", e))?;
    println!("DB ready at {}", db_path.display());

    let addr: std::net::SocketAddr = ([0, 0, 0, 0], 8000).into();
    let app = api_server::create_app(media_dir);

    println!("API server: http://{} (admin panel: connect to this URL)", addr);
    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(async {
        let listener = tokio::net::TcpListener::bind(addr).await?;
        axum::serve(listener, app.into_make_service()).await
    })?;
    Ok(())
}
