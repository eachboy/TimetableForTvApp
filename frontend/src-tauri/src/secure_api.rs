//! Серверная часть защищённого канала Timetable TV (порт 8000).
//!
//! * `GET  /sc/hello?c=<nonce>&k=<kid>` — состояние сопряжения + доказательство, что это настоящий TV.
//! * `POST /sc/pair`            — автоматическое сопряжение без кодов (см. shared/pairing.rs):
//!   пока TV ни с кем не сопряжён (или владелец открыл окно сопряжения), первая admin-panel
//!   передаёт свой ключ, зашифрованный обменом X25519. Дальше окно закрывается.
//! * `POST /sc`                 — туннель: зашифрованный запрос к любому `/api/*` обработчику.
//!   Сами обработчики не менялись — туннель только расшифровывает запрос, вызывает Router
//!   и шифрует ответ.
//! * Запросы по открытому HTTP принимаются только с этого же компьютера (loopback),
//!   с остальных адресов — только `/api/health` и `/sc*`.
//! * Изменяющие запросы (POST/PUT/PATCH/DELETE) требуют JWT, секрет которого уникален для установки.

use axum::{
    body::{Body, Bytes},
    extract::{ConnectInfo, Query, Request, State},
    http::{header, HeaderName, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json, Router,
};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Mutex, OnceLock, RwLock};
use tower::ServiceExt;

use crate::pairing::{self, KeyStore, PairKeypair, StoredKey};
use crate::secure_channel::{self as sc, Psk, ReplayGuard, ScError};

/// Заголовки, которые разрешено передавать внутрь туннеля.
const FORWARD_REQUEST_HEADERS: [&str; 3] = ["content-type", "authorization", "accept"];
/// Заголовки ответа, которые возвращаются клиенту.
const FORWARD_RESPONSE_HEADERS: [&str; 2] = ["content-type", "content-disposition"];

pub struct Security {
    /// Постоянные ключи (по одному на admin-panel), хранятся в `pairing.json`.
    keys: RwLock<Vec<StoredKey>>,
    /// Ключ из `TIMETABLE_PSK` (ручное переопределение/тесты), не сохраняется.
    env_psk: Option<Psk>,
    store: Option<KeyStore>,
    /// Ключевая пара X25519 для сопряжения (на время работы процесса).
    pair_kp: PairKeypair,
    /// До какого момента (мс) окно сопряжения открыто для уже сопряжённого TV.
    window_until_ms: AtomicI64,
    /// Ключ той панели, которая последней зарегистрировалась (им подписываем команды к панели).
    admin_kid: Mutex<Option<String>>,
    pair_lock: Mutex<()>,
    pub jwt_secret: Vec<u8>,
    pub guard: ReplayGuard,
    pub allow_plain: bool,
}

static SECURITY: OnceLock<Security> = OnceLock::new();

/// Отмечает запрос, пришедший через аутентифицированный туннель.
#[derive(Clone, Copy, Debug)]
pub struct SecureChannelPeer(pub SocketAddr);

/// Идентификатор ключа, которым расшифрован запрос (какая именно панель обратилась).
#[derive(Clone, Debug)]
pub struct SecureChannelKid(pub String);

/// Сколько секунд окно сопряжения остаётся открытым после разрешения владельцем.
pub const PAIRING_WINDOW_SECS: i64 = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PairState {
    /// Ключей нет — TV ждёт первую admin-panel.
    Unpaired,
    /// Сопряжён, но окно для новой панели открыто.
    Open,
    /// Сопряжён и закрыт.
    Closed,
}

impl Security {
    fn build(data_dir: Option<&Path>) -> Self {
        Self::build_with(Psk::from_env(), data_dir)
    }

    fn build_with(env_psk: Option<Psk>, data_dir: Option<&Path>) -> Self {
        let store = data_dir.map(|d| KeyStore::new(d.join("pairing.json")));
        let keys = store.as_ref().map(|s| s.load()).unwrap_or_default();
        if env_psk.is_none() && keys.is_empty() {
            log::info!("TV is not paired yet: waiting for the first admin-panel (automatic pairing)");
        }
        let allow_plain = std::env::var("TIMETABLE_ALLOW_PLAIN").map(|v| v == "1").unwrap_or(false);
        if allow_plain {
            log::warn!("TIMETABLE_ALLOW_PLAIN=1: unencrypted remote API access is ENABLED (debug only!)");
        }
        Security {
            keys: RwLock::new(keys),
            env_psk,
            store,
            pair_kp: PairKeypair::generate(),
            window_until_ms: AtomicI64::new(0),
            admin_kid: Mutex::new(None),
            pair_lock: Mutex::new(()),
            jwt_secret: load_or_create_jwt_secret(data_dir),
            guard: ReplayGuard::new(),
            allow_plain,
        }
    }

