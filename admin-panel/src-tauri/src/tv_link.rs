//! Клиентская часть защищённого канала: admin-panel → Timetable TV.
//!
//! * `verify_tv*`          — убедиться, что по адресу действительно настоящий TV с тем же ключом
//!                           (ответ `/sc/hello` подписан общим ключом). Самозванцы отбрасываются.
//! * `secure_request`      — зашифрованный запрос к `/api/*` через туннель `/sc`.
//! * `register_admin_panel`— handshake: сообщить TV свой адрес (TV сам панель не ищет).

use crate::pairing;
use crate::secure_channel::{self as sc, Psk};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// Поправка к часам (мс): подстраиваемся под часы TV, если они разошлись.
static CLOCK_OFFSET_MS: AtomicI64 = AtomicI64::new(0);

// ─── собственный ключ панели ─────────────────────────────────────────────────

static OWN_PSK: OnceLock<Psk> = OnceLock::new();

/// Создаёт (при первом запуске) или читает ключ этой установки admin-panel.
/// Ключ случаен и не зависит ни от машины сборки, ни от сети.
pub fn init(key_file: &Path) {
    let _ = OWN_PSK.set(pairing::load_or_create_own_psk(key_file));
    *KEY_FILE.lock().unwrap() = Some(key_file.display().to_string());
}

static KEY_FILE: Mutex<Option<String>> = Mutex::new(None);

/// Где лежит ключ панели (для диагностики).
pub fn key_file_path() -> Option<String> {
    KEY_FILE.lock().unwrap().clone()
}

/// Ключ панели. `TIMETABLE_PSK` в окружении — ручное переопределение (тесты, отладка).
pub fn load_psk() -> Result<Psk, String> {
    if let Some(p) = Psk::from_env() {
        return Ok(p);
    }
    OWN_PSK
        .get()
        .cloned()
        .ok_or_else(|| "ключ панели не инициализирован (не удалось определить папку данных приложения)".to_string())
}

// ─── результат проверки адреса ───────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Probe {
    /// Настоящий TV, уже сопряжён с нами.
    Verified,
    /// TV ждёт сопряжения (ещё ни с кем не сопряжён или владелец открыл окно); его открытый ключ.
    Pairable([u8; 32]),
    /// TV сопряжён с другой панелью.
    Foreign,
    /// TV назвал наш ключ, но доказательство неверно (подмена/коллизия).
    WrongKey,
    /// Старая версия TV без автоматического сопряжения.
    OldTv,
    /// По адресу отвечает не Timetable TV.
    NotTv,
    /// Нет ответа.
    Unreachable,
}

/// Идентификатор нашего ключа (8 hex) — TV по нему выбирает ключ, не раскрывая его.
pub fn own_kid() -> Result<String, String> {
    Ok(pairing::kid(&load_psk()?))
}

/// Проверка тела ответа `/sc/hello` (вынесено для тестов).
pub fn classify_hello(psk: &Psk, nonce: &str, json: &serde_json::Value) -> Probe {
    if json["proto"] != sc::PROTO || json["role"] != sc::TV_ROLE {
        return Probe::NotTv;
    }
    match json["state"].as_str() {
        Some("paired") => {
            let ok = json["proof"].as_str().map(|p| sc::verify_hello(psk, nonce, p)).unwrap_or(false);
            if ok { Probe::Verified } else { Probe::WrongKey }
        }
        Some("unpaired") | Some("open") => match json["pair_pub"].as_str().and_then(pairing::parse_pub) {
            Some(p) => Probe::Pairable(p),
            None => Probe::NotTv,
        },
        Some("foreign") => Probe::Foreign,
        // Сборка без поля state — старая версия протокола.
        None if json["proof"].is_string() => Probe::OldTv,
        _ => Probe::NotTv,
    }
}

/// Человеческое объяснение для интерфейса.
pub fn describe(probe: &Probe, url: &str) -> Option<String> {
    match probe {
        Probe::Verified | Probe::Pairable(_) | Probe::NotTv => None,
        Probe::Foreign => Some(format!(
            "TV {} уже сопряжён с другой панелью. Откройте старую панель и нажмите «Разрешить новую панель» \
             (или сбросьте сопряжение на самом TV)",
            url
        )),
        Probe::WrongKey => Some(format!("TV {} не прошёл проверку подлинности", url)),
        Probe::OldTv => Some(format!(
            "на TV {} установлена старая версия без автоматического сопряжения — установите новую сборку TV",
            url
        )),
        Probe::Unreachable => Some(format!(
            "TV {} не отвечает по сети (выключен, другой адрес или порт 8000 закрыт брандмауэром Windows)",
            url
        )),
    }
}

