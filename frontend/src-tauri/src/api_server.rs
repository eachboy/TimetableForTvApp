//! HTTP API на 127.0.0.1:8000 — полный аналог Python-бэкенда для admin panel.

use axum::{
    extract::{ConnectInfo, DefaultBodyLimit, Multipart, Path, Query, State},
    Extension,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use serde::Deserialize;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::admin_panel_config;
use crate::db::{
    self, AccountRow, ActiveScheduleItem, MediaRow, NewsRow, NotificationRow, RoomRow,
    ScheduleItemRow, TeacherRow,
};

const ACCESS_TOKEN_EXPIRE_HOURS: i64 = 2;
/// Максимальный размер тела запроса (видео, резервная копия БД).
const API_BODY_LIMIT: usize = 500 * 1024 * 1024;

/// Минимум между вызовами `POST .../weather/refresh` при запросах с IP панели (кроме register).
const ADMIN_PANEL_WEATHER_REFRESH_MIN_INTERVAL: Duration = Duration::from_secs(60);

lazy_static::lazy_static! {
    static ref LAST_ADMIN_WEATHER_REFRESH: Mutex<Option<Instant>> = Mutex::new(None);
}

#[derive(Clone)]
struct AppState {
    media_dir: PathBuf,
}

/// CORS: preflight (OPTIONS) и заголовки на всех ответах.
/// Для запросов с заголовком Origin возвращаем его в Allow-Origin (нужно для admin-panel с Authorization).
async fn cors_middleware(request: axum::extract::Request, next: Next) -> Response {
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let origin_ok = origin.as_ref().map(|o| {
        o.starts_with("http://127.0.0.1")
            || o.starts_with("http://localhost")
            || o.starts_with("https://127.0.0.1")
            || o.starts_with("https://localhost")
    });
    let allow_origin = origin_ok
        .and_then(|_| origin.as_ref())
        .and_then(|o| HeaderValue::from_str(o).ok())
        .unwrap_or_else(|| HeaderValue::from_static("*"));

    let base_cors = [
        (
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET, POST, PUT, DELETE, PATCH, OPTIONS"),
        ),
        (
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("Content-Type, Authorization"),
        ),
        (header::ACCESS_CONTROL_MAX_AGE, HeaderValue::from_static("86400")),
    ];
    if request.method() == axum::http::Method::OPTIONS {
        let mut h = axum::http::HeaderMap::new();
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, allow_origin.clone());
        if allow_origin.as_bytes() != b"*" {
            h.insert(
                header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
                HeaderValue::from_static("true"),
            );
        }
        for (k, v) in &base_cors {
            h.insert(k.clone(), v.clone());
        }
        return (StatusCode::NO_CONTENT, h).into_response();
    }
    let response = next.run(request).await;
    let (mut parts, body) = response.into_parts();
    parts.headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, allow_origin.clone());
    if allow_origin.as_bytes() != b"*" {
        parts.headers.insert(
            header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
            HeaderValue::from_static("true"),
        );
    }
    for (k, v) in &base_cors {
        parts.headers.insert(k.clone(), v.clone());
    }
    Response::from_parts(parts, body)
}

/// Триггер обновления погоды на admin-panel (Open-Meteo → weather.json в cache update-сервера).
async fn request_admin_panel_weather_refresh(base_url: &str) {
    let url = format!("{}/weather/refresh", base_url.trim_end_matches('/'));
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::warn!("weather refresh: cannot build HTTP client: {}", e);
            return;
        }
    };
    let mut request = client.post(&url);
    if let Some(psk) = crate::secure_api::security().signing_psk() {
        request = request.header(
            "X-TT-Auth",
            crate::secure_channel::make_auth_header(
                &psk,
                crate::secure_channel::PURPOSE_WEATHER_REFRESH,
                crate::secure_api::admin_now_ms(),
            ),
        );
    }
    match request.send().await {
        Ok(resp) if resp.status().is_success() => {
            log::info!("Admin-panel weather refresh OK ({})", url);
        }
        Ok(resp) => {
            log::warn!(
                "Admin-panel weather refresh returned {} for {}",
                resp.status(),
                url
            );
        }
        Err(e) => log::warn!("Admin-panel weather refresh request failed: {} ({})", e, url),
    }
}

fn try_schedule_throttled_admin_panel_weather_refresh(base_url: String) {
    let mut last = LAST_ADMIN_WEATHER_REFRESH.lock().unwrap();
    let now = Instant::now();
    if let Some(prev) = *last {
        if now.duration_since(prev) < ADMIN_PANEL_WEATHER_REFRESH_MIN_INTERVAL {
            return;
        }
    }
    *last = Some(now);
    drop(last);
    tokio::spawn(async move {
        request_admin_panel_weather_refresh(&base_url).await;
    });
}

fn should_trigger_weather_refresh_for_client(path: &str, client_ip: IpAddr) -> bool {
    if !path.starts_with("/api/") {
        return false;
    }
    if matches!(
        path,
        "/api/health" | "/api/auth/login" | "/api/admin-panel/register" | "/api/security/status"
    ) {
        return false;
    }
    let Some(stored) = admin_panel_config::load_last_admin_ip() else {
        return false;
    };
    client_ip == stored
}

/// При запросах к API с IP admin-panel — просим панель обновить weather.json (с троттлингом).
async fn admin_panel_weather_middleware(
    ConnectInfo(remote_addr): ConnectInfo<SocketAddr>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    if *request.method() == axum::http::Method::OPTIONS {
        return next.run(request).await;
    }
    let path = request.uri().path();
    if should_trigger_weather_refresh_for_client(path, remote_addr.ip()) {
        if let Some(base) = admin_panel_config::load_admin_panel_url() {
            try_schedule_throttled_admin_panel_weather_refresh(base);
        }
    }
    next.run(request).await
}