    /// Все действующие ключи (сначала из окружения, затем сохранённые).
    pub fn psks(&self) -> Vec<Psk> {
        let mut out: Vec<Psk> = self.env_psk.iter().cloned().collect();
        out.extend(self.keys.read().unwrap().iter().filter_map(|k| k.psk()));
        out
    }

    pub fn find_psk(&self, kid: &str) -> Option<Psk> {
        self.psks().into_iter().find(|p| pairing::kid(p) == kid)
    }

    pub fn is_paired(&self) -> bool {
        self.env_psk.is_some() || !self.keys.read().unwrap().is_empty()
    }

    pub fn pair_state(&self) -> PairState {
        if !self.is_paired() {
            PairState::Unpaired
        } else if sc::now_ms() < self.window_until_ms.load(Ordering::Relaxed) {
            PairState::Open
        } else {
            PairState::Closed
        }
    }

    pub fn pair_public_hex(&self) -> String {
        sc::hex_encode(&self.pair_kp.public)
    }

    /// Владелец (уже сопряжённая панель) разрешает подключить ещё одну панель.
    pub fn open_window(&self) {
        self.window_until_ms
            .store(sc::now_ms() + PAIRING_WINDOW_SECS * 1000, Ordering::Relaxed);
    }

    /// Забыть все сопряжения (локальное действие на самом TV).
    pub fn reset_pairing(&self) {
        let _g = self.pair_lock.lock().unwrap();
        self.keys.write().unwrap().clear();
        self.window_until_ms.store(0, Ordering::Relaxed);
        *self.admin_kid.lock().unwrap() = None;
        if let Some(store) = &self.store {
            if let Err(e) = store.save(&[]) {
                log::warn!("Cannot clear pairing.json: {}", e);
            }
        }
    }

    pub fn set_admin_kid(&self, kid: String) {
        *self.admin_kid.lock().unwrap() = Some(kid);
    }

    /// Ключ, которым TV подписывает команды панели: ключ зарегистрировавшейся панели, иначе последний.
    pub fn signing_psk(&self) -> Option<Psk> {
        if let Some(kid) = self.admin_kid.lock().unwrap().clone() {
            if let Some(p) = self.find_psk(&kid) {
                return Some(p);
            }
        }
        self.psks().into_iter().last()
    }

    /// Подпись погоды допустима, если она сделана любым из известных ключей.
    pub fn verify_weather(&self, body: &[u8], signature: Option<&str>) -> Result<(), String> {
        let psks = self.psks();
        if psks.is_empty() {
            return Err("TV is not paired with an admin-panel yet".to_string());
        }
        let mut last = Err("Weather signature is invalid: data rejected".to_string());
        for p in &psks {
            match verify_weather_signature(p, body, signature) {
                Ok(()) => return Ok(()),
                Err(e) => last = Err(e),
            }
        }
        last
    }

    fn accept_pairing(&self, admin_pub: &[u8; 32], blob: &[u8]) -> Result<(String, String), (StatusCode, &'static str)> {
        let (psk, label) = pairing::open_pairing(&self.pair_kp, admin_pub, blob)
            .map_err(|_| (StatusCode::UNAUTHORIZED, "pairing message rejected"))?;
        let _g = self.pair_lock.lock().unwrap();
        let already = self.find_psk(&pairing::kid(&psk)).is_some();
        // Повтор того же сообщения (потерян ответ) безопасен: ключ уже есть, просто подтверждаем.
        if !already {
            if self.pair_state() == PairState::Closed {
                return Err((StatusCode::FORBIDDEN, "TV is already paired with another admin-panel"));
            }
            let mut list = self.keys.write().unwrap();
            pairing::add_key(&mut list, StoredKey::new(&psk, &label));
            if let Some(store) = &self.store {
                if let Err(e) = store.save(&list) {
                    log::error!("Cannot persist pairing.json: {}", e);
                    list.retain(|k| k.kid != pairing::kid(&psk));
                    return Err((StatusCode::INTERNAL_SERVER_ERROR, "cannot store the pairing key"));
                }
            }
            drop(list);
            self.window_until_ms.store(0, Ordering::Relaxed);
            log::info!("Paired with admin-panel '{}' (key id {})", label, pairing::kid(&psk));
        }
        Ok((pairing::pair_ack(&psk, admin_pub, &self.pair_kp.public), pairing::kid(&psk)))
    }
}