fn priority(p: &Probe) -> u8 {
    match p {
        Probe::Foreign => 5,
        Probe::OldTv => 4,
        Probe::WrongKey => 3,
        Probe::Unreachable => 1,
        _ => 0,
    }
}

static NOTE: Mutex<Option<(u8, String)>> = Mutex::new(None);

/// Запоминает самую важную причину неудачи в этом раунде поиска (для показа пользователю).
pub fn note(probe: &Probe, url: &str, important_url: bool) {
    record_probe(probe, url, important_url);
    // Перебор подсети даёт кучу «не отвечает» — они не причина; значим только адрес, который мы ждали.
    if matches!(probe, Probe::Unreachable) && !important_url {
        return;
    }
    let prio = priority(probe);
    if prio == 0 {
        return;
    }
    if let Some(text) = describe(probe, url) {
        let mut guard = NOTE.lock().unwrap();
        if guard.as_ref().map(|(p, _)| prio >= *p).unwrap_or(true) {
            *guard = Some((prio, text));
        }
    }
}

pub fn take_note() -> Option<String> {
    NOTE.lock().unwrap().take().map(|(_, t)| t)
}

pub fn clear_note() {
    *NOTE.lock().unwrap() = None;
    *ROUND.lock().unwrap() = RoundLog::default();
}

// ─── журнал раунда поиска (для подробных сообщений об ошибке) ─────────────────

#[derive(Default)]
struct RoundLog {
    checked: usize,
    entries: Vec<String>,
    info: Vec<String>,
}

static ROUND: Mutex<RoundLog> = Mutex::new(RoundLog { checked: 0, entries: Vec::new(), info: Vec::new() });

fn probe_label(p: &Probe) -> &'static str {
    match p {
        Probe::Verified => "наш TV (сопряжён)",
        Probe::Pairable(_) => "TV, ждёт сопряжения",
        Probe::Foreign => "TV, сопряжён с другой панелью",
        Probe::WrongKey => "TV не подтвердил подлинность",
        Probe::OldTv => "старая версия TV",
        Probe::NotTv => "отвечает не TV",
        Probe::Unreachable => "нет ответа",
    }
}

/// Запоминает результат проверки адреса. В сводку попадают «важные» адреса и всё, что ответило.
pub fn record_probe(probe: &Probe, url: &str, important_url: bool) {
    let mut r = ROUND.lock().unwrap();
    r.checked += 1;
    let notable = important_url || !matches!(probe, Probe::Unreachable | Probe::NotTv);
    if notable && r.entries.len() < 8 {
        r.entries.push(format!("{} — {}", url, probe_label(probe)));
    }
}

/// Дополнительная строка сводки («Сканировал подсети: …»).
pub fn record_info(text: String) {
    let mut r = ROUND.lock().unwrap();
    if r.info.len() < 6 && !r.info.contains(&text) {
        r.info.push(text);
    }
}

/// Подробная сводка: что проверялось и что ответило.
pub fn round_summary() -> String {
    let r = ROUND.lock().unwrap();
    let mut parts: Vec<String> = r.info.clone();
    if r.checked > 0 {
        parts.push(format!("Проверено адресов: {}", r.checked));
    }
    if !r.entries.is_empty() {
        parts.push(format!("Ответы: {}", r.entries.join("; ")));
    } else if r.checked > 0 {
        parts.push("Ни один адрес не ответил как TV".to_string());
    }
    parts.join(". ")
}

fn hello_url(base_url: &str, nonce: &str, kid: &str) -> String {
    format!("{}/sc/hello?c={}&k={}", base_url.trim_end_matches('/'), nonce, kid)
}

async fn is_old_plain_tv(client: &reqwest::Client, base_url: &str) -> bool {
    match client.get(format!("{}/api/health", base_url.trim_end_matches('/'))).send().await {
        Ok(r) if r.status().is_success() => r
            .json::<serde_json::Value>()
            .await
            .map(|j| j["status"] == "healthy")
            .unwrap_or(false),
        _ => false,
    }
}

