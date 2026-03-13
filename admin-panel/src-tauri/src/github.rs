use std::path::Path;
use reqwest::header::AUTHORIZATION;

const REPO: &str = "eachboy/TimetableForTvApp";

pub struct DownloadResult {
    pub downloaded_files: Vec<String>,
    pub notes: String,
}

/// Проверить последний релиз на GitHub
pub async fn check_latest_release(
    current_version: &str,
    token: Option<&str>,
) -> Result<serde_json::Value, String> {
    let url = format!("https://api.github.com/repos/{}/releases/latest", REPO);
    let client = build_client(token)?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("GitHub request failed: {}", e))?;

    if resp.status() == 404 {
        return Ok(serde_json::json!({
            "hasUpdate": false,
            "error": "No releases found",
        }));
    }

    if !resp.status().is_success() {
        return Err(format!("GitHub API: HTTP {}", resp.status()));
    }

    let release: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("JSON parse error: {}", e))?;

    let latest_tag = release["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v');

    let has_update = semver_gt(latest_tag, current_version);

    Ok(serde_json::json!({
        "hasUpdate": has_update,
        "latestVersion": latest_tag,
        "currentVersion": current_version,
        "releaseNotes": release["body"].as_str().unwrap_or(""),
        "publishedAt": release["published_at"].as_str().unwrap_or(""),
        "htmlUrl": release["html_url"].as_str().unwrap_or(""),
        "assets": release["assets"]
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .map(|a| serde_json::json!({
                "name": a["name"],
                "size": a["size"],
                "downloadUrl": a["browser_download_url"],
            }))
            .collect::<Vec<_>>(),
    }))
}

/// Скачать ассеты конкретного релиза в директорию кэша
pub async fn download_release(
    version: &str,
    token: Option<&str>,
    cache_dir: &Path,
) -> Result<DownloadResult, String> {
    let url = format!(
        "https://api.github.com/repos/{}/releases/tags/v{}",
        REPO, version
    );
    let client = build_client(token)?;

    let release: serde_json::Value = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let notes = release["body"]
        .as_str()
        .unwrap_or("No release notes")
        .to_string();

    let assets = release["assets"]
        .as_array()
        .ok_or("No assets in release")?;

    // Создаём директорию для этой версии
    let version_dir = cache_dir.join(version);
    std::fs::create_dir_all(&version_dir).map_err(|e| e.to_string())?;

    // Скачиваем только нужные ассеты:
    // Windows: .msi + .msi.sig
    // Linux:   .AppImage + .AppImage.sig
    let needed_extensions = [".msi", ".msi.sig", ".AppImage", ".AppImage.sig"];
    let mut downloaded_files = vec![];

    for asset in assets {
        let name = asset["name"].as_str().unwrap_or("");
        let download_url = asset["browser_download_url"].as_str().unwrap_or("");

        let is_needed = needed_extensions.iter().any(|ext| name.ends_with(ext));
        if !is_needed || download_url.is_empty() {
            continue;
        }

        let file_path = version_dir.join(name);

        // Пропускаем уже скачанные файлы
        if file_path.exists() {
            log::info!("Already cached: {}", name);
            downloaded_files.push(name.to_string());
            continue;
        }

        log::info!("Downloading: {} ...", name);

        let bytes = client
            .get(download_url)
            .send()
            .await
            .map_err(|e| format!("Download error {}: {}", name, e))?
            .bytes()
            .await
            .map_err(|e| e.to_string())?;

        std::fs::write(&file_path, &bytes)
            .map_err(|e| format!("Write error {}: {}", name, e))?;

        log::info!("Downloaded: {} ({} bytes)", name, bytes.len());
        downloaded_files.push(name.to_string());
    }

    if downloaded_files.is_empty() {
        return Err(format!(
            "No installer assets found for version {}. \
             Make sure the CD workflow produced .msi/.AppImage files.",
            version
        ));
    }

    Ok(DownloadResult {
        downloaded_files,
        notes,
    })
}

// ─── Утилиты ─────────────────────────────────────────────────────────────────

fn build_client(token: Option<&str>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent("TimetableAdminPanel/1.0");

    if let Some(t) = token {
        if !t.is_empty() {
            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert(
                AUTHORIZATION,
                format!("Bearer {}", t)
                    .parse()
                    .map_err(|e: reqwest::header::InvalidHeaderValue| e.to_string())?,
            );
            builder = builder.default_headers(headers);
        }
    }

    builder.build().map_err(|e| e.to_string())
}

/// Сравнение semver: возвращает true если a > b
fn semver_gt(a: &str, b: &str) -> bool {
    let parse = |v: &str| -> (u64, u64, u64) {
        let p: Vec<&str> = v.split('.').collect();
        let n = |i: usize| -> u64 {
            p.get(i)
                .and_then(|s| s.parse().ok())
                .unwrap_or(0)
        };
        (n(0), n(1), n(2))
    };
    parse(a) > parse(b)
}