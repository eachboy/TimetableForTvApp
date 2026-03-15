// src-tauri/src/lib.rs  (Frontend)

use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

pub mod api_server;
pub mod db;
mod mdns_discovery;
use mdns_discovery::discover_update_server;

#[tauri::command]
fn api_health() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "status": "healthy",
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

#[tauri::command]
fn api_get_media(skip: Option<i64>, limit: Option<i64>) -> Result<Vec<db::MediaRow>, String> {
    db::get_media(skip.unwrap_or(0), limit.unwrap_or(100))
}

#[tauri::command]
fn api_get_media_file_path(media_id: i64) -> Result<Option<String>, String> {
    db::get_media_file_path(media_id).map(|opt| opt.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
fn api_get_news(skip: Option<i64>, limit: Option<i64>) -> Result<Vec<db::NewsRow>, String> {
    db::get_news(skip.unwrap_or(0), limit.unwrap_or(100))
}

#[tauri::command]
fn api_get_rooms(skip: Option<i64>, limit: Option<i64>) -> Result<Vec<db::RoomRow>, String> {
    db::get_rooms(skip.unwrap_or(0), limit.unwrap_or(100))
}

#[tauri::command]
fn api_get_schedule(
    room_id: Option<i64>,
    teacher_id: Option<i64>,
    day_of_week: Option<i64>,
    skip: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<db::ScheduleItemRow>, String> {
    db::get_schedule(
        room_id,
        teacher_id,
        day_of_week,
        skip.unwrap_or(0),
        limit.unwrap_or(1000),
    )
}

#[tauri::command]
fn api_get_schedule_upcoming(limit: Option<i64>) -> Result<Vec<db::ScheduleItemRow>, String> {
    db::get_schedule_upcoming(limit.unwrap_or(20))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            api_health,
            api_get_media,
            api_get_media_file_path,
            api_get_news,
            api_get_rooms,
            api_get_schedule,
            api_get_schedule_upcoming,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");

            std::fs::create_dir_all(&app_data_dir)
                .expect("Failed to create app data directory");

            let db_path = app_data_dir.join("timetable.db");

            // Копируем БД при первом запуске: ресурсы сборки или backend/ в проекте (dev)
            if !db_path.exists() {
                let src = app.path().resource_dir().ok().and_then(|p| {
                    [p.join("timetable.db"), p.join("backend").join("timetable.db")]
                        .into_iter()
                        .find(|c| c.exists() && c.metadata().map(|m| m.len() > 1000).unwrap_or(false))
                }).or_else(|| {
                    std::env::current_dir().ok().and_then(|c| {
                        [c.join("backend").join("timetable.db"), c.join("..").join("backend").join("timetable.db")]
                            .into_iter()
                            .find(|b| b.exists() && b.metadata().map(|m| m.len() > 1000).unwrap_or(false))
                    })
                });
                if let Some(ref src) = src {
                    if std::fs::copy(src, &db_path).is_ok() {
                        log::info!("Copied database from {} to {}", src.display(), db_path.display());
                    }
                }
            }

            let media_dir = app_data_dir.join("media");
            std::fs::create_dir_all(&media_dir).expect("Failed to create media directory");

            if let Err(e) = db::init(&db_path, &media_dir) {
                log::error!("DB init failed: {}", e);
            } else {
                // Если БД пустая — пробуем подставить из ресурсов или из backend/ (для dev)
                if let Ok((rooms, media)) = db::count_rooms_and_media() {
                    if rooms == 0 && media == 0 {
                        let fallback = app.path().resource_dir().ok().and_then(|p| {
                            [p.join("timetable.db"), p.join("backend").join("timetable.db")]
                                .into_iter()
                                .find(|c| c.exists() && c.metadata().map(|m| m.len() > 1000).unwrap_or(false))
                        }).or_else(|| {
                            std::env::current_dir().ok().and_then(|c| {
                                let candidates = [
                                    c.join("backend").join("timetable.db"),
                                    c.join("..").join("backend").join("timetable.db"),
                                ];
                                candidates.into_iter().find(|b| {
                                    b.exists() && b.metadata().map(|m| m.len() > 1000).unwrap_or(false)
                                })
                            })
                        });
                        if let Some(src) = fallback {
                            if std::fs::copy(&src, &db_path).is_ok() {
                                log::info!("Filled empty DB from {}", src.display());
                            }
                        }
                    }
                }
                log::info!("Local DB ready at {}", db_path.display());
                let addr: std::net::SocketAddr = ([0, 0, 0, 0], 8000).into();
                api_server::run_api_server(addr, media_dir.clone());
            }

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.show();
                }

                loop {
                    let secs_until_22 = seconds_until_22_00();
                    log::info!("Next update check in {}s (at 22:00)", secs_until_22);
                    tokio::time::sleep(tokio::time::Duration::from_secs(secs_until_22)).await;
                    check_and_apply_update(&handle).await;
                    tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Возвращает количество секунд до следующего наступления 22:00 по местному времени.
fn seconds_until_22_00() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    // Смещение часового пояса берём из переменной окружения TZ или считаем UTC.
    // Для простоты используем UTC — скорректируйте offset под свой часовой пояс.
    // UTC+3 (Москва) = 3 * 3600 = 10800
    let tz_offset_secs: u64 = std::env::var("TZ_OFFSET_HOURS")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(3) // По умолчанию UTC+3
        .unsigned_abs()
        * 3600;

    let local_secs = now_secs + tz_offset_secs;
    let secs_in_day = local_secs % 86400;          // сколько секунд прошло с начала суток
    let target = 22 * 3600_u64;                     // 22:00 = 79200 секунд от начала суток

    if secs_in_day < target {
        target - secs_in_day
    } else {
        // 22:00 сегодня уже прошло — ждём до 22:00 завтра
        86400 - secs_in_day + target
    }
}

async fn check_and_apply_update(handle: &tauri::AppHandle) {
    log::info!("Checking for updates via mDNS...");

    let server_url = match discover_update_server(5).await {
        Some(url) => {
            log::info!("Found update server: {}", url);
            url
        }
        None => {
            log::info!("Admin Panel not found in local network, skipping update check");
            return;
        }
    };

    let latest_url = format!("{}/latest.json", server_url);

    match reqwest::get(&latest_url).await {
        Ok(resp) if resp.status().is_success() => {
            log::info!("Update server responded OK");
        }
        Ok(resp) => {
            log::info!("Update server returned {}, no update available", resp.status());
            return;
        }
        Err(e) => {
            log::warn!("Cannot reach update server: {}", e);
            return;
        }
    }

    let parsed_url = match latest_url.parse::<url::Url>() {
        Ok(u) => u,
        Err(e) => {
            log::error!("Failed to parse update URL: {}", e);
            return;
        }
    };

    let builder = match handle.updater_builder().endpoints(vec![parsed_url]) {
        Ok(b) => b,
        Err(e) => {
            log::error!("Failed to set endpoints: {}", e);
            return;
        }
    };

    let updater = match builder.build() {
        Ok(u) => u,
        Err(e) => {
            log::error!("Failed to build updater: {}", e);
            return;
        }
    };

    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            log::info!("Already up to date");
            return;
        }
        Err(e) => {
            log::warn!("Update check error: {}", e);
            return;
        }
    };

    log::info!(
        "Update available: {} → {}",
        handle.package_info().version,
        update.version
    );

    log::info!("Downloading update silently...");

    match update.download_and_install(|_chunk, _total| {}, || {}).await {
        Ok(_) => {
            log::info!("Update installed, restarting...");
        }
        Err(e) => {
            log::error!("Update install failed: {}", e);
        }
    }
}