/// Узнаёт, что за устройство по адресу (и можно ли с ним сопрягаться).
pub async fn probe_with_client(client: &reqwest::Client, base_url: &str) -> Probe {
    let Ok(psk) = load_psk() else { return Probe::NotTv };
    let nonce = sc::random_hex(8);
    let resp = match client.get(hello_url(base_url, &nonce, &pairing::kid(&psk))).send().await {
        Ok(r) => r,
        Err(_) => return Probe::Unreachable,
    };
    if resp.status().as_u16() == 404 || resp.status().as_u16() == 405 {
        return if is_old_plain_tv(client, base_url).await { Probe::OldTv } else { Probe::NotTv };
    }
    if !resp.status().is_success() {
        return Probe::NotTv;
    }
    match resp.json::<serde_json::Value>().await {
        Ok(json) => classify_hello(&psk, &nonce, &json),
        Err(_) => Probe::NotTv,
    }
}

fn short_client(ms: u64) -> Option<reqwest::Client> {
    reqwest::Client::builder().timeout(Duration::from_millis(ms)).build().ok()
}

pub async fn probe(base_url: &str) -> Probe {
    match short_client(1500) {
        Some(c) => probe_with_client(&c, base_url).await,
        None => Probe::Unreachable,
    }
}

/// Блокирующая версия (mDNS-поток): годится ли адрес как кандидат (настоящий TV: наш или ждущий сопряжения).
pub fn candidate_blocking(base_url: &str) -> bool {
    let Ok(psk) = load_psk() else { return false };
    let Ok(client) = reqwest::blocking::Client::builder().timeout(Duration::from_millis(1500)).build() else {
        return false;
    };
    let nonce = sc::random_hex(8);
    let probe = match client.get(hello_url(base_url, &nonce, &pairing::kid(&psk))).send() {
        Ok(r) if r.status().is_success() => match r.json::<serde_json::Value>() {
            Ok(json) => classify_hello(&psk, &nonce, &json),
            Err(_) => Probe::NotTv,
        },
        Ok(_) => Probe::NotTv,
        Err(_) => Probe::Unreachable,
    };
    note(&probe, base_url, true);
    matches!(probe, Probe::Verified | Probe::Pairable(_))
}

// ─── автоматическое сопряжение ───────────────────────────────────────────────

/// Подпись панели в списке TV («Кафедра 410 @ ПК-1»).
fn panel_label() -> String {
    let app = option_env!("NEXT_PUBLIC_APP_NAME").unwrap_or("admin-panel");
    let host = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_default();
    if host.is_empty() { app.to_string() } else { format!("{} @ {}", app, host) }
}

/// Тело запроса `/sc/pair` (+ наш открытый ключ для проверки подтверждения).
pub fn build_pair_request(tv_pub: &[u8; 32], psk: &Psk, label: &str) -> Result<(serde_json::Value, [u8; 32]), String> {
    let (admin_pub, blob) = pairing::seal_pairing(tv_pub, psk, label).map_err(|e| e.to_string())?;
    Ok((
        serde_json::json!({ "admin_pub": sc::hex_encode(&admin_pub), "blob": sc::hex_encode(&blob) }),
        admin_pub,
    ))
}

/// Проверка подтверждения TV: он получил именно наш ключ и именно тот открытый ключ, что мы видели в hello.
pub fn check_pair_response(
    psk: &Psk,
    admin_pub: &[u8; 32],
    tv_pub: &[u8; 32],
    json: &serde_json::Value,
) -> Result<(), String> {
    if json["tv_pub"].as_str().and_then(pairing::parse_pub).as_ref() != Some(tv_pub) {
        return Err("TV ответил другим ключом сопряжения".to_string());
    }
    let ack = json["ack"].as_str().ok_or_else(|| "TV не подтвердил сопряжение".to_string())?;
    if pairing::verify_pair_ack(psk, admin_pub, tv_pub, ack) {
        Ok(())
    } else {
        Err("подтверждение сопряжения от TV неверно".to_string())
    }
}

async fn pair_with_tv(client: &reqwest::Client, base_url: &str, tv_pub: &[u8; 32]) -> Result<(), String> {
    let psk = load_psk()?;
    let (body, admin_pub) = build_pair_request(tv_pub, &psk, &panel_label())?;
    let resp = client
        .post(format!("{}/sc/pair", base_url.trim_end_matches('/')))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("pair request failed: {}", e))?;
    let status = resp.status();
    let json: serde_json::Value = resp.json().await.unwrap_or_default();
    if status.as_u16() == 403 {
        return Err("TV уже сопряжён с другой панелью".to_string());
    }
    if !status.is_success() {
        return Err(format!("pairing rejected ({}): {}", status, json["detail"].as_str().unwrap_or("")));
    }
    check_pair_response(&psk, &admin_pub, tv_pub, &json)
}