fn load_or_create_jwt_secret(data_dir: Option<&Path>) -> Vec<u8> {
    if let Ok(v) = std::env::var("TIMETABLE_JWT_SECRET") {
        if v.trim().len() >= 16 {
            return v.trim().as_bytes().to_vec();
        }
    }
    if let Some(dir) = data_dir {
        let path = dir.join("jwt.secret");
        if let Ok(existing) = std::fs::read_to_string(&path) {
            if existing.trim().len() >= 32 {
                return existing.trim().as_bytes().to_vec();
            }
        }
        let fresh = sc::random_hex(32);
        if let Err(e) = std::fs::create_dir_all(dir).and_then(|_| std::fs::write(&path, &fresh)) {
            log::warn!("Cannot persist JWT secret ({}): tokens will not survive restart", e);
        }
        return fresh.into_bytes();
    }
    sc::random_hex(32).into_bytes()
}

/// У TV нет интернета (и NTP), его часы могут уходить. Admin-panel присылает своё время в `register`;
/// TV запоминает разницу и подписывает команды к панели «по часам панели».
static ADMIN_CLOCK_OFFSET_MS: AtomicI64 = AtomicI64::new(0);

pub fn set_admin_clock(admin_time_ms: i64) {
    ADMIN_CLOCK_OFFSET_MS.store(admin_time_ms - sc::now_ms(), Ordering::Relaxed);
}

/// Текущее время в шкале admin-panel (мс).
pub fn admin_now_ms() -> i64 {
    sc::now_ms() + ADMIN_CLOCK_OFFSET_MS.load(Ordering::Relaxed)
}

/// Инициализация (один раз при старте приложения). Повторные вызовы игнорируются.
pub fn init(data_dir: Option<&Path>) {
    let _ = SECURITY.set(Security::build(data_dir));
}

pub fn security() -> &'static Security {
    SECURITY.get_or_init(|| Security::build(None))
}

pub fn jwt_secret() -> &'static [u8] {
    &security().jwt_secret
}

fn json_error(status: StatusCode, detail: &str) -> Response {
    (status, Json(serde_json::json!({ "detail": detail }))).into_response()
}

// ─── hello ───────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct HelloQuery {
    c: String,
    /// Идентификатор ключа панели (если она уже сопряжена).
    k: Option<String>,
}

fn state_name(s: PairState) -> &'static str {
    match s {
        PairState::Unpaired => "unpaired",
        PairState::Open => "open",
        PairState::Closed => "closed",
    }
}

/// Ответ «кто я и в каком состоянии». Если панель назвала известный ключ — добавляется
/// доказательство (HMAC) того, что это настоящий TV. Иначе — состояние сопряжения.
pub async fn hello(Query(q): Query<HelloQuery>) -> Response {
    let sec = security();
    if sc::hello_proof(&Psk::from_bytes([0; 32]), &q.c).is_none() {
        return json_error(StatusCode::BAD_REQUEST, "bad nonce");
    }
    let mut body = serde_json::json!({
        "proto": sc::PROTO,
        "role": sc::TV_ROLE,
        "server_time_ms": sc::now_ms(),
    });
    let known = q.k.as_deref().and_then(|k| sec.find_psk(k));
    if let Some(psk) = known {
        body["state"] = "paired".into();
        body["proof"] = sc::hello_proof(&psk, &q.c).into();
    } else {
        let st = sec.pair_state();
        body["state"] = if st == PairState::Closed { "foreign" } else { state_name(st) }.into();
        if st != PairState::Closed {
            body["pair_pub"] = sec.pair_public_hex().into();
        }
    }
    Json(body).into_response()
}

#[derive(Deserialize)]
pub struct PairRequest {
    admin_pub: String,
    blob: String,
}