/// Собирает Router API (для встраивания в Tauri или для standalone-бинарника).
/// Возвращает Router<()> (state уже подставлен), пригодный для into_make_service().
///
/// Структура:
/// * `api` — обработчики `/api/*` (с проверкой JWT для изменяющих запросов);
/// * внешний роутер добавляет `/sc/hello`, туннель `/sc` (внутри — тот же `api`),
///   политику «снаружи только шифрованный канал» и CORS.
pub fn create_app(media_dir: PathBuf) -> Router<()> {
    let state = Arc::new(AppState { media_dir });

    let api: Router<()> = Router::new()
        .route("/", get(root))
        .route("/api/health", get(api_health))
        .route("/api/teachers", get(get_teachers).post(create_teacher))
        .route("/api/teachers/:id", delete(delete_teacher))
        .route("/api/news", get(get_news).post(create_news))
        .route("/api/news/:id", delete(delete_news))
        .route("/api/rooms", get(get_rooms).post(create_room))
        .route("/api/rooms/:id", delete(delete_room))
        .route("/api/media", get(get_media).post(upload_media))
        .route("/api/media/:id", delete(delete_media))
        .route("/api/media/:id/file", get(get_media_file))
        .route("/api/schedule", get(get_schedule).post(create_schedule))
        .route("/api/schedule/upcoming", get(get_schedule_upcoming))
        .route("/api/schedule/:id", put(update_schedule).delete(delete_schedule))
        .route("/api/accounts", get(get_accounts).post(create_account))
        .route("/api/accounts/:id", put(update_account).delete(delete_account))
        .route("/api/auth/login", post(login))
        .route("/api/auth/me", get(auth_me))
        .route("/api/dashboard/system-metrics", get(dashboard_system_metrics))
        .route("/api/dashboard/free-rooms", get(dashboard_free_rooms))
        .route("/api/dashboard/metrics/history", get(dashboard_metrics_history))
        .route("/api/dashboard/active-schedule", get(dashboard_active_schedule))
        .route("/api/dashboard/notifications", get(dashboard_notifications))
        .route("/api/dashboard/notifications/:id/read", patch(mark_notification_read))
        .route("/api/admin-panel/register", post(admin_panel_register))
        .route("/api/security/status", get(crate::secure_api::api_security_status))
        .route("/api/security/allow-pairing", post(crate::secure_api::api_allow_pairing))
        .route("/api/security/reset-pairing", post(crate::secure_api::api_reset_pairing))
        .route("/api/database/export", get(database_export))
        .route("/api/database/restore", post(database_restore))
        // Разрешаем загрузку крупных медиафайлов (видео) через multipart.
        // По умолчанию лимит тела запроса слишком мал для видео.
        .layer(DefaultBodyLimit::max(API_BODY_LIMIT))
        .layer(middleware::from_fn(admin_panel_weather_middleware))
        .layer(middleware::from_fn(crate::secure_api::require_auth_for_mutations))
        .with_state(state);

    let tunnel_routes: Router<()> = Router::new()
        .route("/sc", post(crate::secure_api::tunnel))
        .with_state(api.clone());

    Router::new()
        .route("/sc/hello", get(crate::secure_api::hello))
        .route("/sc/pair", post(crate::secure_api::pair))
        .merge(tunnel_routes)
        .merge(api)
        // +1 МБ запаса на заголовки/шифрование поверх тела.
        .layer(DefaultBodyLimit::max(API_BODY_LIMIT + 1024 * 1024))
        .layer(middleware::from_fn(crate::secure_api::plain_policy))
        .layer(middleware::from_fn(cors_middleware))
}

/// Запускает API-сервер в фоне (для Tauri). Слушает на всех интерфейсах (0.0.0.0:8000).
pub fn run_api_server(addr: SocketAddr, media_dir: PathBuf) {
    let app = create_app(media_dir);
    tauri::async_runtime::spawn(async move {
        let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
        log::info!("API server listening on http://{}", addr);
        axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
            .await
            .unwrap();
    });
}

async fn root() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "message": "Timetable Admin Panel API",
        "status": "ok"
    }))
}

async fn api_health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

#[derive(Deserialize, Default)]
struct AdminPanelRegisterRequest {
    base_url: Option<String>,
    /// Часы admin-panel (мс): у TV нет интернета/NTP, поэтому сверяемся с панелью.
    admin_time_ms: Option<i64>,
}

async fn admin_panel_register(
    ConnectInfo(remote_addr): ConnectInfo<SocketAddr>,
    kid: Option<Extension<crate::secure_api::SecureChannelKid>>,
    Json(body): Json<AdminPanelRegisterRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if let Some(Extension(k)) = kid {
        crate::secure_api::security().set_admin_kid(k.0);
    }
    if let Some(t) = body.admin_time_ms {
        crate::secure_api::set_admin_clock(t);
    }
    let candidate_url = normalize_admin_panel_base_url(body.base_url, remote_addr.ip());
    let saved_url = admin_panel_config::save_admin_panel_url(&candidate_url, remote_addr.ip())
        .map_err(ApiError::Db)?;

    let refresh_target = saved_url.clone();
    tokio::spawn(async move {
        request_admin_panel_weather_refresh(&refresh_target).await;
    });

    Ok(Json(serde_json::json!({
        "status": "ok",
        "base_url": saved_url,
        "remote_ip": remote_addr.ip().to_string(),
    })))
}

fn normalize_admin_panel_base_url(base_url: Option<String>, remote_ip: IpAddr) -> String {
    let fallback = || format!("http://{}:9000", remote_ip);

    let Some(raw_url) = base_url.map(|value| value.trim().trim_end_matches('/').to_string()) else {
        return fallback();
    };

    if raw_url.is_empty() {
        return fallback();
    }

    let Ok(mut parsed) = url::Url::parse(&raw_url) else {
        return fallback();
    };

    let should_replace_host = match parsed.host_str() {
        Some("localhost") => true,
        Some(host) => match host.parse::<IpAddr>() {
            Ok(ip) => ip.is_loopback() || ip.is_unspecified(),
            Err(_) => false,
        },
        None => true,
    };

    if should_replace_host {
        if parsed.set_host(Some(&remote_ip.to_string())).is_err() {
            return fallback();
        }
    }

    parsed.set_query(None);
    parsed.set_fragment(None);
    parsed.set_path("");

    parsed.to_string().trim_end_matches('/').to_string()
}

// ─── Auth ───────────────────────────────────────────────────────────────────
fn hash_password(password: &str) -> Result<String, String> {
    let truncated = if password.len() > 72 {
        let mut b = password.as_bytes()[..72].to_vec();
        while !b.is_empty() && (b[b.len() - 1] & 0xC0) == 0x80 {
            b.pop();
        }
        String::from_utf8_lossy(&b).into_owned()
    } else {
        password.to_string()
    };
    bcrypt::hash(truncated, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())
}

