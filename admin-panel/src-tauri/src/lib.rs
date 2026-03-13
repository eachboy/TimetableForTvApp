mod update_server;
mod mdns_service;
mod github;

use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use update_server::UpdateServer;
use mdns_service::MdnsService;

// ─── Глобальное состояние ─────────────────────────────────────────────────────

pub struct AppState {
    pub update_server: Arc<Mutex<Option<UpdateServer>>>,
    pub mdns: Arc<Mutex<Option<MdnsService>>>,
}

// ─── Точка входа ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            update_server: Arc::new(Mutex::new(None)),
            mdns: Arc::new(Mutex::new(None)),
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Запускаем update-сервер + mDNS в фоне
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match start_services(&handle).await {
                    Ok(_) => log::info!("Update services started successfully"),
                    Err(e) => log::error!("Failed to start update services: {}", e),
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_check_update,
            cmd_download_update,
            cmd_get_server_status,
            cmd_get_cached_version,
            cmd_get_app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ─── Запуск сервисов ──────────────────────────────────────────────────────────

async fn start_services(handle: &AppHandle) -> Result<(), String> {
    let state = handle.state::<AppState>();

    // Директория кэша: %APPDATA%\timetable-admin\update-cache или ~/.local/...
    let cache_dir = handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("update-cache");

    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    // Запускаем HTTP update-сервер на порту 9000
    const PORT: u16 = 9000;
    let server = UpdateServer::start(cache_dir, PORT)
        .map_err(|e| format!("HTTP server error: {}", e))?;

    {
        let mut s = state.update_server.lock().unwrap();
        *s = Some(server);
    }

    log::info!("Update HTTP server listening on :{}", PORT);

    // Регистрируем mDNS сервис
    // Frontend будет искать "_timetable-update._tcp.local."
    let mdns = MdnsService::register("timetable-admin", PORT)
        .map_err(|e| format!("mDNS error: {}", e))?;

    {
        let mut m = state.mdns.lock().unwrap();
        *m = Some(mdns);
    }

    log::info!("mDNS registered: timetable-admin.local:{}", PORT);
    Ok(())
}

// ─── Tauri команды ────────────────────────────────────────────────────────────

/// Проверить наличие нового релиза на GitHub
#[tauri::command]
async fn cmd_check_update(
    current_version: String,
    github_token: Option<String>,
) -> Result<serde_json::Value, String> {
    github::check_latest_release(&current_version, github_token.as_deref()).await
}

/// Скачать релиз с GitHub и опубликовать на update-сервере
#[tauri::command]
async fn cmd_download_update(
    version: String,
    github_token: Option<String>,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    let state = app.state::<AppState>();

    let cache_dir = {
        let server = state.update_server.lock().unwrap();
        server
            .as_ref()
            .ok_or("Update server is not running")?
            .cache_dir()
            .to_path_buf()
    };

    let result = github::download_release(&version, github_token.as_deref(), &cache_dir).await?;

    // Публикуем версию на сервере (записываем latest.json)
    {
        let server = state.update_server.lock().unwrap();
        if let Some(srv) = server.as_ref() {
            srv.publish_version(&version, &result.notes)
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(serde_json::json!({
        "version": version,
        "files": result.downloaded_files,
        "status": "ready",
    }))
}

/// Статус update-сервера и mDNS
#[tauri::command]
fn cmd_get_server_status(state: tauri::State<AppState>) -> serde_json::Value {
    let server_ok = state.update_server.lock().unwrap().is_some();
    let mdns_ok = state.mdns.lock().unwrap().is_some();

    serde_json::json!({
        "serverRunning": server_ok,
        "mdnsRunning": mdns_ok,
        "endpoint": "http://timetable-admin.local:9000",
        "port": 9000,
    })
}

/// Какая версия сейчас закэширована и раздаётся
#[tauri::command]
fn cmd_get_cached_version(state: tauri::State<AppState>) -> serde_json::Value {
    let server = state.update_server.lock().unwrap();
    match server.as_ref() {
        Some(srv) => srv.cached_version_info(),
        None => serde_json::json!({ "version": null, "ready": false }),
    }
}

/// Версия приложения из tauri.conf.json
#[tauri::command]
fn cmd_get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}