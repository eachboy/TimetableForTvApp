#![allow(unused_variables, unused_imports, dead_code)]
// src-tauri/src/update_server.rs  (Admin Panel)

use std::collections::HashMap;
use std::fs;
use std::io::{BufReader, Cursor};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use tiny_http::{Header, Method, Request, Response, ResponseBox, Server};
use tokio::fs as async_fs;
use tokio::runtime::Runtime;
use chrono::{Datelike, Local};
use crate::mdns_service::preferred_ipv4_string;
use crate::secure_channel::{self as sc, Psk};

/// Ключ этой панели (создаётся при первом запуске; см. tv_link::init).
fn psk() -> Option<Psk> {
    crate::tv_link::load_psk().ok()
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct WeatherData {
    pub temperature: f64,
    pub temp_min: Option<f64>,
    pub temp_max: Option<f64>,
    pub description: Option<String>,
    pub condition: Option<String>,
    pub date: Option<String>, // YYYY-MM-DD
}

async fn fetch_external_weather() -> Result<WeatherData, String> {
    // Берём погоду из Open‑Meteo с явными daily min/max, текущей температурой и кодом погоды.
    // Пример: https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&daily=temperature_2m_max,temperature_2m_min&hourly=temperature_2m&current=temperature_2m,weather_code
    let url = "https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&daily=temperature_2m_max,temperature_2m_min&hourly=temperature_2m&current=temperature_2m,weather_code";

    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("weather request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("weather HTTP status {}", resp.status()));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("weather json parse error: {}", e))?;

    // current.temperature_2m — текущая температура
    let temp = json["current"]["temperature_2m"]
        .as_f64()
        .ok_or_else(|| "no temp".to_string())?;

    // daily.temperature_2m_min/max[0] — минимум/максимум на сегодня
    let temp_min = json["daily"]["temperature_2m_min"]
        .get(0)
        .and_then(|v| v.as_f64());
    let temp_max = json["daily"]["temperature_2m_max"]
        .get(0)
        .and_then(|v| v.as_f64());

    // Код погоды Open‑Meteo: маппим в человекочитаемое описание и condition
    // для фронта (`clear`, `clouds`, `rain`, `snow`, ...).
    let weather_code = json["current"]["weather_code"].as_i64();

    let (description, condition) = if let Some(code) = weather_code {
        match code {
            0 => ("Ясно", "clear"),
            1 | 2 | 3 => ("Переменная облачность", "clouds"),
            45 | 48 => ("Туман", "fog"),
            51 | 53 | 55 | 56 | 57 => ("Морось", "drizzle"),
            61 | 63 | 65 | 66 | 67 | 80 | 81 | 82 => ("Дождь", "rain"),
            71 | 73 | 75 | 77 | 85 | 86 => ("Снег", "snow"),
            95 | 96 | 99 => ("Гроза", "thunderstorm"),
            _ => ("Погода", "unknown"),
        }
    } else {
        ("Погода", "unknown")
    };

    let description = Some(description.to_string());
    let condition = Some(condition.to_string());

    // Дата — daily.time[0] (YYYY‑MM‑DD). Если по какой‑то причине её нет,
    // подстраховываемся локальной датой.
    let date_from_api = json["daily"]["time"]
        .get(0)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let date = date_from_api.or_else(|| {
        let now = Local::now();
        Some(format!("{:04}-{:02}-{:02}", now.year(), now.month(), now.day()))
    });

    Ok(WeatherData {
        temperature: temp,
        temp_min,
        temp_max,
        description,
        condition,
        date,
    })
}

pub async fn write_weather_json(output_dir: PathBuf) -> Result<(), String> {
    // output_dir — та же директория, куда сейчас пишется latest.json
    let weather = match fetch_external_weather().await {
        Ok(w) => w,
        Err(e) => {
            log::warn!("Cannot fetch external weather: {}", e);
            return Err(e);
        }
    };

    let path = output_dir.join("weather.json");
    let data = serde_json::to_vec_pretty(&weather)
        .map_err(|e| format!("weather json serialize error: {}", e))?;

    async_fs::create_dir_all(&output_dir)
        .await
        .map_err(|e| format!("mkdir {:?} failed: {}", output_dir, e))?;

    async_fs::write(&path, &data)
        .await
        .map_err(|e| format!("write {:?} failed: {}", path, e))?;

    log::info!("weather.json written to {}", path.display());
    Ok(())
}

/// Информация о текущей раздаваемой версии
#[derive(Clone, Default)]
struct CachedVersion {
    version: Option<String>,
    notes: String,
    // platform -> (installer_path, sig_path)
    platforms: HashMap<String, (PathBuf, PathBuf)>,
}

pub struct UpdateServer {
    cache_dir: PathBuf,
    port: u16,
    public_base_url: String,
    cached: Arc<Mutex<CachedVersion>>,
}

impl UpdateServer {
    /// Запускает HTTP сервер в отдельном потоке
    pub fn start(cache_dir: PathBuf, port: u16) -> Result<Self, String> {
        let bind_addr = format!("0.0.0.0:{}", port);
        let server = Server::http(&bind_addr)
            .map_err(|e| format!("Cannot bind to {}: {}", bind_addr, e))?;
        let public_base_url = resolve_public_base_url(port);

        let cached = Arc::new(Mutex::new(CachedVersion::default()));
        let cached_clone = Arc::clone(&cached);
        let cache_dir_clone = cache_dir.clone();

        // Погода обновляется только по POST /weather/refresh (запрос с Timetable после handshake).

        // Пробуем загрузить уже существующую latest.json при старте
        {
            let latest_path = cache_dir.join("latest.json");
            if latest_path.exists() {
                if let Ok(data) = fs::read_to_string(&latest_path) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) {
                        Self::restore_cached_from_json(&json, &cache_dir, &cached);
                    }
                }
            }
        }

        thread::spawn(move || {
            log::info!("Update server listening on {}", bind_addr);
            for request in server.incoming_requests() {
                let url = request.url().to_string();
                log::debug!("Update server request: {} {:?}", request.method(), url);

                let response = Self::handle_request(&request, &cached_clone, &cache_dir_clone);
                if let Err(e) = request.respond(response) {
                    log::warn!("Failed to send response: {}", e);
                }
            }
        });

        Ok(Self {
            cache_dir,
            port,
            public_base_url,
            cached,
        })
    }

    pub fn cache_dir(&self) -> &Path {
        &self.cache_dir
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn public_base_url(&self) -> &str {
        &self.public_base_url
    }

    /// Сохраняет latest.json и регистрирует версию для раздачи
    pub fn publish_version(&self, version: &str, notes: &str) -> Result<(), String> {
        let version_dir = self.cache_dir.join(version);

        // Сканируем директорию, находим ассеты
        let mut platforms: HashMap<String, (PathBuf, PathBuf)> = HashMap::new();

        let platform_patterns = [
            ("windows-x86_64", ".msi", ".msi.sig"),
            ("linux-x86_64", ".AppImage", ".AppImage.sig"),
        ];

        for (platform, ext, sig_ext) in &platform_patterns {
            // Ищем файл установщика
            let installer = Self::find_file_by_ext(&version_dir, ext);
            let sig = Self::find_file_by_ext(&version_dir, sig_ext);

            if let (Some(inst), Some(s)) = (installer, sig) {
                platforms.insert(platform.to_string(), (inst, s));
            }
        }

        if platforms.is_empty() {
            return Err(format!("No installer files found in {:?}", version_dir));
        }

        // Строим latest.json в формате Tauri Updater v2
        let mut platforms_json = serde_json::Map::new();

        for (platform, (inst_path, sig_path)) in &platforms {
            let sig = fs::read_to_string(sig_path)
                .map_err(|e| format!("Cannot read sig file: {}", e))?;

            let filename = inst_path.file_name().unwrap().to_string_lossy();
            let download_url = format!(
                "{}/download/{}",
                self.public_base_url, filename
            );

            platforms_json.insert(
                platform.clone(),
                serde_json::json!({
                    "signature": sig.trim(),
                    "url": download_url,
                }),
            );
        }

        let latest = serde_json::json!({
            "version": version,
            "notes": notes,
            "pub_date": chrono_now_rfc3339(),
            "platforms": platforms_json,
        });

        let latest_path = self.cache_dir.join("latest.json");
        fs::write(&latest_path, serde_json::to_string_pretty(&latest).unwrap())
            .map_err(|e| format!("Cannot write latest.json: {}", e))?;

        // Обновляем состояние в памяти
        let mut cached = self.cached.lock().unwrap();
        cached.version = Some(version.to_string());
        cached.notes = notes.to_string();
        cached.platforms = platforms;

        log::info!("Published version {} for platforms: {:?}", version, cached.platforms.keys().collect::<Vec<_>>());
        Ok(())
    }

    pub fn cached_version_info(&self) -> serde_json::Value {
        let cached = self.cached.lock().unwrap();
        serde_json::json!({
            "version": cached.version,
            "ready": cached.version.is_some(),
            "platforms": cached.platforms.keys().cloned().collect::<Vec<_>>(),
        })
    }

    // ─── HTTP обработчик ─────────────────────────────────────────────────────

    fn handle_request(
        request: &Request,
        cached: &Arc<Mutex<CachedVersion>>,
        cache_dir: &Path,
    ) -> ResponseBox {
        let url = request.url();
        let path = url.split('?').next().unwrap_or(url);

        if request.method() == &Method::Post && path == "/weather/refresh" {
            // Обновление погоды запускает внешний HTTP-запрос — разрешаем только TV с общим ключом.
            let authorized = match (psk(), Self::header_value(request, "X-TT-Auth")) {
                (Some(psk), Some(value)) => sc::verify_auth_header(
                    &psk,
                    sc::PURPOSE_WEATHER_REFRESH,
                    &value,
                    sc::now_ms(),
                ),
                _ => false,
            };
            if !authorized {
                log::warn!("POST /weather/refresh rejected: missing or invalid X-TT-Auth");
                return Self::serve_text(tiny_http::StatusCode(401), "unauthorized");
            }
            log::info!("POST /weather/refresh — fetching weather from Open-Meteo");
            if let Ok(rt) = Runtime::new() {
                match rt.block_on(write_weather_json(cache_dir.to_path_buf())) {
                    Ok(()) => return Self::serve_empty(tiny_http::StatusCode(204)),
                    Err(e) => {
                        log::warn!("weather refresh failed: {}", e);
                        return Self::serve_text(tiny_http::StatusCode(500), &format!("refresh failed: {}", e));
                    }
                }
            }
            return Self::serve_text(
                tiny_http::StatusCode(500),
                "cannot create runtime for weather refresh",
            );
        }

        if path == "/healthz" {
            Self::serve_empty(tiny_http::StatusCode(204))
        } else if path == "/latest.json" || path.starts_with("/update/") {
            Self::serve_latest_json(cache_dir)
        } else if path == "/weather.json" {
            let path = cache_dir.join("weather.json");
            Self::serve_signed_json(&path)
        } else if let Some(filename) = path.strip_prefix("/download/") {
            // Безопасность: только имя файла, без ../ и т.д.
            let safe_name = Path::new(filename)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if let Some(file_path) = Self::resolve_cached_download_path(cached, &safe_name) {
                Self::serve_file(&file_path)
            } else {
                Self::serve_file(&cache_dir.join(safe_name))
            }
        } else {
            Self::serve_text(tiny_http::StatusCode(404), "Not found")
        }
    }

    fn header_value(request: &Request, name: &str) -> Option<String> {
        request
            .headers()
            .iter()
            .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
            .map(|h| h.value.as_str().to_string())
    }

    /// Отдаёт JSON с подписью `X-TT-Sig` (HMAC общего ключа): TV отвергает подделанную погоду.
    fn serve_signed_json(path: &Path) -> ResponseBox {
        let data = match fs::read(path) {
            Ok(d) => d,
            Err(e) => {
                log::warn!("File not found: {:?} — {}", path, e);
                return Self::serve_text(tiny_http::StatusCode(404), "Not found");
            }
        };
        let Some(psk) = psk() else {
            return Self::serve_text(tiny_http::StatusCode(503), "pairing key is not configured");
        };
        let signature = sc::sign(&psk, sc::CONTEXT_WEATHER, &data);
        let len = data.len();
        Response::new(
            tiny_http::StatusCode(200),
            vec![
                Header::from_bytes("Content-Type", "application/json").unwrap(),
                Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap(),
                Header::from_bytes("X-TT-Sig", signature.as_bytes()).unwrap(),
            ],
            Box::new(Cursor::new(data)),
            Some(len),
            None,
        )
    }

    fn serve_latest_json(cache_dir: &Path) -> ResponseBox {
        let path = cache_dir.join("latest.json");
        Self::serve_file(&path)
    }

    fn serve_file(path: &Path) -> ResponseBox {
        match fs::File::open(path) {
            Ok(file) => {
                let len = file.metadata().map(|m| m.len()).unwrap_or(0);
                let reader = Box::new(BufReader::new(file));

                let content_type = if path.extension().and_then(|e| e.to_str()) == Some("json") {
                    "application/json"
                } else {
                    "application/octet-stream"
                };

                Response::new(
                    tiny_http::StatusCode(200),
                    vec![
                        Header::from_bytes(
                            "Content-Type",
                            content_type,
                        )
                        .unwrap(),
                        Header::from_bytes(
                            "Access-Control-Allow-Origin",
                            "*",
                        )
                        .unwrap(),
                    ],
                    reader,
                    Some(len as usize),
                    None,
                )
            }
            Err(e) => {
                log::warn!("File not found: {:?} — {}", path, e);
                Self::serve_text(tiny_http::StatusCode(404), "Not found")
            }
        }
    }

    fn serve_empty(status: tiny_http::StatusCode) -> ResponseBox {
        Response::new(
            status,
            vec![
                Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap(),
                Header::from_bytes("Content-Length", "0").unwrap(),
            ],
            Box::new(Cursor::new(Vec::new())),
            Some(0),
            None,
        )
    }

    fn serve_text(status: tiny_http::StatusCode, body: &str) -> ResponseBox {
        let bytes = body.as_bytes().to_vec();
        Response::new(
            status,
            vec![
                Header::from_bytes("Content-Type", "text/plain; charset=utf-8").unwrap(),
                Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap(),
            ],
            Box::new(Cursor::new(bytes.clone())),
            Some(bytes.len()),
            None,
        )
    }

    fn find_file_by_ext(dir: &Path, ext: &str) -> Option<PathBuf> {
        fs::read_dir(dir).ok()?.find_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(ext) {
                Some(entry.path())
            } else {
                None
            }
        })
    }

    fn resolve_cached_download_path(
        cached: &Arc<Mutex<CachedVersion>>,
        filename: &str,
    ) -> Option<PathBuf> {
        let cached = cached.lock().ok()?;
        for (installer_path, sig_path) in cached.platforms.values() {
            for candidate in [installer_path, sig_path] {
                let matches = candidate
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name == filename)
                    .unwrap_or(false);
                if matches {
                    return Some(candidate.clone());
                }
            }
        }
        None
    }

    fn restore_cached_from_json(
        json: &serde_json::Value,
        cache_dir: &Path,
        cached: &Arc<Mutex<CachedVersion>>,
    ) {
        if let Some(version) = json["version"].as_str() {
            let mut c = cached.lock().unwrap();
            c.version = Some(version.to_string());
            c.notes = json["notes"].as_str().unwrap_or("").to_string();
        }
    }
}