fn verify_password(password: &str, hash: &str) -> Result<bool, String> {
    let truncated = if password.len() > 72 {
        let mut b = password.as_bytes()[..72].to_vec();
        while !b.is_empty() && (b[b.len() - 1] & 0xC0) == 0x80 {
            b.pop();
        }
        String::from_utf8_lossy(&b).into_owned()
    } else {
        password.to_string()
    };
    bcrypt::verify(truncated, hash).map_err(|e| e.to_string())
}

#[derive(serde::Serialize, serde::Deserialize)]
struct JwtClaims {
    sub: String,
    exp: usize,
}

fn create_jwt(username: &str) -> Result<String, String> {
    let exp = chrono::Utc::now() + chrono::Duration::hours(ACCESS_TOKEN_EXPIRE_HOURS);
    let claims = JwtClaims {
        sub: username.to_string(),
        exp: exp.timestamp() as usize,
    };
    jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &claims,
        &jsonwebtoken::EncodingKey::from_secret(crate::secure_api::jwt_secret()),
    )
    .map_err(|e| e.to_string())
}

fn decode_jwt(token: &str) -> Result<String, String> {
    let token_data = jsonwebtoken::decode::<JwtClaims>(
        token,
        &jsonwebtoken::DecodingKey::from_secret(crate::secure_api::jwt_secret()),
        &jsonwebtoken::Validation::default(),
    )
    .map_err(|_| "invalid token".to_string())?;
    Ok(token_data.claims.sub)
}

pub(crate) fn bearer_username(headers: &HeaderMap) -> Result<String, (StatusCode, Json<serde_json::Value>)> {
    let auth = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"detail": "Неверный токен"})),
            )
        })?;
    let token = auth.strip_prefix("Bearer ").unwrap_or(auth);
    decode_jwt(token).map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"detail": "Неверный токен"})),
        )
    })
}

// ─── Teachers ───────────────────────────────────────────────────────────────
#[derive(Deserialize, Default)]
struct SkipLimit {
    skip: Option<i64>,
    limit: Option<i64>,
}

async fn get_teachers(Query(q): Query<SkipLimit>) -> Result<Json<Vec<TeacherRow>>, ApiError> {
    let (skip, limit) = (q.skip.unwrap_or(0), q.limit.unwrap_or(100));
    let list = tokio::task::spawn_blocking(move || db::get_teachers(skip, limit))
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    log::info!("GET /api/teachers -> {} items", list.len());
    Ok(Json(list))
}

#[derive(Deserialize)]
struct TeacherCreate {
    name: String,
}

async fn create_teacher(Json(body): Json<TeacherCreate>) -> Result<(StatusCode, Json<TeacherRow>), ApiError> {
    let name = body.name;
    let row = tokio::task::spawn_blocking(move || db::create_teacher(&name))
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    Ok((StatusCode::CREATED, Json(row)))
}

async fn delete_teacher(Path(id): Path<i64>) -> Result<StatusCode, ApiError> {
    let res = tokio::task::spawn_blocking(move || db::delete_teacher(id))
        .await
        .unwrap();
    match res {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(e) if e.contains("QueryReturnedNoRows") || e.contains("not found") => {
            Err(ApiError::NotFound("Преподаватель не найден".into()))
        }
        Err(e) => Err(ApiError::Db(e)),
    }
}

// ─── News ───────────────────────────────────────────────────────────────────
async fn get_news(Query(q): Query<SkipLimit>) -> Result<Json<Vec<NewsRow>>, ApiError> {
    let (skip, limit) = (q.skip.unwrap_or(0), q.limit.unwrap_or(100));
    let list = tokio::task::spawn_blocking(move || db::get_news(skip, limit))
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    Ok(Json(list))
}

#[derive(Deserialize)]
struct NewsCreate {
    title: String,
    content: Option<String>,
}

async fn create_news(Json(body): Json<NewsCreate>) -> Result<(StatusCode, Json<NewsRow>), ApiError> {
    let (title, content) = (body.title, body.content);
    let row = tokio::task::spawn_blocking(move || db::create_news(&title, content.as_deref()))
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    Ok((StatusCode::CREATED, Json(row)))
}

async fn delete_news(Path(id): Path<i64>) -> Result<StatusCode, ApiError> {
    tokio::task::spawn_blocking(move || db::delete_news(id))
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    Ok(StatusCode::NO_CONTENT)
}

// ─── Rooms ──────────────────────────────────────────────────────────────────
async fn get_rooms(Query(q): Query<SkipLimit>) -> Result<Json<Vec<RoomRow>>, ApiError> {
    let (skip, limit) = (q.skip.unwrap_or(0), q.limit.unwrap_or(100));
    let list = tokio::task::spawn_blocking(move || db::get_rooms(skip, limit))
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    log::info!("GET /api/rooms -> {} items", list.len());
    Ok(Json(list))
}

#[derive(Deserialize)]
struct RoomCreate {
    number: String,
}

async fn create_room(Json(body): Json<RoomCreate>) -> Result<(StatusCode, Json<RoomRow>), ApiError> {
    let number = body.number;
    let row = tokio::task::spawn_blocking(move || db::create_room(&number))
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    Ok((StatusCode::CREATED, Json(row)))
}

async fn delete_room(Path(id): Path<i64>) -> Result<StatusCode, ApiError> {
    tokio::task::spawn_blocking(move || db::delete_room(id))
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    Ok(StatusCode::NO_CONTENT)
}

// ─── Media ──────────────────────────────────────────────────────────────────
async fn get_media(Query(q): Query<SkipLimit>) -> Result<Json<Vec<MediaRow>>, ApiError> {
    let (skip, limit) = (q.skip.unwrap_or(0), q.limit.unwrap_or(100));
    let list = tokio::task::spawn_blocking(move || db::get_media(skip, limit))
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    Ok(Json(list))
}

