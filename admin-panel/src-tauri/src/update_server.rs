#![allow(unused_variables, unused_imports, dead_code)]
// src-tauri/src/update_server.rs  (Admin Panel)

use std::collections::HashMap;
use std::fs;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use tiny_http::{Header, Response, Server};
use tokio::fs as async_fs;
use tokio::runtime::Runtime;
use chrono::{Datelike, Local};

const WEATHER_TTL_SECS: u64 = 20 * 60;

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
    cached: Arc<Mutex<CachedVersion>>,
}

impl UpdateServer {
    /// Запускает HTTP сервер в отдельном потоке
    pub fn start(cache_dir: PathBuf, port: u16) -> Result<Self, String> {
        let bind_addr = format!("0.0.0.0:{}", port);
        let server = Server::http(&bind_addr)
            .map_err(|e| format!("Cannot bind to {}: {}", bind_addr, e))?;

        let cached = Arc::new(Mutex::new(CachedVersion::default()));
        let cached_clone = Arc::clone(&cached);
        let cache_dir_clone = cache_dir.clone();

        // При старте сразу пытаемся подготовить weather.json, если его ещё нет.
        // Делаем это в отдельном системном потоке, чтобы не создавать Tokio runtime
        // внутри уже работающего runtime (иначе получаем панику).
        {
            let cache_dir_clone_for_weather = cache_dir.clone();
            thread::spawn(move || {
                let weather_path = cache_dir_clone_for_weather.join("weather.json");
                if weather_path.exists() {
                    return;
                }
                log::info!(
                    "weather.json not found at startup, trying to generate it in background..."
                );
                if let Ok(rt) = Runtime::new() {
                    if let Err(e) =
                        rt.block_on(write_weather_json(cache_dir_clone_for_weather.clone()))
                    {
                        log::warn!("Initial weather.json generation failed: {}", e);
                    }
                } else {
                    log::warn!("Tokio runtime for initial weather.json not created");
                }
            });
        }

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
                log::debug!("Update server request: {}", url);

                let response = Self::handle_request(&url, &cached_clone, &cache_dir_clone);
                if let Err(e) = request.respond(response) {
                    log::warn!("Failed to send response: {}", e);
                }
            }
        });

        Ok(Self { cache_dir, port, cached })
    }

    pub fn cache_dir(&self) -> &Path {
        &self.cache_dir
    }

    pub fn port(&self) -> u16 {
        self.port
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
                "http://timetable-admin.local:{}/download/{}",
                self.port, filename
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

        // Пытаемся обновить weather.json рядом с latest.json
        if let Ok(rt) = Runtime::new() {
            if let Err(e) = rt.block_on(write_weather_json(self.cache_dir.clone())) {
                log::warn!("weather.json not updated: {}", e);
            }
        } else {
            log::warn!("Tokio runtime for weather.json not created");
        }

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
        url: &str,
        cached: &Arc<Mutex<CachedVersion>>,
        cache_dir: &Path,
    ) -> Response<BufReader<fs::File>> {
        // Tauri Updater v2 делает запрос:
        // GET /update/{target}/{arch}/{current_version}
        // Мы также поддерживаем:
        // GET /latest.json          — прямой доступ к манифесту
        // GET /download/{filename}  — скачать установщик

        let path = url.split('?').next().unwrap_or(url);

        if path == "/latest.json" || path.starts_with("/update/") {
            Self::serve_latest_json(cache_dir)
        } else if path == "/weather.json" {
            Self::ensure_fresh_weather(cache_dir);
            let path = cache_dir.join("weather.json");
            Self::serve_file(&path)
        } else if let Some(filename) = path.strip_prefix("/download/") {
            // Безопасность: только имя файла, без ../ и т.д.
            let safe_name = Path::new(filename)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            Self::serve_file(&cache_dir.join(safe_name))
        } else {
            // 404
            let data = b"Not found".to_vec();
            let _cursor = std::io::Cursor::new(data);
            // tiny_http не поддерживает Cursor напрямую — конвертируем через temp
            Self::serve_latest_json(cache_dir) // fallback
        }
    }

    fn serve_latest_json(cache_dir: &Path) -> Response<BufReader<fs::File>> {
        let path = cache_dir.join("latest.json");
        Self::serve_file(&path)
    }

    fn ensure_fresh_weather(cache_dir: &Path) {
        use std::time::{SystemTime, UNIX_EPOCH};

        let path = cache_dir.join("weather.json");

        let needs_refresh = match fs::metadata(&path) {
            Ok(meta) => {
                if let Ok(modified) = meta.modified() {
                    if let Ok(age) = SystemTime::now().duration_since(modified) {
                        age.as_secs() >= WEATHER_TTL_SECS
                    } else {
                        true
                    }
                } else {
                    true
                }
            }
            Err(_) => true,
        };

        if !needs_refresh {
            return;
        }

        log::info!("Refreshing weather.json in {:?}", cache_dir);
        if let Ok(rt) = Runtime::new() {
            if let Err(e) = rt.block_on(write_weather_json(cache_dir.to_path_buf())) {
                log::warn!("Failed to refresh weather.json: {}", e);
            }
        } else {
            log::warn!("Tokio runtime for weather.json not created (on /weather.json request)");
        }
    }

    fn serve_file(path: &Path) -> Response<BufReader<fs::File>> {
        match fs::File::open(path) {
            Ok(file) => {
                let len = file.metadata().map(|m| m.len()).unwrap_or(0);
                let reader = BufReader::new(file);

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
                // Возвращаем пустой ответ 404
                let empty = fs::File::open(std::env::current_exe().unwrap()).unwrap();
                Response::new(
                    tiny_http::StatusCode(404),
                    vec![],
                    BufReader::new(empty),
                    Some(0),
                    None,
                )
            }
        }
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