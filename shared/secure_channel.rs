//! Защищённый канал Timetable TV ↔ Admin Panel (протокол `tt-sc1`).
//!
//! Этот файл общий для обоих приложений (подключается через `#[path]`), поэтому
//! изменения вносить здесь — в одном месте.
//!
//! ## Идея
//! Обе стороны знают общий секрет (PSK). Он создаётся автоматически при сопряжении
//! (pairing.rs) и не зависит от машины сборки; вручную можно задать `TIMETABLE_PSK`.
//! Сам PSK по сети в открытом виде не передаётся.
//!
//! * Каждый запрос шифруется AES-256-GCM. Ключ = HKDF-SHA256(PSK, случайная соль запроса).
//!   Ответ шифруется другим ключом (`info = "res"`) и привязан к id запроса (AAD).
//! * Внутри шифртекста: метод, путь, заголовки, тело, время и уникальный id запроса.
//! * Сервер отвергает запросы с неверным временем (±5 мин) и повторы id (replay).
//! * Подлинность TV при поиске в сети проверяется через `hello`: HMAC(PSK, nonce).
//! * Подписи для обычного HTTP (weather.json, weather/refresh): HMAC-SHA256.
//!
//! ## Формат пакета
//! запрос : `[ver:1][salt:16][iv:12][ciphertext+tag]`
//! ответ  : `[ver:1][iv:12][ciphertext+tag]`
//! кадр (внутри шифртекста): `[meta_len:u32 BE][meta JSON][body bytes]`

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

pub const PROTO: &str = "tt-sc1";
pub const VERSION: u8 = 1;
pub const SALT_LEN: usize = 16;
pub const IV_LEN: usize = 12;
pub const TAG_LEN: usize = 16;
/// Допустимое расхождение часов между узлами.
pub const MAX_SKEW_MS: i64 = 5 * 60 * 1000;
/// Роль, которую TV сообщает в `hello`.
pub const TV_ROLE: &str = "timetable-tv";
/// Контекст подписи `weather.json` (заголовок `X-TT-Sig`).
pub const CONTEXT_WEATHER: &str = "weather";
/// Назначение заголовка `X-TT-Auth` для `POST /weather/refresh`.
pub const PURPOSE_WEATHER_REFRESH: &str = "weather-refresh";

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScError {
    /// Пакет слишком короткий / битый.
    BadFormat,
    /// Неизвестная версия протокола.
    BadVersion,
    /// Не удалось расшифровать: неверный ключ или данные изменены.
    Decrypt,
    /// Время запроса вне допустимого окна. Содержит время сервера (мс).
    Skew { server_time_ms: i64 },
    /// Такой id запроса уже был.
    Replay,
    /// Ошибка разбора внутреннего JSON.
    Meta(String),
}

impl std::fmt::Display for ScError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ScError::BadFormat => write!(f, "malformed secure packet"),
            ScError::BadVersion => write!(f, "unsupported secure channel version"),
            ScError::Decrypt => write!(f, "decryption failed (wrong pairing key?)"),
            ScError::Skew { .. } => write!(f, "clock skew too large"),
            ScError::Replay => write!(f, "replayed request"),
            ScError::Meta(e) => write!(f, "bad request metadata: {}", e),
        }
    }
}

impl std::error::Error for ScError {}

// ─── Ключ ────────────────────────────────────────────────────────────────────

/// Предварительно общий ключ (32 байта).
#[derive(Clone, PartialEq, Eq)]
pub struct Psk([u8; 32]);

impl std::fmt::Debug for Psk {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Psk(***)")
    }
}