async fn upload_media(
    State(state): State<Arc<AppState>>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<MediaRow>), ApiError> {
    let mut name = None;
    let mut file_data = None;
    let mut file_name = None;
    while let Some(field) = multipart.next_field().await.map_err(|e| ApiError::BadRequest(e.to_string()))? {
        let field_name = field.name().unwrap_or("").to_string();
        if field_name == "name" {
            name = Some(field.text().await.map_err(|e| ApiError::BadRequest(e.to_string()))?);
        } else if field_name == "file" {
            file_name = field.file_name().map(|s| s.to_string());
            file_data = Some(field.bytes().await.map_err(|e| ApiError::BadRequest(e.to_string()))?);
        }
    }
    let data = file_data.ok_or_else(|| ApiError::BadRequest("file required".into()))?;
    let file_name = file_name.unwrap_or_else(|| "upload".to_string());
    let ext = std::path::Path::new(&file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let allowed = ["jpg", "jpeg", "png", "gif", "webp", "svg", "mp4", "avi", "mov", "wmv", "flv", "webm"];
    if !allowed.contains(&&*ext) {
        return Err(ApiError::BadRequest("Разрешены только изображения и видео".into()));
    }
    let file_type = if ["jpg", "jpeg", "png", "gif", "webp", "svg"].contains(&&*ext) {
        "image"
    } else {
        "video"
    };
    let safe_name = format!(
        "{}_{}",
        chrono::Local::now().format("%Y%m%d_%H%M%S"),
        file_name
    );
    let media_dir = state.media_dir.clone();
    let path = media_dir.join(&safe_name);
    std::fs::write(&path, &data).map_err(|e| ApiError::Db(e.to_string()))?;
    let file_size = data.len() as i64;
    let path_str = path.to_string_lossy().into_owned();
    let name = name.unwrap_or(file_name);
    let row = tokio::task::spawn_blocking(move || {
        db::create_media(&name, &path_str, Some(file_type), Some(file_size))
    })
    .await
    .unwrap()
    .map_err(ApiError::Db)?;
    Ok((StatusCode::CREATED, Json(row)))
}

async fn delete_media(Path(id): Path<i64>) -> Result<StatusCode, ApiError> {
    let path_str = tokio::task::spawn_blocking(move || db::delete_media(id))
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    if !path_str.is_empty() {
        let p = PathBuf::from(&path_str);
        if p.exists() {
            let _ = std::fs::remove_file(&p);
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn get_media_file(Path(id): Path<i64>) -> Result<Response, ApiError> {
    let path_opt = tokio::task::spawn_blocking(move || db::get_media_file_path(id))
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    let path = path_opt.ok_or_else(|| ApiError::NotFound("Медиа файл не найден".into()))?;
    if !path.exists() {
        return Err(ApiError::NotFound("Файл не найден".into()));
    }
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let path_clone = path.clone();
    let data = tokio::task::spawn_blocking(move || std::fs::read(&path_clone))
        .await
        .unwrap()
        .map_err(|e| ApiError::Db(e.to_string()))?;
    let content_type = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "wmv" => "video/x-ms-wmv",
        "flv" => "video/x-flv",
        _ => "application/octet-stream",
    };
    Ok((
        [(header::CONTENT_TYPE, content_type)],
        data,
    )
        .into_response())
}

// ─── Schedule ───────────────────────────────────────────────────────────────
#[derive(Deserialize)]
struct ScheduleQuery {
    week: Option<i64>,
    room_id: Option<i64>,
    teacher_id: Option<i64>,
    day_of_week: Option<i64>,
    skip: Option<i64>,
    limit: Option<i64>,
}

async fn get_schedule(Query(q): Query<ScheduleQuery>) -> Result<Json<Vec<ScheduleItemRow>>, ApiError> {
    let (skip, limit) = (q.skip.unwrap_or(0), q.limit.unwrap_or(1000));
    let room_id = q.room_id;
    let teacher_id = q.teacher_id;
    let day_of_week = q.day_of_week;
    let list = tokio::task::spawn_blocking(move || {
        db::get_schedule(room_id, teacher_id, day_of_week, skip, limit)
    })
    .await
    .unwrap()
    .map_err(ApiError::Db)?;
    log::info!("GET /api/schedule -> {} items", list.len());
    Ok(Json(list))
}

async fn get_schedule_upcoming() -> Result<Json<Vec<ScheduleItemRow>>, ApiError> {
    let list = tokio::task::spawn_blocking(|| db::get_schedule_upcoming(20))
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    Ok(Json(list))
}

#[derive(Deserialize)]
struct ScheduleItemCreate {
    room_id: i64,
    teacher_id: i64,
    subject: String,
    groups: String,
    start_date: String,
    end_date: String,
    week_type: String,
    class_number: i64,
    day_of_week: i64,
}

async fn create_schedule(
    Json(body): Json<ScheduleItemCreate>,
) -> Result<(StatusCode, Json<ScheduleItemRow>), ApiError> {
    let b = body;
    let row = tokio::task::spawn_blocking(move || {
        db::create_schedule_item(
            b.room_id,
            b.teacher_id,
            &b.subject,
            &b.groups,
            &b.start_date,
            &b.end_date,
            &b.week_type,
            b.class_number,
            b.day_of_week,
        )
    })
    .await
    .unwrap()
    .map_err(ApiError::Db)?;
    Ok((StatusCode::CREATED, Json(row)))
}

async fn update_schedule(
    Path(id): Path<i64>,
    Json(body): Json<ScheduleItemCreate>,
) -> Result<Json<ScheduleItemRow>, ApiError> {
    let b = body;
    let row = tokio::task::spawn_blocking(move || {
        db::update_schedule_item(
            id,
            b.room_id,
            b.teacher_id,
            &b.subject,
            &b.groups,
            &b.start_date,
            &b.end_date,
            &b.week_type,
            b.class_number,
            b.day_of_week,
        )
    })
    .await
    .unwrap()
    .map_err(ApiError::Db)?;
    Ok(Json(row))
}

async fn delete_schedule(Path(id): Path<i64>) -> Result<StatusCode, ApiError> {
    tokio::task::spawn_blocking(move || db::delete_schedule_item(id))
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    Ok(StatusCode::NO_CONTENT)
}

// ─── Accounts ───────────────────────────────────────────────────────────────
async fn get_accounts(
    headers: HeaderMap,
    Query(q): Query<SkipLimit>,
) -> Result<Json<Vec<AccountRow>>, ApiError> {
    bearer_username(&headers).map_err(|(c, j)| ApiError::Status(c, j))?;
    let (skip, limit) = (q.skip.unwrap_or(0), q.limit.unwrap_or(100));
    let list = tokio::task::spawn_blocking(move || db::get_accounts(skip, limit))
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    Ok(Json(list))
}

#[derive(Deserialize)]
struct AccountCreate {
    username: String,
    password: String,
}

async fn create_account(Json(body): Json<AccountCreate>) -> Result<(StatusCode, Json<AccountRow>), ApiError> {
    let hash = hash_password(&body.password).map_err(ApiError::BadRequest)?;
    let (username, hash) = (body.username, hash);
    let row = tokio::task::spawn_blocking(move || db::create_account(&username, &hash))
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[derive(Deserialize)]
struct AccountUpdate {
    username: Option<String>,
    password: Option<String>,
}

async fn update_account(
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(body): Json<AccountUpdate>,
) -> Result<Json<AccountRow>, ApiError> {
    bearer_username(&headers).map_err(|(c, j)| ApiError::Status(c, j))?;
    let password_hash = body.password.and_then(|p| hash_password(&p).ok());
    let username = body.username;
    let row = tokio::task::spawn_blocking(move || {
        db::update_account(id, username.as_deref(), password_hash.as_deref())
    })
    .await
    .unwrap()
    .map_err(ApiError::Db)?;
    Ok(Json(row))
}

async fn delete_account(headers: HeaderMap, Path(id): Path<i64>) -> Result<StatusCode, ApiError> {
    bearer_username(&headers).map_err(|(c, j)| ApiError::Status(c, j))?;
    tokio::task::spawn_blocking(move || db::delete_account(id))
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    Ok(StatusCode::NO_CONTENT)
}

// ─── Auth ───────────────────────────────────────────────────────────────────
#[derive(Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
}

async fn login(Json(body): Json<LoginRequest>) -> Result<Json<serde_json::Value>, ApiError> {
    let (username, password) = (body.username, body.password);
    let account_opt = tokio::task::spawn_blocking(move || db::get_account_by_username(&username))
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    let (account, hash) = account_opt.ok_or_else(|| ApiError::Unauthorized)?;
    if !verify_password(&password, &hash).map_err(ApiError::Db)? {
        return Err(ApiError::Unauthorized);
    }
    let token = create_jwt(&account.username).map_err(ApiError::Db)?;
    Ok(Json(serde_json::json!({
        "access_token": token,
        "token_type": "bearer",
        "account": serde_json::json!({
            "id": account.id,
            "username": account.username,
            "created_at": account.created_at
        })
    })))
}

async fn auth_me(headers: HeaderMap) -> Result<Json<AccountRow>, ApiError> {
    let username = bearer_username(&headers).map_err(|(c, j)| ApiError::Status(c, j))?;
    let account_opt = tokio::task::spawn_blocking(move || db::get_account_by_username(&username))
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    let account = account_opt.and_then(|(a, _)| Some(a)).ok_or(ApiError::Unauthorized)?;
    Ok(Json(account))
}

// ─── Dashboard ──────────────────────────────────────────────────────────────
async fn dashboard_system_metrics() -> Result<Json<serde_json::Value>, ApiError> {
    let mut sys = sysinfo::System::new_all();
    sys.refresh_all();
    let cpu = sys.global_cpu_usage() as f64;
    let mem = sys.used_memory() as f64 / sys.total_memory() as f64 * 100.0;
    // Используем GiB (1024³), чтобы "32 GB" ОЗУ отображалось как 32, а не как 34 (при делении на 1e9).
    const GIB: f64 = 1024.0 * 1024.0 * 1024.0;
    Ok(Json(serde_json::json!({
        "cpu_percent": (cpu * 100.0).round() / 100.0,
        "cpu_count": sys.cpus().len(),
        "memory_percent": (mem * 100.0).round() / 100.0,
        "memory_total_gb": (sys.total_memory() as f64 / GIB * 100.0).round() / 100.0,
        "memory_used_gb": (sys.used_memory() as f64 / GIB * 100.0).round() / 100.0,
        "memory_available_gb": (sys.available_memory() as f64 / GIB * 100.0).round() / 100.0
    })))
}

async fn dashboard_free_rooms() -> Result<Json<serde_json::Value>, ApiError> {
    let (free, free_count, total) =
        tokio::task::spawn_blocking(db::get_free_rooms).await.unwrap().map_err(ApiError::Db)?;
    Ok(Json(serde_json::json!({
        "free_rooms": free,
        "free_count": free_count,
        "total_count": total
    })))
}

#[derive(Deserialize, Default)]
struct DaysQuery {
    days: Option<i64>,
}

async fn dashboard_metrics_history(
    Query(q): Query<DaysQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let days = q.days.unwrap_or(7);
    let data =
        tokio::task::spawn_blocking(move || db::get_metrics_history(days))
            .await
            .unwrap()
            .map_err(ApiError::Db)?;
    Ok(Json(serde_json::json!({ "data": data })))
}

async fn dashboard_active_schedule() -> Result<Json<Vec<ActiveScheduleItem>>, ApiError> {
    let list = tokio::task::spawn_blocking(db::get_active_schedule_list)
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    Ok(Json(list))
}

#[derive(Deserialize, Default)]
struct LimitQuery {
    limit: Option<i64>,
}

async fn dashboard_notifications(
    Query(q): Query<LimitQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let limit = q.limit.unwrap_or(50);
    let (list, unread) =
        tokio::task::spawn_blocking(move || db::get_notifications(limit))
            .await
            .unwrap()
            .map_err(ApiError::Db)?;
    Ok(Json(serde_json::json!({
        "notifications": list,
        "unread_count": unread
    })))
}

async fn mark_notification_read(
    Path(id): Path<i64>,
) -> Result<Json<NotificationRow>, ApiError> {
    let row = tokio::task::spawn_blocking(move || db::mark_notification_read(id))
        .await
        .unwrap()
        .map_err(ApiError::Db)?;
    Ok(Json(row))
}

// ─── Database export/restore ─────────────────────────────────────────────────
async fn database_export(headers: HeaderMap) -> Result<Response, ApiError> {
    bearer_username(&headers).map_err(|(c, j)| ApiError::Status(c, j))?;
    let path = db::get_db_path().map_err(ApiError::Db)?;
    let data = tokio::task::spawn_blocking(move || std::fs::read(&path))
        .await
        .unwrap()
        .map_err(|e| ApiError::Db(e.to_string()))?;
    Ok((
        [
            (header::CONTENT_TYPE, "application/x-sqlite3"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"timetable_backup.db\"",
            ),
        ],
        data,
    )
        .into_response())
}

async fn database_restore(
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, ApiError> {
    bearer_username(&headers).map_err(|(c, j)| ApiError::Status(c, j))?;
    let mut file_data = None;
    while let Some(field) = multipart.next_field().await.map_err(|e| ApiError::BadRequest(e.to_string()))? {
        if field.name() == Some("file") {
            let name = field.file_name().unwrap_or("").to_string();
            if !name.to_lowercase().ends_with(".db") {
                return Err(ApiError::BadRequest("Нужен файл .db".into()));
            }
            file_data = Some(field.bytes().await.map_err(|e| ApiError::BadRequest(e.to_string()))?);
            break;
        }
    }
    let data = file_data.ok_or_else(|| ApiError::BadRequest("file required".into()))?;
    if data.len() < 100 {
        return Err(ApiError::BadRequest("Файл слишком маленький".into()));
    }
    let tmp = std::env::temp_dir().join(format!("restore_{}.db", std::process::id()));
    std::fs::write(&tmp, &data).map_err(|e| ApiError::Db(e.to_string()))?;
    let tmp_clone = tmp.clone();
    let result = tokio::task::spawn_blocking(move || db::replace_database_from_path(&tmp_clone))
        .await
        .unwrap();
    let _ = std::fs::remove_file(&tmp);
    result.map_err(ApiError::Db)?;
    Ok(Json(serde_json::json!({
        "detail": "База данных успешно восстановлена. Рекомендуется перезапустить приложение."
    })))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

#[derive(Debug)]
enum ApiError {
    Db(String),
    BadRequest(String),
    NotFound(String),
    Unauthorized,
    Status(StatusCode, Json<serde_json::Value>),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match self {
            ApiError::Db(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "detail": e })),
            )
                .into_response(),
            ApiError::BadRequest(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "detail": e }))).into_response(),
            ApiError::NotFound(e) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "detail": e }))).into_response(),
            ApiError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"detail": "Неверное имя пользователя или пароль"})),
            )
                .into_response(),
            ApiError::Status(c, j) => (c, j).into_response(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secure_channel::{self as sc, Psk};
    use axum::body::Body;
    use axum::http::Request;
    use std::collections::BTreeMap;
    use std::sync::Once;
    use tower::ServiceExt;

    const TEST_SECRET: &str = "api-server-test-secret";
    const REMOTE: &str = "192.168.1.50:51000";
    const LOOPBACK: &str = "127.0.0.1:51001";

    fn setup() -> Router {
        static INIT: Once = Once::new();
        INIT.call_once(|| {
            let td = tempfile::tempdir().expect("tempdir");
            let dir = td.path().to_path_buf();
            std::mem::forget(td); // каталог нужен до конца процесса тестов
            std::env::set_var("TIMETABLE_PSK", TEST_SECRET);
            db::init(&dir.join("t.db"), &dir.join("media")).expect("db init");
            std::fs::create_dir_all(dir.join("media")).unwrap();
            crate::secure_api::init(Some(&dir));
            admin_panel_config::initialize(dir.join("admin-panel.json"));
        });
        create_app(std::env::temp_dir())
    }

    fn psk() -> Psk {
        Psk::from_secret(TEST_SECRET)
    }

    fn peer(addr: &str) -> ConnectInfo<SocketAddr> {
        ConnectInfo(addr.parse().unwrap())
    }

    fn json_headers(token: Option<&str>) -> BTreeMap<String, String> {
        let mut h = BTreeMap::new();
        h.insert("content-type".to_string(), "application/json".to_string());
        if let Some(t) = token {
            h.insert("authorization".to_string(), format!("Bearer {}", t));
        }
        h
    }

    /// Плоский HTTP-запрос (без туннеля).
    async fn plain(app: &Router, method: &str, path: &str, from: &str, body: &str) -> (StatusCode, Vec<u8>) {
        let mut req = Request::builder()
            .method(method)
            .uri(path)
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        req.extensions_mut().insert(peer(from));
        let resp = app.clone().oneshot(req).await.unwrap();
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (status, bytes.to_vec())
    }

    /// Отправляет сырой пакет в /sc.
    async fn post_sc(app: &Router, wire: Vec<u8>, from: &str) -> (StatusCode, Vec<u8>) {
        let mut req = Request::builder()
            .method("POST")
            .uri("/sc")
            .body(Body::from(wire))
            .unwrap();
        req.extensions_mut().insert(peer(from));
        let resp = app.clone().oneshot(req).await.unwrap();
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (status, bytes.to_vec())
    }

    /// Полный вызов через туннель. Возвращает (HTTP-статус внутреннего ответа, тело).
    async fn tunnel(
        app: &Router,
        method: &str,
        path: &str,
        token: Option<&str>,
        body: &str,
        from: &str,
    ) -> (u16, Vec<u8>) {
        let (wire, salt, id) =
            sc::build_request(&psk(), method, path, json_headers(token), body.as_bytes(), 0).unwrap();
        let (status, bytes) = post_sc(app, wire, from).await;
        assert_eq!(status, StatusCode::OK, "tunnel transport failed: {}", String::from_utf8_lossy(&bytes));
        let (meta, payload) = sc::parse_response(&psk(), &salt, &id, &bytes).expect("decrypt response");
        (meta.status, payload)
    }

    #[tokio::test]
    async fn tunnel_serves_api_and_hides_payload() {
        let app = setup();
        let token = create_jwt("tester").unwrap();
        let (st, body) = tunnel(&app, "POST", "/api/rooms", Some(&token), r#"{"number":"TUNNEL-101"}"#, REMOTE).await;
        assert!(st == 200 || st == 201, "create_room via tunnel returned {}", st);
        assert!(String::from_utf8_lossy(&body).contains("TUNNEL-101"));

        let (st, body) = tunnel(&app, "GET", "/api/rooms", None, "", REMOTE).await;
        assert_eq!(st, 200);
        assert!(String::from_utf8_lossy(&body).contains("TUNNEL-101"));
    }

    #[tokio::test]
    async fn remote_plain_http_is_refused_but_health_is_open() {
        let app = setup();
        let (st, _) = plain(&app, "GET", "/api/rooms", REMOTE, "").await;
        assert_eq!(st, StatusCode::FORBIDDEN);
        let (st, _) = plain(&app, "GET", "/api/schedule", REMOTE, "").await;
        assert_eq!(st, StatusCode::FORBIDDEN);
        let (st, _) = plain(&app, "GET", "/api/database/export", REMOTE, "").await;
        assert_eq!(st, StatusCode::FORBIDDEN);
        let (st, _) = plain(&app, "GET", "/api/health", REMOTE, "").await;
        assert_eq!(st, StatusCode::OK);
    }

    #[tokio::test]
    async fn loopback_plain_http_still_works_for_local_dev() {
        let app = setup();
        let (st, _) = plain(&app, "GET", "/api/rooms", LOOPBACK, "").await;
        assert_eq!(st, StatusCode::OK);
    }

    #[tokio::test]
    async fn mutations_require_valid_jwt_even_inside_tunnel() {
        let app = setup();
        let (st, _) = tunnel(&app, "POST", "/api/rooms", None, r#"{"number":"NOAUTH"}"#, REMOTE).await;
        assert_eq!(st, 401);
        let (st, _) = tunnel(&app, "DELETE", "/api/rooms/1", Some("garbage"), "", REMOTE).await;
        assert_eq!(st, 401);
        // Плоский запрос с loopback тоже не может менять данные без токена
        let (st, _) = plain(&app, "POST", "/api/rooms", LOOPBACK, r#"{"number":"NOAUTH"}"#).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn token_signed_with_old_hardcoded_secret_is_rejected() {
        let app = setup();
        let claims = JwtClaims {
            sub: "attacker".into(),
            exp: (chrono::Utc::now().timestamp() + 3600) as usize,
        };
        let forged = jsonwebtoken::encode(
            &jsonwebtoken::Header::default(),
            &claims,
            &jsonwebtoken::EncodingKey::from_secret(b"your-secret-key-change-in-production"),
        )
        .unwrap();
        let (st, _) = tunnel(&app, "POST", "/api/rooms", Some(&forged), r#"{"number":"FORGED"}"#, REMOTE).await;
        assert_eq!(st, 401);
        assert!(crate::secure_api::jwt_secret().len() >= 32);
    }

    #[tokio::test]
    async fn replayed_packet_is_rejected() {
        let app = setup();
        let (wire, _, _) = sc::build_request(&psk(), "GET", "/api/rooms", json_headers(None), b"", 0).unwrap();
        let (st1, _) = post_sc(&app, wire.clone(), REMOTE).await;
        let (st2, body2) = post_sc(&app, wire, REMOTE).await;
        assert_eq!(st1, StatusCode::OK);
        assert_eq!(st2, StatusCode::UNAUTHORIZED);
        assert!(String::from_utf8_lossy(&body2).contains("replayed"));
    }

    #[tokio::test]
    async fn wrong_key_and_garbage_are_rejected() {
        let app = setup();
        let other = Psk::from_secret("someone-else");
        let (wire, _, _) = sc::build_request(&other, "GET", "/api/rooms", json_headers(None), b"", 0).unwrap();
        let (st, _) = post_sc(&app, wire, REMOTE).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED);
        let (st, _) = post_sc(&app, vec![1, 2, 3], REMOTE).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED);
        let (st, _) = post_sc(&app, vec![], REMOTE).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn clock_skew_reports_server_time() {
        let app = setup();
        let (wire, _, _) =
            sc::build_request(&psk(), "GET", "/api/rooms", json_headers(None), b"", -10 * 60 * 1000).unwrap();
        let (st, body) = post_sc(&app, wire, REMOTE).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED);
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["code"], "clock_skew");
        assert!(v["server_time_ms"].as_i64().unwrap() > 0);
    }

    #[tokio::test]
    async fn tunnel_cannot_reach_non_api_paths() {
        let app = setup();
        for path in ["/sc", "/sc/hello?c=abcdefgh1", "/api/../sc", "/"] {
            let (wire, salt, id) = sc::build_request(&psk(), "GET", path, json_headers(None), b"", 0).unwrap();
            let (st, bytes) = post_sc(&app, wire, REMOTE).await;
            assert_eq!(st, StatusCode::BAD_REQUEST, "path {} must be refused", path);
            assert!(sc::parse_response(&psk(), &salt, &id, &bytes).is_err());
        }
    }

    #[tokio::test]
    async fn register_works_only_through_tunnel_and_stores_admin_address() {
        let app = setup();
        let (st, _) = plain(&app, "POST", "/api/admin-panel/register", LOOPBACK, r#"{"base_url":"http://10.9.9.9:9000"}"#).await;
        assert_eq!(st, StatusCode::FORBIDDEN);
        assert_ne!(admin_panel_config::load_admin_panel_url().as_deref(), Some("http://10.9.9.9:9000"));

        let (st, body) = tunnel(&app, "POST", "/api/admin-panel/register", None, r#"{"base_url":"http://192.168.1.50:9000"}"#, REMOTE).await;
        assert_eq!(st, 200, "{}", String::from_utf8_lossy(&body));
        assert_eq!(admin_panel_config::load_admin_panel_url().as_deref(), Some("http://192.168.1.50:9000"));
    }

    #[tokio::test]
    async fn tv_clock_follows_admin_clock_from_register() {
        // TV без интернета: часы ушли на час назад. Панель сообщает своё время в register.
        let app = setup();
        let admin_time = sc::now_ms() + 3_600_000;
        let body = format!(r#"{{"base_url":"http://192.168.1.50:9000","admin_time_ms":{}}}"#, admin_time);
        let (st, _) = tunnel(&app, "POST", "/api/admin-panel/register", None, &body, REMOTE).await;
        assert_eq!(st, 200);
        let drift = (crate::secure_api::admin_now_ms() - admin_time).abs();
        assert!(drift < 5_000, "admin_now_ms must follow the panel clock, drift={}", drift);
    }

    #[tokio::test]
    async fn unauthenticated_remote_cannot_poison_admin_address() {
        // Раньше любой запрос из LAN подменял адрес admin-panel. Теперь — нет.
        let app = setup();
        let before = admin_panel_config::load_admin_panel_url();
        let (st, _) = plain(&app, "GET", "/api/rooms", "192.168.1.77:40000", "").await;
        assert_eq!(st, StatusCode::FORBIDDEN);
        assert_eq!(admin_panel_config::load_admin_panel_url(), before);
    }

    /// Одна последовательность целиком (общее глобальное состояние TV): hello → окно → /sc/pair → туннель → сброс.
    #[tokio::test]
    async fn pairing_flow_over_http() {
        let app = setup();
        let kid = crate::pairing::kid(&psk());

        // hello от панели с известным ключом: доказательство есть
        let (st, body) = plain(&app, "GET", &format!("/sc/hello?c=nonce12345678&k={}", kid), REMOTE, "").await;
        assert_eq!(st, StatusCode::OK);
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["proto"], "tt-sc1");
        assert_eq!(v["state"], "paired");
        assert!(sc::verify_hello(&psk(), "nonce12345678", v["proof"].as_str().unwrap()));
        assert!(!sc::verify_hello(&Psk::from_secret("evil"), "nonce12345678", v["proof"].as_str().unwrap()));

        // чужая панель: TV закрыт, доказательства и pair_pub нет
        for q in ["/sc/hello?c=nonce12345678", "/sc/hello?c=nonce12345678&k=deadbeef"] {
            let (_, body) = plain(&app, "GET", q, REMOTE, "").await;
            let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(v["state"], "foreign");
            assert!(v.get("proof").is_none() && v.get("pair_pub").is_none());
        }
        let (st, _) = plain(&app, "GET", "/sc/hello?c=bad!", REMOTE, "").await;
        assert_eq!(st, StatusCode::BAD_REQUEST);

        // пока окно закрыто, /sc/pair отказывает
        let newcomer = Psk::from_bytes(sc::random_bytes());
        let pair_body = |tv_pub_hex: &str, psk: &Psk| {
            let tv_pub = crate::pairing::parse_pub(tv_pub_hex).unwrap();
            let (admin_pub, blob) = crate::pairing::seal_pairing(&tv_pub, psk, "Новая панель").unwrap();
            (
                admin_pub,
                tv_pub,
                serde_json::json!({"admin_pub": sc::hex_encode(&admin_pub), "blob": sc::hex_encode(&blob)}).to_string(),
            )
        };
        let tv_pub_hex = sc::hex_encode(&crate::secure_api::security_pair_public());
        let (_, _, body) = pair_body(&tv_pub_hex, &newcomer);
        let (st, _) = plain(&app, "POST", "/sc/pair", REMOTE, &body).await;
        assert_eq!(st, StatusCode::FORBIDDEN);
        assert!(crate::secure_api::security().find_psk(&crate::pairing::kid(&newcomer)).is_none());

        // владелец разрешает (через туннель, нужен JWT)
        let (st, _) = tunnel(&app, "POST", "/api/security/allow-pairing", None, "", REMOTE).await;
        assert_eq!(st, 401, "allow-pairing requires a logged-in admin");
        crate::secure_api::security().open_window();
        let (_, body) = plain(&app, "GET", "/sc/hello?c=nonce12345678&k=deadbeef", REMOTE, "").await;
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["state"], "open");
        let pair_pub = v["pair_pub"].as_str().unwrap().to_string();

        // мусор не сопрягает
        let (st, _) = plain(&app, "POST", "/sc/pair", REMOTE, r#"{"admin_pub":"00","blob":"zz"}"#).await;
        assert_eq!(st, StatusCode::BAD_REQUEST);
        let (st, _) = plain(&app, "POST", "/sc/pair", REMOTE, &format!(r#"{{"admin_pub":"{}","blob":"{}"}}"#, "07".repeat(32), "aa".repeat(40))).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED);

        // настоящее сопряжение
        let (admin_pub, tv_pub, body) = pair_body(&pair_pub, &newcomer);
        let (st, resp) = plain(&app, "POST", "/sc/pair", REMOTE, &body).await;
        assert_eq!(st, StatusCode::OK, "{}", String::from_utf8_lossy(&resp));
        let v: serde_json::Value = serde_json::from_slice(&resp).unwrap();
        assert!(crate::pairing::verify_pair_ack(&newcomer, &admin_pub, &tv_pub, v["ack"].as_str().unwrap()));
        assert_eq!(v["kid"], crate::pairing::kid(&newcomer));

        // окно закрылось
        let third = Psk::from_bytes(sc::random_bytes());
        let (_, _, body3) = pair_body(&pair_pub, &third);
        let (st, _) = plain(&app, "POST", "/sc/pair", REMOTE, &body3).await;
        assert_eq!(st, StatusCode::FORBIDDEN);

        // новая панель ходит через туннель своим ключом, старая — своим
        let (wire, salt, id) =
            sc::build_request(&newcomer, "GET", "/api/rooms", json_headers(None), b"", 0).unwrap();
        let (st, bytes) = post_sc(&app, wire, REMOTE).await;
        assert_eq!(st, StatusCode::OK);
        let (meta, _) = sc::parse_response(&newcomer, &salt, &id, &bytes).expect("newcomer can decrypt");
        assert_eq!(meta.status, 200);
        assert_eq!(tunnel(&app, "GET", "/api/rooms", None, "", REMOTE).await.0, 200);

        // сброс: только локально и не через туннель
        let (st, _) = plain(&app, "POST", "/api/security/reset-pairing", REMOTE, "").await;
        assert_eq!(st, StatusCode::FORBIDDEN);
        let (st, _) = tunnel(&app, "POST", "/api/security/reset-pairing", None, "", LOOPBACK).await;
        assert_eq!(st, 403);
        assert!(crate::secure_api::security().find_psk(&crate::pairing::kid(&newcomer)).is_some());
        let (st, _) = plain(&app, "POST", "/api/security/reset-pairing", LOOPBACK, "").await;
        assert_eq!(st, StatusCode::OK);
        assert!(crate::secure_api::security().find_psk(&crate::pairing::kid(&newcomer)).is_none());
        // ключ из окружения (ручное переопределение) остаётся
        assert_eq!(tunnel(&app, "GET", "/api/rooms", None, "", REMOTE).await.0, 200);
    }

    #[tokio::test]
    async fn cors_preflight_for_tunnel_is_answered() {
        let app = setup();
        let mut req = Request::builder()
            .method("OPTIONS")
            .uri("/sc")
            .header("origin", "http://tauri.localhost")
            .body(Body::empty())
            .unwrap();
        req.extensions_mut().insert(peer(REMOTE));
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
        assert!(resp.headers().contains_key("access-control-allow-origin"));
    }

    #[test]
    fn test_hash_and_verify_password() {
        let hash = hash_password("testpass").expect("hash");
        assert!(!hash.is_empty());
        assert!(verify_password("testpass", &hash).expect("verify"));
        assert!(!verify_password("wrong", &hash).expect("verify"));
    }
}
