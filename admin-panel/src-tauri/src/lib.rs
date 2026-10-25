mod update_server;
mod mdns_service;
mod timetable_mdns;
mod github;
// Общий с TV модуль защищённого канала (лежит в <repo>/shared).
#[path = "../../../shared/secure_channel.rs"]
pub mod secure_channel;
#[path = "../../../shared/firewall.rs"]
pub mod firewall;
#[path = "../../../shared/pairing.rs"]
pub mod pairing;
mod tv_link;

use std::cmp::Reverse;
use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::task::JoinSet;
use update_server::UpdateServer;
use mdns_service::{MdnsService, SERVICE_HOSTNAME};

const TIMETABLE_API_PORT: u16 = 8000;
/// Таймаут LAN/mDNS-обнаружения Timetable (секунды).
const TIMETABLE_DISCOVERY_TIMEOUT_SECS: u64 = 15;

#[derive(serde::Serialize, serde::Deserialize, Debug, Default)]
struct TimetableApiCache {
    base_url: Option<String>,
    updated_at: Option<String>,
}

// ─── Глобальное состояние ─────────────────────────────────────────────────────

pub struct AppState {
    pub update_server: Arc<Mutex<Option<UpdateServer>>>,
    pub mdns: Arc<Mutex<Option<MdnsService>>>,
    pub link: Arc<Mutex<LinkStatus>>,
}

/// Состояние связи с TV (для интерфейса): admin-panel сама ищет TV и держит handshake.
#[derive(serde::Serialize, Clone, Debug)]
pub struct LinkStatus {
    /// "searching" — ищем TV в сети; "connected" — TV найден и подтвердил ключ.
    pub state: &'static str,
    pub tv_url: Option<String>,
    pub last_ok_ms: Option<i64>,
    pub last_error: Option<String>,
    pub attempts: u32,
}

impl Default for LinkStatus {
    fn default() -> Self {
        LinkStatus { state: "searching", tv_url: None, last_ok_ms: None, last_error: None, attempts: 0 }
    }
}

/// Счётчик раундов поиска: полный скан подсети выполняем не каждый раз, чтобы не шуметь в сети.
static SEARCH_ROUND: AtomicU32 = AtomicU32::new(0);

// Погода: только по POST /weather/refresh от Timetable (см. update_server.rs).