/// Главная точка входа поиска: адрес годится, если там наш TV; если TV ждёт сопряжения —
/// сопрягаемся автоматически (без кодов) и перепроверяем.
pub async fn ensure_paired_with_client(client: &reqwest::Client, base_url: &str, important_url: bool) -> bool {
    let first = probe_with_client(client, base_url).await;
    note(&first, base_url, important_url);
    match first {
        Probe::Verified => true,
        Probe::Pairable(tv_pub) => {
            if let Err(e) = pair_with_tv(client, base_url, &tv_pub).await {
                log::warn!("Pairing with {} failed: {}", base_url, e);
                note_text(5, format!("не удалось сопрячься с TV {}: {}", base_url, e));
                return false;
            }
            log::info!("Paired with TV {}", base_url);
            let second = probe_with_client(client, base_url).await;
            note(&second, base_url, true);
            second == Probe::Verified
        }
        _ => false,
    }
}

fn note_text(prio: u8, text: String) {
    let mut guard = NOTE.lock().unwrap();
    if guard.as_ref().map(|(p, _)| prio >= *p).unwrap_or(true) {
        *guard = Some((prio, text));
    }
}

pub async fn ensure_paired(base_url: &str, important_url: bool) -> bool {
    match short_client(2000) {
        Some(c) => ensure_paired_with_client(&c, base_url, important_url).await,
        None => false,
    }
}

/// Зашифрованный запрос к TV. Возвращает (HTTP-статус внутреннего ответа, тело).
pub async fn secure_request(
    base_url: &str,
    method: &str,
    path: &str,
    headers: BTreeMap<String, String>,
    body: &[u8],
) -> Result<(u16, Vec<u8>), String> {
    let psk = load_psk()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("{}/sc", base_url.trim_end_matches('/'));

    // Максимум две попытки: вторая — после коррекции часов, если TV пожаловался на расхождение.
    for attempt in 0..2 {
        let (wire, salt, id) = sc::build_request(
            &psk,
            method,
            path,
            headers.clone(),
            body,
            CLOCK_OFFSET_MS.load(Ordering::Relaxed),
        )
        .map_err(|e| e.to_string())?;

        let resp = client
            .post(&url)
            .header("Content-Type", "application/octet-stream")
            .body(wire)
            .send()
            .await
            .map_err(|e| format!("request to {} failed: {}", url, e))?;
        let status = resp.status();
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

        if status.as_u16() == 401 && attempt == 0 {
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                if v["code"] == "clock_skew" {
                    if let Some(server_time) = v["server_time_ms"].as_i64() {
                        CLOCK_OFFSET_MS.store(server_time - sc::now_ms(), Ordering::Relaxed);
                        continue;
                    }
                }
            }
        }
        if !status.is_success() {
            return Err(format!("secure channel to {} returned {}", url, status));
        }
        let (meta, payload) = sc::parse_response(&psk, &salt, &id, &bytes).map_err(|e| e.to_string())?;
        return Ok((meta.status, payload));
    }
    Err("secure channel: clock synchronisation failed".to_string())
}