impl Psk {
    /// Из секретной строки (то, что лежит в `env/pairing.key` / `TIMETABLE_PSK`).
    pub fn from_secret(secret: &str) -> Self {
        let mut h = Sha256::new();
        h.update(b"tt-sc1|psk|");
        h.update(secret.trim().as_bytes());
        Psk(h.finalize().into())
    }

    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Psk(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Ключ из окружения `TIMETABLE_PSK` (ручное переопределение / тесты). Обычно ключи создаются
    /// автоматическим сопряжением (см. pairing.rs), а не вшиваются в сборку.
    pub fn from_env() -> Option<Self> {
        match std::env::var("TIMETABLE_PSK") {
            Ok(v) if !v.trim().is_empty() => Some(Self::from_secret(&v)),
            _ => None,
        }
    }

    fn hkdf_key(&self, salt: &[u8], info: &[u8]) -> [u8; 32] {
        let hk = Hkdf::<Sha256>::new(Some(salt), &self.0);
        let mut out = [0u8; 32];
        hk.expand(info, &mut out).expect("32 bytes is a valid HKDF length");
        out
    }

    fn mac(&self, context: &str) -> HmacSha256 {
        // HMAC принимает ключ любой длины — new_from_slice не вернёт ошибку.
        let mut m = <HmacSha256 as Mac>::new_from_slice(&self.0).expect("hmac key");
        m.update(b"tt-sc1|");
        m.update(context.as_bytes());
        m.update(b"|");
        m
    }
}

// ─── Случайность ─────────────────────────────────────────────────────────────

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    getrandom::getrandom(&mut buf).expect("OS random source unavailable");
    buf
}

pub fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).expect("OS random source unavailable");
    hex_encode(&buf)
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ─── hex ─────────────────────────────────────────────────────────────────────

pub fn hex_encode(data: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(data.len() * 2);
    for b in data {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

pub fn hex_decode(s: &str) -> Option<Vec<u8>> {
    let s = s.trim();
    if s.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    for pair in bytes.chunks(2) {
        let hi = (pair[0] as char).to_digit(16)?;
        let lo = (pair[1] as char).to_digit(16)?;
        out.push(((hi << 4) | lo) as u8);
    }
    Some(out)
}

// ─── Кадры ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReqMeta {
    /// Время клиента, мс с эпохи (с поправкой на сервер).
    pub ts: i64,
    /// Уникальный id запроса (hex, 16+ символов).
    pub id: String,
    pub method: String,
    /// Путь с query, например `/api/schedule?room_id=3`.
    pub path: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResMeta {
    pub id: String,
    pub status: u16,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
}

pub fn encode_frame(meta_json: &[u8], body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + meta_json.len() + body.len());
    out.extend_from_slice(&(meta_json.len() as u32).to_be_bytes());
    out.extend_from_slice(meta_json);
    out.extend_from_slice(body);
    out
}

pub fn decode_frame(frame: &[u8]) -> Result<(&[u8], &[u8]), ScError> {
    if frame.len() < 4 {
        return Err(ScError::BadFormat);
    }
    let len = u32::from_be_bytes([frame[0], frame[1], frame[2], frame[3]]) as usize;
    if frame.len() < 4 + len {
        return Err(ScError::BadFormat);
    }
    Ok((&frame[4..4 + len], &frame[4 + len..]))
}

// ─── Шифрование ──────────────────────────────────────────────────────────────

fn req_aad(salt: &[u8]) -> Vec<u8> {
    let mut aad = b"tt-sc1|req|".to_vec();
    aad.push(VERSION);
    aad.extend_from_slice(salt);
    aad
}

fn res_aad(salt: &[u8], req_id: &str) -> Vec<u8> {
    let mut aad = b"tt-sc1|res|".to_vec();
    aad.extend_from_slice(salt);
    aad.extend_from_slice(req_id.as_bytes());
    aad
}

fn encrypt(key: &[u8; 32], iv: &[u8; IV_LEN], aad: &[u8], plain: &[u8]) -> Vec<u8> {
    let cipher = Aes256Gcm::new_from_slice(key).expect("aes key");
    cipher
        .encrypt(Nonce::from_slice(iv), Payload { msg: plain, aad })
        .expect("aes-gcm encrypt")
}

fn decrypt(key: &[u8; 32], iv: &[u8], aad: &[u8], ct: &[u8]) -> Result<Vec<u8>, ScError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| ScError::Decrypt)?;
    cipher
        .decrypt(Nonce::from_slice(iv), Payload { msg: ct, aad })
        .map_err(|_| ScError::Decrypt)
}

