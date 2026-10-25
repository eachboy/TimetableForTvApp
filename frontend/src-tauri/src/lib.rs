// src-tauri/src/lib.rs  (Frontend)

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_updater::UpdaterExt;

mod admin_panel_config;
pub mod api_server;
pub mod db;
mod mdns_discovery;
mod mdns_api_advertise;
// Общий с admin-panel модуль защищённого канала (лежит в <repo>/shared).
#[path = "../../../shared/secure_channel.rs"]
pub mod secure_channel;
#[path = "../../../shared/firewall.rs"]
pub mod firewall;
#[path = "../../../shared/pairing.rs"]
pub mod pairing;
pub mod secure_api;
use admin_panel_config::{
    initialize as initialize_admin_panel_config, record_connection_failure,
    record_connection_success, waiting_for_handshake, waiting_message,
};
use mdns_discovery::{discover_update_server, discover_weather_server, has_known_admin_panel};

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct WeatherData {
    pub temperature: f64,
    pub temp_min: Option<f64>,
    pub temp_max: Option<f64>,
    pub description: Option<String>,
    pub condition: Option<String>,
    pub date: Option<String>, // YYYY-MM-DD
}

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

/// Команда для Timetable: получить текущую погоду от admin-panel.
/// Admin-panel отдаёт JSON `weather.json` с полями:
/// { "temperature": number, "temp_min": number, "temp_max": number, "description": string, "condition": string, "date": "YYYY-MM-DD" }
/// и подписывает его в заголовке `X-TT-Sig` (HMAC от общего ключа) — подделка в сети отвергается.
///
/// TV сам панель не ищет: адрес известен только после зашифрованного handshake от admin-panel.
#[tauri::command]
async fn api_get_weather() -> Result<WeatherData, String> {
    if waiting_for_handshake() {
        return Err(waiting_message());
    }

    let Some(base) = discover_weather_server(15).await else {
        if has_known_admin_panel() {
            let status = record_connection_failure();
            return Err(format!(
                "Admin Panel is not reachable; failed attempts: {}",
                status.failure_count
            ));
        }
        return Err("Waiting for admin-panel handshake (admin-panel has not found this TV yet)".to_string());
    };

    match fetch_signed_weather(&base).await {
        Ok(data) => {
            record_connection_success();
            Ok(data)
        }
        Err(e) => {
            record_connection_failure();
            Err(e)
        }
    }
}

async fn fetch_signed_weather(base: &str) -> Result<WeatherData, String> {
    if !secure_api::security().is_paired() {
        return Err("TV is not paired with an admin-panel yet".to_string());
    }

    let weather_url = format!("{}/weather.json", base.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&weather_url)
        .send()
        .await
        .map_err(|e| format!("Weather request to {} failed: {}", weather_url, e))?;
    if !resp.status().is_success() {
        return Err(format!("Weather endpoint {} returned {}", weather_url, resp.status()));
    }
    let signature = resp
        .headers()
        .get("x-tt-sig")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let body = resp
        .bytes()
        .await
        .map_err(|e| format!("Weather read failed: {}", e))?;
    parse_signed_weather(&body, signature.as_deref())
}