fn chrono_now_rfc3339() -> String {
    // Простая реализация без chrono зависимости
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Базовое RFC3339 — для точного времени можно добавить chrono
    let s = secs;
    let sec = s % 60;
    let min = (s / 60) % 60;
    let hour = (s / 3600) % 24;
    let _days = s / 86400;

    // Упрощённо: возвращаем Unix timestamp в ISO-подобном формате
    // В продакшене замените на chrono::Utc::now().to_rfc3339()
    format!("2025-01-01T{:02}:{:02}:{:02}Z", hour % 24, min, sec)
}

fn resolve_public_base_url(port: u16) -> String {
    if let Ok(raw_url) = std::env::var("TIMETABLE_UPDATE_SERVER_URL") {
        let normalized = raw_url.trim().trim_end_matches('/').to_string();
        if !normalized.is_empty() {
            log::info!(
                "Using TIMETABLE_UPDATE_SERVER_URL as public update endpoint: {}",
                normalized
            );
            return normalized;
        }
    }

    let host = preferred_ipv4_string().unwrap_or_else(|| "127.0.0.1".to_string());
    format!("http://{}:{}", host, port)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "update-server-test-secret";

    fn free_port() -> u16 {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    }

    fn start() -> (tempfile::TempDir, u16) {
        std::env::set_var("TIMETABLE_PSK", SECRET);
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("weather.json"),
            r#"{"temperature":3.5,"temp_min":1.0,"temp_max":6.0,"description":"Ясно","condition":"clear","date":"2026-10-20"}"#
                .as_bytes(),
        )
        .unwrap();
        let port = free_port();
        let _server = UpdateServer::start(dir.path().to_path_buf(), port).expect("start");
        std::mem::forget(_server);
        (dir, port)
    }

    #[test]
    fn weather_json_is_signed_and_signature_detects_tampering() {
        let (_dir, port) = start();
        let resp = reqwest::blocking::get(format!("http://127.0.0.1:{}/weather.json", port)).unwrap();
        assert!(resp.status().is_success());
        let sig = resp.headers().get("x-tt-sig").expect("X-TT-Sig header").to_str().unwrap().to_string();
        let body = resp.bytes().unwrap();

        let psk = Psk::from_secret(SECRET);
        assert!(sc::verify_sig(&psk, sc::CONTEXT_WEATHER, &body, &sig));
        // подмена тела в сети не пройдёт проверку
        let forged = br#"{"temperature":-50.0}"#;
        assert!(!sc::verify_sig(&psk, sc::CONTEXT_WEATHER, forged, &sig));
        // и чужой ключ тоже
        assert!(!sc::verify_sig(&Psk::from_secret("other"), sc::CONTEXT_WEATHER, &body, &sig));
    }

    #[test]
    fn weather_refresh_requires_valid_auth_header() {
        let (_dir, port) = start();
        let url = format!("http://127.0.0.1:{}/weather/refresh", port);
        let client = reqwest::blocking::Client::new();

        // без заголовка
        assert_eq!(client.post(&url).send().unwrap().status().as_u16(), 401);
        // мусор
        assert_eq!(client.post(&url).header("X-TT-Auth", "1.deadbeef").send().unwrap().status().as_u16(), 401);
        // подпись другим ключом
        let bad = sc::make_auth_header(&Psk::from_secret("other"), sc::PURPOSE_WEATHER_REFRESH, sc::now_ms());
        assert_eq!(client.post(&url).header("X-TT-Auth", bad).send().unwrap().status().as_u16(), 401);
        // просроченная подпись
        let old = sc::make_auth_header(&Psk::from_secret(SECRET), sc::PURPOSE_WEATHER_REFRESH, sc::now_ms() - 3_600_000);
        assert_eq!(client.post(&url).header("X-TT-Auth", old).send().unwrap().status().as_u16(), 401);
    }

    #[test]
    fn weather_refresh_accepts_valid_header() {
        let (_dir, port) = start();
        let url = format!("http://127.0.0.1:{}/weather/refresh", port);
        let ok = sc::make_auth_header(&Psk::from_secret(SECRET), sc::PURPOSE_WEATHER_REFRESH, sc::now_ms());
        let status = reqwest::blocking::Client::new()
            .post(&url)
            .header("X-TT-Auth", ok)
            .send()
            .unwrap()
            .status()
            .as_u16();
        // Авторизация пройдена; дальше 204 (есть интернет) или 500 (нет доступа к Open-Meteo) — но не 401.
        assert_ne!(status, 401);
    }
}