/// Детерминированная версия (для тестовых векторов и совместимости с JS).
pub fn seal_request_with(
    psk: &Psk,
    salt: &[u8; SALT_LEN],
    iv: &[u8; IV_LEN],
    frame: &[u8],
) -> Vec<u8> {
    let key = psk.hkdf_key(salt, b"tt-sc1 req");
    let ct = encrypt(&key, iv, &req_aad(salt), frame);
    let mut out = Vec::with_capacity(1 + SALT_LEN + IV_LEN + ct.len());
    out.push(VERSION);
    out.extend_from_slice(salt);
    out.extend_from_slice(iv);
    out.extend_from_slice(&ct);
    out
}

/// Шифрует кадр запроса. Возвращает пакет и соль (нужна, чтобы расшифровать ответ).
pub fn seal_request(psk: &Psk, frame: &[u8]) -> (Vec<u8>, [u8; SALT_LEN]) {
    let salt: [u8; SALT_LEN] = random_bytes();
    let iv: [u8; IV_LEN] = random_bytes();
    (seal_request_with(psk, &salt, &iv, frame), salt)
}

/// Расшифровывает пакет запроса. Возвращает кадр и соль.
pub fn open_request(psk: &Psk, wire: &[u8]) -> Result<(Vec<u8>, [u8; SALT_LEN]), ScError> {
    if wire.len() < 1 + SALT_LEN + IV_LEN + TAG_LEN {
        return Err(ScError::BadFormat);
    }
    if wire[0] != VERSION {
        return Err(ScError::BadVersion);
    }
    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&wire[1..1 + SALT_LEN]);
    let iv = &wire[1 + SALT_LEN..1 + SALT_LEN + IV_LEN];
    let ct = &wire[1 + SALT_LEN + IV_LEN..];
    let key = psk.hkdf_key(&salt, b"tt-sc1 req");
    let plain = decrypt(&key, iv, &req_aad(&salt), ct)?;
    Ok((plain, salt))
}

/// Пробует расшифровать запрос каждым из ключей. Возвращает (кадр, соль, индекс ключа).
pub fn open_request_multi(
    keys: &[Psk],
    wire: &[u8],
) -> Result<(Vec<u8>, [u8; SALT_LEN], usize), ScError> {
    let mut last = ScError::Decrypt;
    for (i, k) in keys.iter().enumerate() {
        match open_request(k, wire) {
            Ok((frame, salt)) => return Ok((frame, salt, i)),
            Err(ScError::BadFormat) => return Err(ScError::BadFormat),
            Err(ScError::BadVersion) => return Err(ScError::BadVersion),
            Err(e) => last = e,
        }
    }
    Err(last)
}

pub fn seal_response_with(
    psk: &Psk,
    salt: &[u8; SALT_LEN],
    req_id: &str,
    iv: &[u8; IV_LEN],
    frame: &[u8],
) -> Vec<u8> {
    let key = psk.hkdf_key(salt, b"tt-sc1 res");
    let ct = encrypt(&key, iv, &res_aad(salt, req_id), frame);
    let mut out = Vec::with_capacity(1 + IV_LEN + ct.len());
    out.push(VERSION);
    out.extend_from_slice(iv);
    out.extend_from_slice(&ct);
    out
}

pub fn seal_response(psk: &Psk, salt: &[u8; SALT_LEN], req_id: &str, frame: &[u8]) -> Vec<u8> {
    let iv: [u8; IV_LEN] = random_bytes();
    seal_response_with(psk, salt, req_id, &iv, frame)
}

pub fn open_response(
    psk: &Psk,
    salt: &[u8; SALT_LEN],
    req_id: &str,
    wire: &[u8],
) -> Result<Vec<u8>, ScError> {
    if wire.len() < 1 + IV_LEN + TAG_LEN {
        return Err(ScError::BadFormat);
    }
    if wire[0] != VERSION {
        return Err(ScError::BadVersion);
    }
    let iv = &wire[1..1 + IV_LEN];
    let ct = &wire[1 + IV_LEN..];
    let key = psk.hkdf_key(salt, b"tt-sc1 res");
    decrypt(&key, iv, &res_aad(salt, req_id), ct)
}