/// Автоматическое сопряжение: принять ключ панели.
pub async fn pair(Json(req): Json<PairRequest>) -> Response {
    let sec = security();
    let (Some(admin_pub), Some(blob)) = (pairing::parse_pub(&req.admin_pub), sc::hex_decode(&req.blob)) else {
        return json_error(StatusCode::BAD_REQUEST, "bad pairing request");
    };
    match sec.accept_pairing(&admin_pub, &blob) {
        Ok((ack, kid)) => Json(serde_json::json!({
            "ack": ack,
            "tv_pub": sec.pair_public_hex(),
            "kid": kid,
        }))
        .into_response(),
        Err((status, msg)) => json_error(status, msg),
    }
}

#[cfg(test)]
pub fn security_pair_public() -> [u8; 32] {
    security().pair_kp.public
}

/// Состояние сопряжения (для диагностики; без секретов).
pub fn status_json() -> serde_json::Value {
    let sec = security();
    serde_json::json!({
        "state": state_name(sec.pair_state()),
        "paired_panels": sec.psks().len(),
        "window_secs": PAIRING_WINDOW_SECS,
    })
}

// ─── туннель ─────────────────────────────────────────────────────────────────

fn sc_error_response(e: &ScError) -> Response {
    match e {
        ScError::Skew { server_time_ms } => (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "detail": "clock skew",
                "code": "clock_skew",
                "server_time_ms": server_time_ms,
            })),
        )
            .into_response(),
        ScError::Replay => json_error(StatusCode::UNAUTHORIZED, "replayed request"),
        // Не раскрываем причину (ключ/порча) — для атакующего это одно и то же.
        _ => json_error(StatusCode::UNAUTHORIZED, "secure channel rejected the request"),
    }
}

pub async fn tunnel(
    State(inner): State<Router>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    body: Bytes,
) -> Response {
    let sec = security();
    let psks = sec.psks();
    if psks.is_empty() {
        return json_error(StatusCode::SERVICE_UNAVAILABLE, "TV is not paired with an admin-panel yet");
    }

    let (frame, salt, key_idx) = match sc::open_request_multi(&psks, &body) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("secure channel: rejected packet from {}: {}", peer.ip(), e);
            return sc_error_response(&e);
        }
    };
    let (meta_json, req_body) = match sc::decode_frame(&frame) {
        Ok(v) => v,
        Err(e) => return sc_error_response(&e),
    };
    let meta: sc::ReqMeta = match serde_json::from_slice(meta_json) {
        Ok(m) => m,
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "bad request metadata"),
    };
    if let Err(e) = sec.guard.check(meta.ts, &meta.id, sc::now_ms()) {
        log::warn!("secure channel: {} from {}", e, peer.ip());
        return sc_error_response(&e);
    }

    // Туннель ведёт только в REST API. Рекурсия в /sc и прочие пути запрещены.
    if !meta.path.starts_with("/api/") || meta.path.contains("..") {
        return json_error(StatusCode::BAD_REQUEST, "path not allowed");
    }
    let method = match Method::from_bytes(meta.method.as_bytes()) {
        Ok(m) => m,
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "bad method"),
    };

    let mut builder = Request::builder().method(method).uri(meta.path.as_str());
    for (k, v) in &meta.headers {
        let key = k.to_ascii_lowercase();
        if FORWARD_REQUEST_HEADERS.contains(&key.as_str()) {
            builder = builder.header(key, v.as_str());
        }
    }
    let mut inner_req = match builder.body(Body::from(req_body.to_vec())) {
        Ok(r) => r,
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "bad request"),
    };
    inner_req.extensions_mut().insert(ConnectInfo(peer));
    inner_req.extensions_mut().insert(SecureChannelPeer(peer));
    inner_req
        .extensions_mut()
        .insert(SecureChannelKid(pairing::kid(&psks[key_idx])));

    let inner_resp = match inner.oneshot(inner_req).await {
        Ok(r) => r,
        Err(never) => match never {},
    };
    let (parts, resp_body) = inner_resp.into_parts();
    let resp_bytes = match axum::body::to_bytes(resp_body, usize::MAX).await {
        Ok(b) => b,
        Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "cannot read response"),
    };

    let mut headers = BTreeMap::new();
    for name in FORWARD_RESPONSE_HEADERS {
        if let Some(v) = parts.headers.get(name).and_then(|v| v.to_str().ok()) {
            headers.insert(name.to_string(), v.to_string());
        }
    }
    let res_meta = sc::ResMeta { id: meta.id.clone(), status: parts.status.as_u16(), headers };
    let res_meta_json = match serde_json::to_vec(&res_meta) {
        Ok(j) => j,
        Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "cannot encode response"),
    };
    let res_frame = sc::encode_frame(&res_meta_json, &resp_bytes);
    let wire = sc::seal_response(&psks[key_idx], &salt, &meta.id, &res_frame);

    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, HeaderValue::from_static("application/octet-stream"))],
        wire,
    )
        .into_response()
}