/// Handshake: «я admin-panel, мой адрес такой-то». TV запоминает его и дальше сам ходит за погодой/обновлениями.
pub async fn register_admin_panel(tv_base_url: &str, admin_base_url: &str) -> Result<(), String> {
    let mut headers = BTreeMap::new();
    headers.insert("content-type".to_string(), "application/json".to_string());
    let body = serde_json::json!({ "base_url": admin_base_url, "admin_time_ms": sc::now_ms() }).to_string();
    let (status, payload) =
        secure_request(tv_base_url, "POST", "/api/admin-panel/register", headers, body.as_bytes()).await?;
    if (200..300).contains(&status) {
        Ok(())
    } else {
        Err(format!(
            "register returned {}: {}",
            status,
            String::from_utf8_lossy(&payload)
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hello(state: &str, extra: serde_json::Value) -> serde_json::Value {
        let mut v = serde_json::json!({"proto": sc::PROTO, "role": sc::TV_ROLE, "state": state});
        for (k, val) in extra.as_object().unwrap() {
            v[k] = val.clone();
        }
        v
    }

    #[test]
    fn hello_is_classified() {
        let psk = Psk::from_secret("admin-test");
        let nonce = "0123456789abcdef";
        let proof = sc::hello_proof(&psk, nonce).unwrap();
        let tv_pub = sc::hex_encode(&[7u8; 32]);

        assert_eq!(classify_hello(&psk, nonce, &hello("paired", serde_json::json!({"proof": proof}))), Probe::Verified);
        // чужой ключ / старый ответ (replay) / нет proof
        assert_eq!(classify_hello(&Psk::from_secret("evil"), nonce, &hello("paired", serde_json::json!({"proof": proof}))), Probe::WrongKey);
        assert_eq!(classify_hello(&psk, "ffffffffffffffff", &hello("paired", serde_json::json!({"proof": proof}))), Probe::WrongKey);
        assert_eq!(classify_hello(&psk, nonce, &hello("paired", serde_json::json!({}))), Probe::WrongKey);

        assert_eq!(classify_hello(&psk, nonce, &hello("unpaired", serde_json::json!({"pair_pub": tv_pub}))), Probe::Pairable([7; 32]));
        assert_eq!(classify_hello(&psk, nonce, &hello("open", serde_json::json!({"pair_pub": tv_pub}))), Probe::Pairable([7; 32]));
        assert_eq!(classify_hello(&psk, nonce, &hello("unpaired", serde_json::json!({}))), Probe::NotTv);
        assert_eq!(classify_hello(&psk, nonce, &hello("unpaired", serde_json::json!({"pair_pub": "zz"}))), Probe::NotTv);
        assert_eq!(classify_hello(&psk, nonce, &hello("foreign", serde_json::json!({}))), Probe::Foreign);

        // старая сборка: proof без state
        let old = serde_json::json!({"proto": sc::PROTO, "role": sc::TV_ROLE, "proof": proof});
        assert_eq!(classify_hello(&psk, nonce, &old), Probe::OldTv);
        // не TV
        assert_eq!(classify_hello(&psk, nonce, &serde_json::json!({})), Probe::NotTv);
        assert_eq!(classify_hello(&psk, nonce, &serde_json::json!({"proto": sc::PROTO, "role": "router", "state": "paired"})), Probe::NotTv);
    }

    #[test]
    fn pair_request_and_ack_are_checked() {
        let tv = pairing::PairKeypair::generate();
        let psk = Psk::from_bytes(sc::random_bytes());
        let (body, admin_pub) = build_pair_request(&tv.public, &psk, "x").unwrap();
        let blob = sc::hex_decode(body["blob"].as_str().unwrap()).unwrap();
        let (got, _) = pairing::open_pairing(&tv, &admin_pub, &blob).unwrap();
        assert_eq!(got.as_bytes(), psk.as_bytes());

        let ack = pairing::pair_ack(&psk, &admin_pub, &tv.public);
        let good = serde_json::json!({"ack": ack, "tv_pub": sc::hex_encode(&tv.public)});
        assert!(check_pair_response(&psk, &admin_pub, &tv.public, &good).is_ok());
        // подмена TV другим ключом / неверное подтверждение / нет подтверждения
        let other = pairing::PairKeypair::generate();
        let swapped = serde_json::json!({"ack": ack, "tv_pub": sc::hex_encode(&other.public)});
        assert!(check_pair_response(&psk, &admin_pub, &tv.public, &swapped).is_err());
        let bad_ack = serde_json::json!({"ack": "00", "tv_pub": sc::hex_encode(&tv.public)});
        assert!(check_pair_response(&psk, &admin_pub, &tv.public, &bad_ack).is_err());
        assert!(check_pair_response(&psk, &admin_pub, &tv.public, &serde_json::json!({})).is_err());
    }

    #[test]
    fn hello_url_carries_nonce_and_key_id() {
        assert_eq!(
            hello_url("http://10.0.0.5:8000/", "abc12345", "deadbeef"),
            "http://10.0.0.5:8000/sc/hello?c=abc12345&k=deadbeef"
        );
    }

    #[test]
    fn notes_keep_the_most_important_reason() {
        clear_note();
        note(&Probe::Unreachable, "http://10.0.0.9:8000", false);
        assert!(take_note().is_none(), "scan noise is not a reason");
        note(&Probe::Unreachable, "http://hint:8000", true);
        note(&Probe::Foreign, "http://10.0.0.5:8000", true);
        note(&Probe::Unreachable, "http://hint:8000", true);
        let n = take_note().unwrap();
        assert!(n.contains("другой панелью"), "{}", n);
        assert!(take_note().is_none());
        assert!(describe(&Probe::OldTv, "u").unwrap().contains("старая версия"));
    }
}