// ─── Удобные обёртки для клиента (Rust → Rust) ───────────────────────────────

/// Готовит запрос: возвращает (пакет, соль, id).
pub fn build_request(
    psk: &Psk,
    method: &str,
    path: &str,
    headers: BTreeMap<String, String>,
    body: &[u8],
    clock_offset_ms: i64,
) -> Result<(Vec<u8>, [u8; SALT_LEN], String), ScError> {
    let id = random_hex(16);
    let meta = ReqMeta {
        ts: now_ms() + clock_offset_ms,
        id: id.clone(),
        method: method.to_uppercase(),
        path: path.to_string(),
        headers,
    };
    let meta_json = serde_json::to_vec(&meta).map_err(|e| ScError::Meta(e.to_string()))?;
    let frame = encode_frame(&meta_json, body);
    let (wire, salt) = seal_request(psk, &frame);
    Ok((wire, salt, id))
}

/// Разбирает ответ сервера: (мета, тело).
pub fn parse_response(
    psk: &Psk,
    salt: &[u8; SALT_LEN],
    req_id: &str,
    wire: &[u8],
) -> Result<(ResMeta, Vec<u8>), ScError> {
    let frame = open_response(psk, salt, req_id, wire)?;
    let (meta_json, body) = decode_frame(&frame)?;
    let meta: ResMeta = serde_json::from_slice(meta_json).map_err(|e| ScError::Meta(e.to_string()))?;
    if meta.id != req_id {
        return Err(ScError::Decrypt);
    }
    Ok((meta, body.to_vec()))
}

// ─── Защита от повторов ──────────────────────────────────────────────────────

#[derive(Default)]
pub struct ReplayGuard {
    seen: Mutex<HashMap<String, i64>>,
}

impl ReplayGuard {
    pub fn new() -> Self {
        Self::default()
    }

    /// Проверяет время и уникальность id. `now_ms` передаётся для тестируемости.
    pub fn check(&self, ts: i64, id: &str, now_ms: i64) -> Result<(), ScError> {
        if id.len() < 16 || id.len() > 128 {
            return Err(ScError::Meta("bad request id".into()));
        }
        if (now_ms - ts).abs() > MAX_SKEW_MS {
            return Err(ScError::Skew { server_time_ms: now_ms });
        }
        let mut seen = self.seen.lock().unwrap();
        if seen.len() > 256 {
            seen.retain(|_, exp| *exp > now_ms);
        }
        // Жёсткий предел на случай флуда валидными (но уникальными) запросами.
        if seen.len() > 50_000 {
            seen.clear();
        }
        if seen.contains_key(id) {
            return Err(ScError::Replay);
        }
        seen.insert(id.to_string(), ts + MAX_SKEW_MS + 1000);
        Ok(())
    }
}

// ─── hello / подписи ─────────────────────────────────────────────────────────