// ─── Точка входа ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            update_server: Arc::new(Mutex::new(None)),
            mdns: Arc::new(Mutex::new(None)),
            link: Arc::new(Mutex::new(LinkStatus::default())),
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Просим Windows открыть порты 9000/5353 (окно UAC): TV сам ходит за погодой и обновлениями.
            firewall::ensure_in_background(&firewall::ADMIN_RULES);

            // Ключ панели создаётся один раз при первом запуске (не зависит от машины сборки).
            match app.path().app_data_dir() {
                Ok(dir) => tv_link::init(&dir.join("pairing-key.json")),
                Err(e) => {
                    // Запасной вариант: папка данных пользователя ОС — ключ всё равно создаётся и хранится.
                    log::error!("Cannot resolve app data dir ({}), using fallback location", e);
                    let fallback = std::env::temp_dir().join("timetable-admin").join("pairing-key.json");
                    tv_link::init(&fallback);
                }
            }

            load_manual_tv(app.handle());

            // Запускаем update-сервер + mDNS в фоне, затем периодически регистрируемся в timetable
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match start_services(&handle).await {
                    Ok(_) => log::info!("Update services started successfully"),
                    Err(e) => log::error!("Failed to start update services: {}", e),
                }

                // admin-panel ИЩЕТ TV, TV только ждёт (пассивно).
                // Пока TV не найден — повторяем поиск часто (3→6→12→24→30 сек).
                // После успешного handshake — «пульс» каждые 60 сек: так TV всегда знает
                // актуальный адрес панели (смена IP, перезапуск TV и т.п.).
                const MAX_SEARCH_BACKOFF_SECS: u64 = 30;
                const HEARTBEAT_SECS: u64 = 60;
                let mut backoff = Duration::from_secs(3);
                let mut registered = false;

                loop {
                    match notify_timetable_about_admin_panel(&handle).await {
                        Ok(tv_url) => {
                            if !registered {
                                log::info!("Handshake with timetable succeeded ({})", tv_url);
                                registered = true;
                            }
                            set_link_connected(&handle, &tv_url);
                            backoff = Duration::from_secs(HEARTBEAT_SECS);
                        }
                        Err(e) => {
                            if registered {
                                log::warn!("Lost connection to timetable: {}", e);
                            } else {
                                log::info!("Timetable not found yet (retry in {:?}): {}", backoff, e);
                            }
                            registered = false;
                            set_link_searching(&handle, &e);
                            // Первое повторение — быстро; дальше экспоненциально до 30 сек.
                            backoff = if backoff >= Duration::from_secs(HEARTBEAT_SECS) {
                                Duration::from_secs(3)
                            } else {
                                (backoff * 2).min(Duration::from_secs(MAX_SEARCH_BACKOFF_SECS))
                            };
                        }
                    }
                    tokio::time::sleep(backoff).await;
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
            cmd_discover_timetable_api,
            cmd_get_link_status,
            cmd_get_pairing_key,
            cmd_pair_with_tv,
            cmd_get_diagnostics,
            cmd_set_manual_tv,
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
    let mdns = MdnsService::register(SERVICE_HOSTNAME, PORT)
        .map_err(|e| format!("mDNS error: {}", e))?;

    {
        let mut m = state.mdns.lock().unwrap();
        *m = Some(mdns);
    }

    let endpoint = {
        let s = state.update_server.lock().unwrap();
        s.as_ref()
            .map(|srv| srv.public_base_url().to_string())
            .unwrap_or_else(|| format!("http://127.0.0.1:{}", PORT))
    };

    log::info!("Update endpoint announced for LAN: {}", endpoint);
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
    let server = state.update_server.lock().unwrap();
    let server_ok = server.is_some();
    let mdns_ok = state.mdns.lock().unwrap().is_some();
    let endpoint = server
        .as_ref()
        .map(|srv| srv.public_base_url().to_string())
        .unwrap_or_else(|| "http://127.0.0.1:9000".to_string());

    serde_json::json!({
        "serverRunning": server_ok,
        "mdnsRunning": mdns_ok,
        "endpoint": endpoint,
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

/// Найти Timetable API в локальной сети (параллельное сканирование подсети).
/// Возвращает базовый URL (например "http://192.168.1.42:8000") или null.
#[tauri::command]
async fn cmd_discover_timetable_api(app: AppHandle) -> Option<String> {
    discover_timetable_api(&app, TIMETABLE_DISCOVERY_TIMEOUT_SECS).await
}

/// Статус связи с TV (поиск / подключено).
#[tauri::command]
fn cmd_get_link_status(state: tauri::State<AppState>) -> LinkStatus {
    state.link.lock().unwrap().clone()
}

/// Ключ сопряжения (hex, 32 байта) — нужен веб-части для шифрования запросов к TV.
/// Это приватные данные собственного приложения; наружу по сети не отдаются.
#[tauri::command]
fn cmd_get_pairing_key() -> Result<String, String> {
    let psk = tv_link::load_psk()?;
    Ok(secure_channel::hex_encode(psk.as_bytes()))
}

/// Адрес TV, введённый вручную в интерфейсе: проверяется первым и хранится между запусками.
static MANUAL_TV: Mutex<Option<String>> = Mutex::new(None);

fn manual_tv_path(handle: &AppHandle) -> Option<PathBuf> {
    Some(handle.path().app_data_dir().ok()?.join("manual-tv.json"))
}

fn load_manual_tv(handle: &AppHandle) {
    let url = manual_tv_path(handle)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|d| serde_json::from_slice::<TimetableApiCache>(&d).ok())
        .and_then(|c| c.base_url);
    *MANUAL_TV.lock().unwrap() = url;
}

#[tauri::command]
fn cmd_set_manual_tv(app: AppHandle, url: Option<String>) {
    let url = url.map(|u| u.trim().trim_end_matches('/').to_string()).filter(|u| !u.is_empty());
    *MANUAL_TV.lock().unwrap() = url.clone();
    if let Some(path) = manual_tv_path(&app) {
        match &url {
            Some(u) => {
                if let Some(dir) = path.parent() {
                    let _ = std::fs::create_dir_all(dir);
                }
                let cache = TimetableApiCache { base_url: Some(u.clone()), updated_at: Some(chrono::Utc::now().to_rfc3339()) };
                if let Ok(data) = serde_json::to_vec_pretty(&cache) {
                    let _ = std::fs::write(path, data);
                }
            }
            None => {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

/// Подробная диагностика связи: кто (этот ПК), к кому подключается и что получилось.
#[tauri::command]
fn cmd_get_diagnostics(app: AppHandle, state: tauri::State<AppState>) -> serde_json::Value {
    let link = state.link.lock().unwrap().clone();
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "неизвестно".to_string());
    let ips: Vec<String> = local_ipv4_candidates().iter().map(|ip| ip.to_string()).collect();
    serde_json::json!({
        "host": host,
        "local_ips": ips,
        "panel_url": current_admin_panel_base_url(&app),
        "key_ready": tv_link::load_psk().is_ok(),
        "key_file": tv_link::key_file_path(),
        "link_state": link.state,
        "tv_url": link.tv_url,
        "last_error": link.last_error,
        "attempts": link.attempts,
        "summary": tv_link::round_summary(),
        "hint_url": configured_timetable_api_url(),
    })
}

/// Проверить адрес и (если TV ждёт сопряжения) автоматически сопрячься. Вызывается веб-частью
/// для адреса из .env / сохранённого / найденного: адрес — лишь подсказка, решает проверка.
#[tauri::command]
async fn cmd_pair_with_tv(app: AppHandle, url: String) -> bool {
    let url = url.trim().trim_end_matches('/').to_string();
    if tv_link::ensure_paired(&url, true).await {
        save_cached_timetable_api_url(&app, &url);
        true
    } else {
        false
    }
}

fn set_link_connected(handle: &AppHandle, tv_url: &str) {
    let state = handle.state::<AppState>();
    let mut link = state.link.lock().unwrap();
    link.state = "connected";
    link.tv_url = Some(tv_url.to_string());
    link.last_ok_ms = Some(secure_channel::now_ms());
    link.last_error = None;
    link.attempts = 0;
}

fn set_link_searching(handle: &AppHandle, error: &str) {
    let state = handle.state::<AppState>();
    let mut link = state.link.lock().unwrap();
    link.state = "searching";
    link.last_error = Some(error.to_string());
    link.attempts = link.attempts.saturating_add(1);
}

async fn notify_timetable_about_admin_panel(handle: &AppHandle) -> Result<String, String> {
    tv_link::clear_note();
    let timetable_api = match discover_timetable_api(handle, TIMETABLE_DISCOVERY_TIMEOUT_SECS).await {
        Some(url) => url,
        None => {
            let reason = tv_link::take_note()
                .unwrap_or_else(|| "Timetable TV в локальной сети не найден".to_string());
            let summary = tv_link::round_summary();
            return Err(if summary.is_empty() { reason } else { format!("{}. {}", reason, summary) });
        }
    };
    let admin_base_url = current_admin_panel_base_url(handle);

    // Зашифрованный handshake: TV принимает адрес панели только по каналу с общим ключом.
    tv_link::register_admin_panel(&timetable_api, &admin_base_url).await?;

    log::debug!(
        "Handshake completed: {} registered on {}",
        admin_base_url,
        timetable_api
    );
    Ok(timetable_api)
}

fn current_admin_panel_base_url(handle: &AppHandle) -> String {
    let state = handle.state::<AppState>();
    let server = state.update_server.lock().unwrap();
    server
        .as_ref()
        .map(|srv| srv.public_base_url().to_string())
        .unwrap_or_else(|| "http://127.0.0.1:9000".to_string())
}

async fn discover_timetable_api(handle: &AppHandle, timeout_secs: u64) -> Option<String> {
    // Адрес, введённый пользователем вручную, проверяется самым первым.
    let manual = MANUAL_TV.lock().unwrap().clone();
    if let Some(url) = manual {
        if probe_timetable_api(&url, true).await.is_some() {
            log::info!("Using manually entered TV address: {}", url);
            save_cached_timetable_api_url(handle, &url);
            return Some(url);
        }
        log::warn!("Manually entered TV address is not reachable: {}", url);
    }

    // Адрес из настройки — лишь подсказка: пробуем первым, но если он не подошёл (другая сеть,
    // другой TV), поиск продолжается автоматически.
    if let Some(url) = configured_timetable_api_url() {
        if probe_timetable_api(&url, true).await.is_some() {
            log::info!("Using configured timetable API URL: {}", url);
            save_cached_timetable_api_url(handle, &url);
            return Some(url);
        }

        log::warn!("Configured timetable API URL is not reachable: {}", url);
    }

    if let Some(url) = load_cached_timetable_api_url(handle) {
        if probe_timetable_api(&url, true).await.is_some() {
            log::info!("Using cached timetable API URL: {}", url);
            return Some(url);
        }

        log::warn!("Cached timetable API URL is not reachable: {}", url);
    }

    tv_link::record_info(format!("Эта панель: {}", current_admin_panel_base_url(handle)));
    if let Some(url) = discover_timetable_via_mdns(timeout_secs).await {
        log::info!("Resolved timetable API via mDNS: {}", url);
        save_cached_timetable_api_url(handle, &url);
        return Some(url);
    }

    if let Some(url) = discover_direct_timetable_api().await {
        save_cached_timetable_api_url(handle, &url);
        return Some(url);
    }

    // Полное сканирование подсети — только каждый 4-й раунд (и в первый), чтобы не шуметь в LAN.
    let round = SEARCH_ROUND.fetch_add(1, Ordering::Relaxed);
    if round % 4 != 0 {
        tv_link::record_info("Полный скан подсети выполняется раз в 4 попытки".to_string());
        return None;
    }
    let url = discover_timetable_via_subnet_scan(timeout_secs).await?;
    save_cached_timetable_api_url(handle, &url);
    Some(url)
}

fn configured_timetable_api_url() -> Option<String> {
    for key in ["TIMETABLE_API_URL", "TIMETABLE_FRONTEND_API_URL"] {
        if let Ok(value) = std::env::var(key) {
            let normalized = value.trim().trim_end_matches('/').to_string();
            if !normalized.is_empty() {
                return Some(normalized);
            }
        }
    }
    None
}

fn timetable_api_cache_path(handle: &AppHandle) -> Option<PathBuf> {
    Some(handle.path().app_data_dir().ok()?.join("timetable-api.json"))
}

fn load_cached_timetable_api_url(handle: &AppHandle) -> Option<String> {
    let path = timetable_api_cache_path(handle)?;
    let data = std::fs::read(path).ok()?;
    let cache = serde_json::from_slice::<TimetableApiCache>(&data).ok()?;
    cache.base_url.map(|url| url.trim().trim_end_matches('/').to_string())
}

fn save_cached_timetable_api_url(handle: &AppHandle, base_url: &str) {
    let Some(path) = timetable_api_cache_path(handle) else {
        return;
    };

    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            log::warn!("Failed to create timetable API cache directory: {}", e);
            return;
        }
    }

    let cache = TimetableApiCache {
        base_url: Some(base_url.trim().trim_end_matches('/').to_string()),
        updated_at: Some(chrono::Utc::now().to_rfc3339()),
    };

    match serde_json::to_vec_pretty(&cache) {
        Ok(data) => {
            if let Err(e) = std::fs::write(path, data) {
                log::warn!("Failed to persist timetable API cache: {}", e);
            }
        }
        Err(e) => log::warn!("Failed to serialize timetable API cache: {}", e),
    }
}

/// Поиск Timetable API через mDNS (`_timetable-api._tcp`), без сканирования всей подсети.
async fn discover_timetable_via_mdns(timeout_secs: u64) -> Option<String> {
    let browse_timeout = Duration::from_secs(timeout_secs.max(5));
    let ts = timeout_secs;
    match tokio::time::timeout(
        browse_timeout,
        tokio::task::spawn_blocking(move || timetable_mdns::browse_timetable_api_blocking(ts)),
    )
    .await
    {
        Ok(Ok(Some(url))) => Some(url),
        Ok(Ok(None)) => None,
        Ok(Err(e)) => {
            log::warn!("timetable mDNS browse task failed: {}", e);
            None
        }
        Err(_) => {
            log::debug!("timetable mDNS discovery timed out after {}s", timeout_secs);
            None
        }
    }
}

async fn discover_direct_timetable_api() -> Option<String> {
    let mut seen = HashSet::new();
    let mut candidates = vec![
        format!("http://127.0.0.1:{}", TIMETABLE_API_PORT),
        format!("http://localhost:{}", TIMETABLE_API_PORT),
    ];

    for host in ["timetable-tv.local", "timetable-api.local"] {
        candidates.push(format!("http://{}:{}", host, TIMETABLE_API_PORT));
    }

    for ip in local_ipv4_candidates() {
        candidates.push(format!("http://{}:{}", ip, TIMETABLE_API_PORT));
    }

    for url in candidates {
        if !seen.insert(url.clone()) {
            continue;
        }

        if probe_timetable_api(&url, false).await.is_some() {
            log::info!("Resolved timetable API directly: {}", url);
            return Some(url);
        }
    }

    None
}

async fn discover_timetable_via_subnet_scan(timeout_secs: u64) -> Option<String> {
    let local_ips = local_ipv4_candidates();
    let prefixes = candidate_scan_prefixes(&local_ips);
    if prefixes.is_empty() {
        log::warn!("Cannot determine IPv4 subnets for timetable scan");
        return None;
    }

    log::info!("Scanning LAN for timetable API on prefixes {:?}", prefixes);
    tv_link::record_info(format!(
        "Сканировал подсети: {}",
        prefixes.iter().map(|p| format!("{}.0/24", p)).collect::<Vec<_>>().join(", ")
    ));

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(1200))
        .build()
        .ok()?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_secs.max(10));
    let mut tasks = JoinSet::new();

    for prefix in prefixes {
        for host in 1_u16..=254 {
            let client = client.clone();
            let base_url = format!("http://{}.{}:{}", prefix, host, TIMETABLE_API_PORT);
            tasks.spawn(async move { probe_timetable_with_client(client, base_url).await });
        }
    }

    while tokio::time::Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        match tokio::time::timeout(remaining.min(Duration::from_millis(500)), tasks.join_next()).await {
            Ok(Some(Ok(Some(url)))) => {
                log::info!("Found timetable API during LAN scan: {}", url);
                tasks.abort_all();
                return Some(url);
            }
            Ok(Some(Ok(None))) => {}
            Ok(Some(Err(e))) => log::debug!("Timetable scan task failed: {}", e),
            Ok(None) => break,
            Err(_) => {}
        }
    }

    tasks.abort_all();
    None
}