// ─── политики ────────────────────────────────────────────────────────────────

/// Снаружи (не loopback) по открытому HTTP доступны только `/api/health`, `/` и `/sc*`.
pub async fn plain_policy(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path();
    let open_path = matches!(path, "/" | "/api/health" | "/sc" | "/sc/hello" | "/sc/pair");
    if peer.ip().is_loopback()
        || security().allow_plain
        || open_path
        || request.method() == Method::OPTIONS
    {
        return next.run(request).await;
    }
    json_error(
        StatusCode::FORBIDDEN,
        "Требуется защищённый канал (tt-sc1): подключитесь через admin-panel",
    )
}

/// Все изменяющие запросы требуют действительный JWT; `register` — только через туннель.
pub async fn require_auth_for_mutations(request: Request, next: Next) -> Response {
    let method = request.method().clone();
    if matches!(method, Method::GET | Method::HEAD | Method::OPTIONS) {
        return next.run(request).await;
    }
    let path = request.uri().path();

    if path == "/api/admin-panel/register" {
        if request.extensions().get::<SecureChannelPeer>().is_none() {
            return json_error(StatusCode::FORBIDDEN, "register is allowed only via secure channel");
        }
        return next.run(request).await;
    }
    if path == "/api/auth/login" || path == "/api/security/reset-pairing" {
        // reset-pairing сам проверяет, что запрос локальный (loopback, не через туннель)
        return next.run(request).await;
    }
    match crate::api_server::bearer_username(request.headers()) {
        Ok(_) => next.run(request).await,
        Err((status, body)) => (status, body).into_response(),
    }
}

/// Проверка подписи `weather.json` от admin-panel (заголовок `X-TT-Sig`).
pub fn verify_weather_signature(psk: &Psk, body: &[u8], signature: Option<&str>) -> Result<(), String> {
    let signature = signature.ok_or_else(|| "Weather response is not signed (X-TT-Sig missing)".to_string())?;
    if sc::verify_sig(psk, sc::CONTEXT_WEATHER, body, signature) {
        Ok(())
    } else {
        Err("Weather signature is invalid: data rejected".to_string())
    }
}

/// Нужен для сборки заголовка `HeaderName` в тестах/клиентах.
#[allow(dead_code)]
pub fn header_name(s: &'static str) -> HeaderName {
    HeaderName::from_static(s)
}

/// Параметр запроса `?c=` — вынесен для удобства тестов.
#[allow(dead_code)]
pub fn hello_query(nonce: &str) -> String {
    format!("/sc/hello?c={}", nonce)
}

// ─── управление сопряжением (REST, внутри /api) ──────────────────────────────

pub async fn api_security_status() -> Json<serde_json::Value> {
    Json(status_json())
}

/// Уже сопряжённая панель разрешает подключить ещё одну (окно на 5 минут).
pub async fn api_allow_pairing() -> Json<serde_json::Value> {
    security().open_window();
    Json(status_json())
}