fn valid_nonce(nonce: &str) -> bool {
    (8..=64).contains(&nonce.len()) && nonce.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// Доказательство владения PSK в ответ на nonce клиента.
pub fn hello_proof(psk: &Psk, nonce: &str) -> Option<String> {
    if !valid_nonce(nonce) {
        return None;
    }
    let mut m = psk.mac("hello");
    m.update(nonce.as_bytes());
    m.update(b"|");
    m.update(TV_ROLE.as_bytes());
    Some(hex_encode(&m.finalize().into_bytes()))
}

pub fn verify_hello(psk: &Psk, nonce: &str, proof_hex: &str) -> bool {
    if !valid_nonce(nonce) {
        return false;
    }
    let Some(proof) = hex_decode(proof_hex) else {
        return false;
    };
    let mut m = psk.mac("hello");
    m.update(nonce.as_bytes());
    m.update(b"|");
    m.update(TV_ROLE.as_bytes());
    m.verify_slice(&proof).is_ok()
}

/// Подпись произвольных данных в контексте (`weather`, ...). hex.
pub fn sign(psk: &Psk, context: &str, data: &[u8]) -> String {
    let mut m = psk.mac(context);
    m.update(data);
    hex_encode(&m.finalize().into_bytes())
}

pub fn verify_sig(psk: &Psk, context: &str, data: &[u8], sig_hex: &str) -> bool {
    let Some(sig) = hex_decode(sig_hex) else {
        return false;
    };
    let mut m = psk.mac(context);
    m.update(data);
    m.verify_slice(&sig).is_ok()
}

/// Значение заголовка `X-TT-Auth` для команд TV → админ: `<ts_ms>.<hmac>`.
pub fn make_auth_header(psk: &Psk, purpose: &str, now_ms: i64) -> String {
    format!("{}.{}", now_ms, sign(psk, purpose, now_ms.to_string().as_bytes()))
}

pub fn verify_auth_header(psk: &Psk, purpose: &str, header: &str, now_ms: i64) -> bool {
    let Some((ts_str, sig)) = header.split_once('.') else {
        return false;
    };
    let Ok(ts) = ts_str.parse::<i64>() else {
        return false;
    };
    if (now_ms - ts).abs() > MAX_SKEW_MS {
        return false;
    }
    verify_sig(psk, purpose, ts_str.as_bytes(), sig)
}

// ─── Тесты ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn psk() -> Psk {
        Psk::from_secret("unit-test-secret")
    }

    fn headers() -> BTreeMap<String, String> {
        let mut h = BTreeMap::new();
        h.insert("content-type".into(), "application/json".into());
        h
    }

    #[test]
    fn request_roundtrip() {
        let p = psk();
        let (wire, salt, id) = build_request(&p, "post", "/api/rooms", headers(), b"{\"number\":\"101\"}", 0).unwrap();
        let (frame, salt2) = open_request(&p, &wire).unwrap();
        assert_eq!(salt, salt2);
        let (meta_json, body) = decode_frame(&frame).unwrap();
        let meta: ReqMeta = serde_json::from_slice(meta_json).unwrap();
        assert_eq!(meta.method, "POST");
        assert_eq!(meta.path, "/api/rooms");
        assert_eq!(meta.id, id);
        assert_eq!(body, b"{\"number\":\"101\"}");
    }

    #[test]
    fn response_roundtrip_and_binding_to_request_id() {
        let p = psk();
        let salt = [7u8; SALT_LEN];
        let meta = ResMeta { id: "a".repeat(32), status: 201, headers: headers() };
        let frame = encode_frame(&serde_json::to_vec(&meta).unwrap(), b"hello");
        let wire = seal_response(&p, &salt, &meta.id, &frame);
        let (m, body) = parse_response(&p, &salt, &meta.id, &wire).unwrap();
        assert_eq!(m.status, 201);
        assert_eq!(body, b"hello");
        // чужой id запроса → ответ не принимается (защита от подмены ответа)
        assert_eq!(parse_response(&p, &salt, &"b".repeat(32), &wire).unwrap_err(), ScError::Decrypt);
        // другая соль → тоже нет
        assert!(parse_response(&p, &[8u8; SALT_LEN], &meta.id, &wire).is_err());
    }

    #[test]
    fn wrong_key_is_rejected() {
        let (wire, _, _) = build_request(&psk(), "GET", "/api/rooms", BTreeMap::new(), b"", 0).unwrap();
        let other = Psk::from_secret("another-secret");
        assert_eq!(open_request(&other, &wire).unwrap_err(), ScError::Decrypt);
    }

    #[test]
    fn tampering_is_detected_everywhere() {
        let p = psk();
        let (wire, _, _) = build_request(&p, "GET", "/api/rooms", BTreeMap::new(), b"body", 0).unwrap();
        // портим по одному байту в каждой позиции пакета (кроме версии — она даёт BadVersion)
        for i in 1..wire.len() {
            let mut bad = wire.clone();
            bad[i] ^= 0x01;
            assert!(open_request(&p, &bad).is_err(), "byte {} not authenticated", i);
        }
        let mut bad = wire.clone();
        bad[0] = 9;
        assert_eq!(open_request(&p, &bad).unwrap_err(), ScError::BadVersion);
    }

    #[test]
    fn short_packets_do_not_panic() {
        let p = psk();
        for n in 0..(1 + SALT_LEN + IV_LEN + TAG_LEN) {
            assert!(open_request(&p, &vec![VERSION; n]).is_err());
        }
        assert!(decode_frame(&[0, 0, 0]).is_err());
        assert!(decode_frame(&[0, 0, 0, 9, 1, 2]).is_err());
    }

    #[test]
    fn ciphertext_hides_plaintext_and_is_randomized() {
        let p = psk();
        let (a, _, _) = build_request(&p, "GET", "/api/secret-path-xyz", BTreeMap::new(), b"super-secret-body", 0).unwrap();
        let (b, _, _) = build_request(&p, "GET", "/api/secret-path-xyz", BTreeMap::new(), b"super-secret-body", 0).unwrap();
        assert_ne!(a, b);
        let hay = String::from_utf8_lossy(&a);
        assert!(!hay.contains("secret-path-xyz") && !hay.contains("super-secret-body"));
    }

    #[test]
    fn replay_and_skew() {
        let g = ReplayGuard::new();
        let now = 1_000_000_000_000i64;
        let id = "0123456789abcdef0123456789abcdef";
        assert!(g.check(now, id, now).is_ok());
        assert_eq!(g.check(now, id, now + 1000).unwrap_err(), ScError::Replay);
        assert_eq!(
            g.check(now - MAX_SKEW_MS - 1, "ffffffffffffffffffffffff00000001", now).unwrap_err(),
            ScError::Skew { server_time_ms: now }
        );
        assert_eq!(
            g.check(now + MAX_SKEW_MS + 1, "ffffffffffffffffffffffff00000002", now).unwrap_err(),
            ScError::Skew { server_time_ms: now }
        );
        assert!(g.check(now + MAX_SKEW_MS - 1, "ffffffffffffffffffffffff00000003", now).is_ok());
        assert!(g.check(now, "short", now).is_err());
    }

    #[test]
    fn replay_guard_prunes_expired_ids() {
        let g = ReplayGuard::new();
        let t0 = 5_000_000_000_000i64;
        for i in 0..300 {
            g.check(t0, &format!("{:032x}", i), t0).unwrap();
        }
        // через >5 минут старые записи вычищаются и могут быть приняты как новые id
        let later = t0 + MAX_SKEW_MS * 3;
        g.check(later, &format!("{:032x}", 1000), later).unwrap();
        assert!(g.seen.lock().unwrap().len() < 300);
    }

    #[test]
    fn hello_proof_roundtrip() {
        let p = psk();
        let nonce = "abcDEF0123456789";
        let proof = hello_proof(&p, nonce).unwrap();
        assert!(verify_hello(&p, nonce, &proof));
        assert!(!verify_hello(&p, "otherNonce123456", &proof));
        assert!(!verify_hello(&Psk::from_secret("x"), nonce, &proof));
        assert!(!verify_hello(&p, nonce, "zz"));
        assert!(hello_proof(&p, "bad nonce!").is_none());
        assert!(hello_proof(&p, "short").is_none());
    }

    #[test]
    fn signatures_and_auth_header() {
        let p = psk();
        let data = b"{\"temperature\":3.5}";
        let sig = sign(&p, "weather", data);
        assert!(verify_sig(&p, "weather", data, &sig));
        assert!(!verify_sig(&p, "weather", b"{\"temperature\":30.5}", &sig));
        assert!(!verify_sig(&p, "refresh", data, &sig), "контексты разделены");

        let now = 1_700_000_000_000i64;
        let h = make_auth_header(&p, "weather-refresh", now);
        assert!(verify_auth_header(&p, "weather-refresh", &h, now + 1000));
        assert!(!verify_auth_header(&p, "weather-refresh", &h, now + MAX_SKEW_MS + 10));
        assert!(!verify_auth_header(&p, "other", &h, now));
        assert!(!verify_auth_header(&p, "weather-refresh", "garbage", now));
    }

    #[test]
    fn open_request_multi_picks_the_right_key() {
        let keys = vec![Psk::from_secret("a"), Psk::from_secret("b"), Psk::from_secret("c")];
        let (wire, _, _) = build_request(&keys[1], "GET", "/api/x", BTreeMap::new(), b"", 0).unwrap();
        let (_, _, idx) = open_request_multi(&keys, &wire).unwrap();
        assert_eq!(idx, 1);
        assert_eq!(open_request_multi(&[Psk::from_secret("z")], &wire).unwrap_err(), ScError::Decrypt);
        assert_eq!(open_request_multi(&[], &wire).unwrap_err(), ScError::Decrypt);
        assert_eq!(open_request_multi(&keys, &[1, 2]).unwrap_err(), ScError::BadFormat);
    }

    #[test]
    fn hex_helpers() {
        assert_eq!(hex_encode(&[0, 15, 255]), "000fff");
        assert_eq!(hex_decode("000FFF").unwrap(), vec![0, 15, 255]);
        assert!(hex_decode("abc").is_none());
        assert!(hex_decode("zz").is_none());
    }

    /// Вектор совместимости Rust ↔ JS (admin-panel/lib/secure-channel.test.ts использует те же значения).
    /// Если меняется формат протокола — обновить ОБА теста.
    #[test]
    fn interop_vector() {
        let p = Psk::from_secret("interop-secret");
        let salt = [0x11u8; SALT_LEN];
        let iv = [0x22u8; IV_LEN];
        let meta = br#"{"ts":1700000000000,"id":"00112233445566778899aabbccddeeff","method":"GET","path":"/api/rooms","headers":{}}"#;
        let frame = encode_frame(meta, b"body");
        let wire = seal_request_with(&p, &salt, &iv, &frame);
        assert_eq!(hex_encode(p.as_bytes()), INTEROP_PSK_HEX);
        assert_eq!(hex_encode(&wire), INTEROP_REQUEST_WIRE_HEX);

        let res_iv = [0x33u8; IV_LEN];
        let res_meta = br#"{"id":"00112233445566778899aabbccddeeff","status":200,"headers":{}}"#;
        let res_frame = encode_frame(res_meta, b"ok");
        let res_wire = seal_response_with(&p, &salt, "00112233445566778899aabbccddeeff", &res_iv, &res_frame);
        assert_eq!(hex_encode(&res_wire), INTEROP_RESPONSE_WIRE_HEX);

        assert_eq!(hello_proof(&p, "nonce12345678").unwrap(), INTEROP_HELLO_PROOF);
        assert_eq!(sign(&p, "weather", b"abc"), INTEROP_WEATHER_SIG);
    }

    const INTEROP_PSK_HEX: &str = "cbacbdfdbaf3fa14a25dcd2047778f7d4be877ee384e743f1beb732e5331e310";
    const INTEROP_REQUEST_WIRE_HEX: &str = "011111111111111111111111111111111122222222222222222222222279ad5fd0bf4fcd96863612c14d8f71c64357f4352d2b2481edff1cf4e0a98a2ecd5551f28d74fa20f55f1c94b1108d23920278bad3983f2c1d0fa82a89573f49a2deb865267c34f492719616818d5a3a6768c5e187fc1d52086f8fed2b4985a45ad8e5f3d2c0bc37d3989fb8ba4f678423c1c984da14d81c2fe2c3c76850c7c134a33235";
    const INTEROP_RESPONSE_WIRE_HEX: &str = "0133333333333333333333333360aee63efcf96da53f0d3211f97f0c82b5d96646ad0ea5b102dde210a6877f5797af5c7214f93012e6fb9e8740990cf66a651d13db53c2126d54704c3aa1a59ddce8abec6876beb95254d6008b57e2c4cb32a18467b4b6940a";
    const INTEROP_HELLO_PROOF: &str = "f89e4f101fe1f89c960f6b3c5ce4bdc5707595898ac8f17ca407ed4d9db23b63";
    const INTEROP_WEATHER_SIG: &str = "b0a1afda46e7c30cf525822b75174b171c3c88b95b203101c00faa5ce41aca09";
}