/// Адрес считается найденным, только если по нему отвечает настоящий TV с нашим ключом.
/// Если TV ждёт сопряжения — сопрягаемся автоматически, без кодов.
async fn probe_timetable_api(base_url: &str, important: bool) -> Option<String> {
    tv_link::ensure_paired(base_url, important).await.then(|| base_url.to_string())
}

async fn probe_timetable_with_client(
    client: reqwest::Client,
    base_url: String,
) -> Option<String> {
    tv_link::ensure_paired_with_client(&client, &base_url, false)
        .await
        .then_some(base_url)
}

fn preferred_subnet_prefix() -> Option<String> {
    std::env::var("TIMETABLE_PREFERRED_SUBNET")
        .ok()
        .and_then(|value| {
            let prefix = value.trim().trim_end_matches('.').to_string();
            if prefix.split('.').count() == 3 {
                Some(prefix)
            } else {
                None
            }
        })
}

fn local_ipv4_candidates() -> Vec<Ipv4Addr> {
    let preferred_prefix = preferred_subnet_prefix();
    let mut ips: Vec<Ipv4Addr> = local_ip_address::list_afinet_netifas()
        .ok()
        .into_iter()
        .flat_map(|entries| entries.into_iter())
        .filter_map(|(_, ip)| match ip {
            IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_link_local() => Some(ip),
            _ => None,
        })
        .collect();

    ips.sort_by_key(|ip| Reverse(ipv4_priority(*ip, preferred_prefix.as_deref())));
    ips.dedup();
    ips
}

fn candidate_scan_prefixes(local_ips: &[Ipv4Addr]) -> Vec<String> {
    let preferred_prefix = preferred_subnet_prefix();
    let mut seen = HashSet::new();
    let mut prefixes = Vec::new();

    if let Some(prefix) = preferred_prefix {
        if seen.insert(prefix.clone()) {
            prefixes.push(prefix);
        }
    }

    for ip in local_ips {
        let octets = ip.octets();
        let prefix = format!("{}.{}.{}", octets[0], octets[1], octets[2]);
        if seen.insert(prefix.clone()) {
            prefixes.push(prefix);
        }
    }

    prefixes
}

fn ipv4_priority(ip: Ipv4Addr, preferred_prefix: Option<&str>) -> i32 {
    let ip_str = ip.to_string();

    if preferred_prefix
        .map(|prefix| ip_str.starts_with(&format!("{}.", prefix)))
        .unwrap_or(false)
    {
        return 100;
    }

    let octets = ip.octets();
    if octets[0] == 172 && (16..=31).contains(&octets[1]) {
        30
    } else if octets[0] == 192 && octets[1] == 168 {
        20
    } else if octets[0] == 10 {
        10
    } else {
        0
    }
}