/// Сброс всех сопряжений. Только с самого TV по loopback и не через туннель.
pub async fn api_reset_pairing(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: Request,
) -> Response {
    if !peer.ip().is_loopback() || request.extensions().get::<SecureChannelPeer>().is_some() {
        return json_error(StatusCode::FORBIDDEN, "reset is allowed only locally on the TV");
    }
    security().reset_pairing();
    Json(status_json()).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> (Security, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("tt-sec-{}", sc::random_hex(4)));
        (Security::build_with(None, Some(&dir)), dir)
    }

    fn admin_msg(sec: &Security, psk: &Psk, label: &str) -> ([u8; 32], Vec<u8>) {
        let tv_pub = pairing::parse_pub(&sec.pair_public_hex()).unwrap();
        pairing::seal_pairing(&tv_pub, psk, label).unwrap()
    }

    #[test]
    fn unpaired_tv_accepts_first_panel_then_closes() {
        let (sec, dir) = fresh();
        assert_eq!(sec.pair_state(), PairState::Unpaired);
        assert!(!sec.is_paired());

        let a = Psk::from_bytes(sc::random_bytes());
        let (pub_a, blob_a) = admin_msg(&sec, &a, "panel A");
        let (ack, kid) = sec.accept_pairing(&pub_a, &blob_a).unwrap();
        let tv_pub = pairing::parse_pub(&sec.pair_public_hex()).unwrap();
        assert!(pairing::verify_pair_ack(&a, &pub_a, &tv_pub, &ack));
        assert_eq!(kid, pairing::kid(&a));
        assert_eq!(sec.pair_state(), PairState::Closed);

        // вторая панель с другим ключом — отказ
        let b = Psk::from_bytes(sc::random_bytes());
        let (pub_b, blob_b) = admin_msg(&sec, &b, "panel B");
        assert_eq!(sec.accept_pairing(&pub_b, &blob_b).unwrap_err().0, StatusCode::FORBIDDEN);
        assert_eq!(sec.psks().len(), 1);

        // повтор сообщения первой панели (потерян ответ) — идемпотентно
        assert!(sec.accept_pairing(&pub_a, &blob_a).is_ok());
        assert_eq!(sec.psks().len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn owner_can_open_window_for_second_panel_and_keys_persist() {
        let (sec, dir) = fresh();
        let a = Psk::from_bytes(sc::random_bytes());
        let (pa, ba) = admin_msg(&sec, &a, "A");
        sec.accept_pairing(&pa, &ba).unwrap();

        sec.open_window();
        assert_eq!(sec.pair_state(), PairState::Open);
        let b = Psk::from_bytes(sc::random_bytes());
        let (pb, bb) = admin_msg(&sec, &b, "B");
        sec.accept_pairing(&pb, &bb).unwrap();
        assert_eq!(sec.pair_state(), PairState::Closed, "window closes after use");
        assert_eq!(sec.psks().len(), 2);

        // после перезапуска ключи на месте, окно закрыто
        let again = Security::build_with(None, Some(&dir));
        assert_eq!(again.psks().len(), 2);
        assert!(again.find_psk(&pairing::kid(&a)).is_some());
        assert!(again.find_psk(&pairing::kid(&b)).is_some());
        assert_eq!(again.pair_state(), PairState::Closed);

        // подписываем команды ключом зарегистрировавшейся панели
        sec.set_admin_kid(pairing::kid(&a));
        assert_eq!(sec.signing_psk().unwrap().as_bytes(), a.as_bytes());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn reset_forgets_everything_and_reopens_pairing() {
        let (sec, dir) = fresh();
        let a = Psk::from_bytes(sc::random_bytes());
        let (pa, ba) = admin_msg(&sec, &a, "A");
        sec.accept_pairing(&pa, &ba).unwrap();
        sec.reset_pairing();
        assert_eq!(sec.pair_state(), PairState::Unpaired);
        assert!(Security::build_with(None, Some(&dir)).psks().is_empty());
        let b = Psk::from_bytes(sc::random_bytes());
        let (pb, bb) = admin_msg(&sec, &b, "B");
        assert!(sec.accept_pairing(&pb, &bb).is_ok());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn garbage_pairing_messages_do_not_pair() {
        let (sec, dir) = fresh();
        assert!(sec.accept_pairing(&[7; 32], &[1; 64]).is_err());
        assert!(sec.accept_pairing(&[0; 32], &[1; 64]).is_err());
        assert_eq!(sec.pair_state(), PairState::Unpaired);
        // сообщение, адресованное другому TV
        let other = Security::build_with(None, None);
        let a = Psk::from_bytes(sc::random_bytes());
        let (pa, ba) = admin_msg(&other, &a, "A");
        assert!(sec.accept_pairing(&pa, &ba).is_err());
        assert!(!sec.is_paired());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn weather_is_verified_with_any_paired_key() {
        let (sec, dir) = fresh();
        assert!(sec.verify_weather(b"{}", Some("x")).is_err());
        let a = Psk::from_bytes(sc::random_bytes());
        let (pa, ba) = admin_msg(&sec, &a, "A");
        sec.accept_pairing(&pa, &ba).unwrap();
        let sig = sc::sign(&a, sc::CONTEXT_WEATHER, b"{}");
        assert!(sec.verify_weather(b"{}", Some(&sig)).is_ok());
        assert!(sec.verify_weather(b"{ }", Some(&sig)).is_err());
        assert!(sec.verify_weather(b"{}", None).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
