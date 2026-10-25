use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex, OnceLock};

const FAILURE_THRESHOLD: u32 = 10;

static CONFIG_PATH: OnceLock<PathBuf> = OnceLock::new();
static DISCOVERY_STATE: LazyLock<Mutex<DiscoveryRuntimeState>> =
    LazyLock::new(|| Mutex::new(DiscoveryRuntimeState::default()));

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AdminPanelConfig {
    pub base_url: Option<String>,
    /// IP клиента admin-panel при последнем handshake (для триггера погоды по запросам к API).
    #[serde(default)]
    pub last_admin_ip: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub struct DiscoveryStatus {
    pub failure_count: u32,
    pub waiting_for_handshake: bool,
}

#[derive(Debug, Default)]
struct DiscoveryRuntimeState {
    failure_count: u32,
    waiting_for_handshake: bool,
}

pub fn initialize(path: PathBuf) {
    let _ = CONFIG_PATH.set(path);
}

pub fn load_admin_panel_url() -> Option<String> {
    load_config().and_then(|config| config.base_url)
}

/// IP admin-panel, зафиксированный при последнем `POST /api/admin-panel/register`.
pub fn load_last_admin_ip() -> Option<IpAddr> {
    load_config()
        .and_then(|c| c.last_admin_ip)
        .and_then(|s| s.parse().ok())
}

pub fn save_admin_panel_url(base_url: &str, client_ip: IpAddr) -> Result<String, String> {
    let normalized = normalize_base_url(base_url)?;
    let path = config_path()?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let config = AdminPanelConfig {
        base_url: Some(normalized.clone()),
        last_admin_ip: Some(client_ip.to_string()),
        updated_at: Some(chrono::Utc::now().to_rfc3339()),
    };
    let data = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())?;

    record_connection_success();
    log::info!(
        "Saved admin-panel URL to config: {} (client_ip={})",
        normalized,
        client_ip
    );
    Ok(normalized)
}

pub fn current_status() -> DiscoveryStatus {
    let state = DISCOVERY_STATE.lock().unwrap();
    DiscoveryStatus {
        failure_count: state.failure_count,
        waiting_for_handshake: state.waiting_for_handshake,
    }
}

pub fn waiting_for_handshake() -> bool {
    current_status().waiting_for_handshake
}

pub fn waiting_message() -> String {
    format!(
        "Waiting for admin-panel handshake after {} failed connection attempts",
        FAILURE_THRESHOLD
    )
}

pub fn record_connection_success() {
    let mut state = DISCOVERY_STATE.lock().unwrap();
    if state.failure_count > 0 || state.waiting_for_handshake {
        log::info!("Admin-panel connection restored, resetting failure counter");
    }
    state.failure_count = 0;
    state.waiting_for_handshake = false;
}

pub fn record_connection_failure() -> DiscoveryStatus {
    let mut state = DISCOVERY_STATE.lock().unwrap();
    if !state.waiting_for_handshake {
        state.failure_count = state.failure_count.saturating_add(1);
        if state.failure_count >= FAILURE_THRESHOLD {
            state.failure_count = FAILURE_THRESHOLD;
            state.waiting_for_handshake = true;
            log::warn!(
                "Admin-panel connection failed {} times, waiting for handshake",
                FAILURE_THRESHOLD
            );
        }
    }

    DiscoveryStatus {
        failure_count: state.failure_count,
        waiting_for_handshake: state.waiting_for_handshake,
    }
}

fn load_config() -> Option<AdminPanelConfig> {
    let path = CONFIG_PATH.get()?;
    let data = std::fs::read(path).ok()?;
    serde_json::from_slice(&data).ok()
}

fn config_path() -> Result<&'static PathBuf, String> {
    CONFIG_PATH
        .get()
        .ok_or_else(|| "Admin-panel config path is not initialized".to_string())
}

fn normalize_base_url(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    let parsed = url::Url::parse(trimmed).map_err(|e| e.to_string())?;

    match parsed.scheme() {
        "http" | "https" => {}
        scheme => return Err(format!("Unsupported admin-panel URL scheme: {}", scheme)),
    }

    if parsed.host_str().is_none() {
        return Err("Admin-panel URL must include a host".to_string());
    }

    let mut normalized = parsed;
    normalized.set_query(None);
    normalized.set_fragment(None);
    normalized.set_path("");

    Ok(normalized.to_string().trim_end_matches('/').to_string())
}
