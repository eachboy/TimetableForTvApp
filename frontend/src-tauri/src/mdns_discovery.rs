// src-tauri/src/mdns_discovery.rs  (Frontend / TV)
//
// TV НЕ ищет admin-panel сам: он пассивно ждёт, пока admin-panel найдёт его и
// пришлёт зашифрованный `register` (см. api_server.rs → /api/admin-panel/register).
// Здесь остаётся только работа с уже известным адресом панели:
//   1. URL, сохранённый при последнем успешном handshake (admin-panel.json);
//   2. URL из переменных окружения (ручная настройка, опционально).
// Никакого сканирования подсети и mDNS-поиска со стороны TV больше нет.

use std::time::Duration;

use crate::admin_panel_config;

/// Лёгкие пути admin-panel для проверки доступности.
const ADMIN_PANEL_PROBE_PATHS: &[&str] = &["healthz", "latest.json", "weather.json"];

pub async fn discover_update_server(timeout_secs: u64) -> Option<String> {
    known_admin_panel_url(timeout_secs).await
}

pub async fn discover_weather_server(timeout_secs: u64) -> Option<String> {
    known_admin_panel_url(timeout_secs).await
}

/// Известен ли вообще адрес панели (иначе TV просто ждёт handshake и не считает это ошибкой).
pub fn has_known_admin_panel() -> bool {
    admin_panel_config::load_admin_panel_url().is_some() || !configured_urls().is_empty()
}

async fn known_admin_panel_url(_timeout_secs: u64) -> Option<String> {
    if admin_panel_config::waiting_for_handshake() {
        log::info!("{}", admin_panel_config::waiting_message());
        return None;
    }

    let mut candidates: Vec<String> = Vec::new();
    if let Some(url) = admin_panel_config::load_admin_panel_url() {
        candidates.push(url);
    }
    for url in configured_urls() {
        if !candidates.contains(&url) {
            candidates.push(url);
        }
    }

    for url in candidates {
        if probe_admin_panel_url(&url).await {
            return Some(url);
        }
        log::warn!("Admin-panel is not reachable at {}", url);
    }
    None
}

fn configured_urls() -> Vec<String> {
    let mut out = Vec::new();
    for key in ["TIMETABLE_UPDATE_SERVER_URL", "TIMETABLE_ADMIN_PANEL_URL"] {
        if let Ok(value) = std::env::var(key) {
            let normalized = value.trim().trim_end_matches('/').to_string();
            if !normalized.is_empty() && !out.contains(&normalized) {
                out.push(normalized);
            }
        }
    }
    out
}

async fn probe_admin_panel_url(base_url: &str) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(1500))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    for path in ADMIN_PANEL_PROBE_PATHS {
        let url = format!("{}/{}", base_url.trim_end_matches('/'), path);
        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().is_success() {
                return true;
            }
        }
    }
    false
}