/// Проверяет подпись и разбирает погоду.
pub(crate) fn parse_signed_weather(
    body: &[u8],
    signature: Option<&str>,
) -> Result<WeatherData, String> {
    secure_api::security().verify_weather(body, signature)?;
    serde_json::from_slice::<WeatherData>(body)
        .map_err(|e| format!("Failed to parse weather JSON: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
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
            api_get_weather,
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

            initialize_admin_panel_config(app_data_dir.join("admin-panel.json"));

            // Секреты защищённого канала (JWT уникален для установки, хранится в app data).
            // Просим Windows открыть порты 8000/5353 (окно UAC), иначе админка с другого ПК не достучится.
            firewall::ensure_in_background(&firewall::TV_RULES);
            secure_api::init(Some(&app_data_dir));

            // Дисплей управляется 4 кнопками — системный курсор не нужен нигде.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_cursor_visible(false);
            }

            // Включаем автозапуск при старте системы (TV-киоск должен запускаться автоматически)
            let autolaunch = app.autolaunch();
            match autolaunch.is_enabled() {
                Ok(true) => log::info!("Autostart already enabled"),
                _ => {
                    if let Err(e) = autolaunch.enable() {
                        log::warn!("Failed to enable autostart: {}", e);
                    } else {
                        log::info!("Autostart enabled successfully");
                    }
                }
            }

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

                // Объявляем REST API в mDNS — admin-panel находит Timetable без полного скана LAN.
                match mdns_api_advertise::MdnsTimetableApi::register() {
                    Ok(service) => {
                        Box::leak(Box::new(service));
                    }
                    Err(e) => log::warn!(
                        "Timetable API mDNS advertise failed (admin-panel may rely on subnet scan): {}",
                        e
                    ),
                }
            }

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.set_cursor_visible(false);
                    let _ = window.show();
                }

                loop {
                    let (hour, _minute) = current_local_hour_minute();

                    // Активное окно для поиска mDNS и обновлений: 07:00–23:59
                    if hour >= 7 && hour <= 23 {
                        log::info!("Periodic mDNS/update check in active window ({}h)", hour);
                        check_and_apply_update(&handle).await;

                        // Повторяем поиск/проверку каждые 5 минут
                        tokio::time::sleep(tokio::time::Duration::from_secs(5 * 60)).await;
                    } else {
                        // Вне окна — спим до 07:00
                        let secs = seconds_until_07_00();
                        log::info!(
                            "Outside active window, next mDNS/update check in {}s (at 07:00)",
                            secs
                        );
                        tokio::time::sleep(tokio::time::Duration::from_secs(secs)).await;
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Возвращает (час, минуты) локального времени с учётом TZ_OFFSET_HOURS (по умолчанию UTC+3).
fn current_local_hour_minute() -> (u64, u64) {
    use std::time::{SystemTime, UNIX_EPOCH};

    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    // Смещение часового пояса берём из переменной окружения TZ_OFFSET_HOURS или считаем UTC+3.
    let tz_offset_secs: u64 = std::env::var("TZ_OFFSET_HOURS")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(3) // По умолчанию UTC+3
        .unsigned_abs()
        * 3600;

    let local_secs = now_secs + tz_offset_secs;
    let secs_in_day = local_secs % 86400; // сколько секунд прошло с начала суток
    let hour = secs_in_day / 3600;
    let minute = (secs_in_day % 3600) / 60;

    (hour, minute)
}

/// Возвращает количество секунд до следующего наступления 07:00 по местному времени.
fn seconds_until_07_00() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    // Смещение часового пояса берём из переменной окружения TZ_OFFSET_HOURS или считаем UTC+3.
    let tz_offset_secs: u64 = std::env::var("TZ_OFFSET_HOURS")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(3) // По умолчанию UTC+3
        .unsigned_abs()
        * 3600;

    let local_secs = now_secs + tz_offset_secs;
    let secs_in_day = local_secs % 86400; // сколько секунд прошло с начала суток
    let target = 7 * 3600_u64; // 07:00 = 25200 секунд от начала суток

    if secs_in_day < target {
        target - secs_in_day
    } else {
        // 07:00 сегодня уже прошло — ждём до 07:00 завтра
        86400 - secs_in_day + target
    }
}

async fn check_and_apply_update(handle: &tauri::AppHandle) {
    log::info!("Checking for updates (admin-panel address from handshake)...");

    if waiting_for_handshake() {
        log::info!("{}", waiting_message());
        return;
    }

    // TV пассивен: адрес панели появляется только после зашифрованного handshake
    // (admin-panel сама ищет TV в сети). Пока адреса нет — просто ждём, это не ошибка.
    let Some(server_url) = discover_update_server(15).await else {
        if has_known_admin_panel() {
            let status = record_connection_failure();
            if status.waiting_for_handshake {
                log::warn!("{}", waiting_message());
            }
        } else {
            log::info!("Waiting for admin-panel to find this TV (no handshake yet)");
        }
        return;
    };

    let latest_url = format!("{}/latest.json", server_url.trim_end_matches('/'));

    match reqwest::get(&latest_url).await {
        Ok(resp) if resp.status().is_success() => {
            record_connection_success();
            log::info!("Update server responded OK");
        }
        Ok(resp) => {
            record_connection_success();
            log::info!("Update server returned {}, no update available", resp.status());
            return;
        }
        Err(e) => {
            let status = record_connection_failure();
            log::warn!("Cannot reach update server: {}", e);
            if status.waiting_for_handshake {
                log::warn!("{}", waiting_message());
            }
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
            record_connection_success();
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
            record_connection_success();
            log::info!("Update installed, restarting...");
        }
        Err(e) => {
            log::error!("Update install failed: {}", e);
        }
    }
}