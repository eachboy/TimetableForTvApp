//! HTTP API на 127.0.0.1:8000 — полный аналог Python-бэкенда для admin panel.

use axum::{
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use serde::Deserialize;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use crate::db::{
    self, AccountRow, ActiveScheduleItem, MediaRow, NewsRow, NotificationRow, RoomRow,
    ScheduleItemRow, TeacherRow,
};

const SECRET_KEY: &str = "your-secret-key-change-in-production";
const ACCESS_TOKEN_EXPIRE_HOURS: i64 = 2;

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

/// Собирает Router API (для встраивания в Tauri или для standalone-бинарника).
/// Возвращает Router<()> (state уже подставлен), пригодный для into_make_service().
pub fn create_app(media_dir: PathBuf) -> Router<()> {
    let state = Arc::new(AppState { media_dir });

    Router::new()
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
        .route("/api/database/export", get(database_export))
        .route("/api/database/restore", post(database_restore))
        // Разрешаем загрузку крупных медиафайлов (видео) через multipart.
        // По умолчанию лимит тела запроса слишком мал для видео.
        .layer(DefaultBodyLimit::max(500 * 1024 * 1024))
        .layer(middleware::from_fn(cors_middleware))
        .with_state(state)
}

/// Запускает API-сервер в фоне (для Tauri). Слушает на всех интерфейсах (0.0.0.0:8000).
pub fn run_api_server(addr: SocketAddr, media_dir: PathBuf) {
    let app = create_app(media_dir);
    tauri::async_runtime::spawn(async move {
        let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
        log::info!("API server listening on http://{}", addr);
        axum::serve(listener, app.into_make_service()).await.unwrap();
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
        &jsonwebtoken::EncodingKey::from_secret(SECRET_KEY.as_bytes()),
    )
    .map_err(|e| e.to_string())
}

fn decode_jwt(token: &str) -> Result<String, String> {
    let token_data = jsonwebtoken::decode::<JwtClaims>(
        token,
        &jsonwebtoken::DecodingKey::from_secret(SECRET_KEY.as_bytes()),
        &jsonwebtoken::Validation::default(),
    )
    .map_err(|_| "invalid token".to_string())?;
    Ok(token_data.claims.sub)
}

fn bearer_username(headers: &HeaderMap) -> Result<String, (StatusCode, Json<serde_json::Value>)> {
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

    #[test]
    fn test_hash_and_verify_password() {
        let hash = hash_password("testpass").expect("hash");
        assert!(!hash.is_empty());
        assert!(verify_password("testpass", &hash).expect("verify"));
        assert!(!verify_password("wrong", &hash).expect("verify"));
    }
}
