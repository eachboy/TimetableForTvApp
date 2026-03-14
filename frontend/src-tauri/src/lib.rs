// src-tauri/src/lib.rs  (Frontend)

use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;

mod mdns_discovery;
use mdns_discovery::discover_update_server;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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

            let (_rx, _child) = app
                .shell()
                .sidecar("backend")
                .unwrap()
                .env("DB_PATH", db_path.to_string_lossy().to_string())
                .spawn()
                .expect("Failed to start backend sidecar");

            // Запускаем фоновую задачу проверки обновлений в 22:00
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let secs_until_22 = seconds_until_22_00();
                    log::info!("Next update check in {}s (at 22:00)", secs_until_22);
                    tokio::time::sleep(tokio::time::Duration::from_secs(secs_until_22)).await;
                    check_and_apply_update(&handle).await;
                    // После проверки спим 60 секунд чтобы не проверять дважды в одну минуту
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