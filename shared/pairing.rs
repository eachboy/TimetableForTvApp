//! Автоматическое сопряжение admin-panel ↔ TV без ввода кодов (общий модуль обоих приложений).
//!
//! ## Как это работает
//! * У каждой установки admin-panel при первом запуске создаётся случайный ключ (PSK).
//!   Он не зависит ни от машины сборки, ни от сети.
//! * Когда TV «открыт для сопряжения» (см. `secure_api::is_pairing_open`), admin-panel отправляет
//!   ему свой PSK, зашифрованный ключом обмена X25519 (Диффи — Хеллман). Пассивный наблюдатель
//!   сети (Wireshark) ключ получить не может.
//! * TV хранит список ключей (по одному на каждую admin-panel) в `pairing.json`.
//!
//! Что НЕ защищено: активный перехват (MITM) именно в момент первого сопряжения — человек
//! ничего не сверяет. Поэтому окно сопряжения у TV открыто только когда нужно (см. secure_api).

use crate::secure_channel::{self as sc, Psk};
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::path::PathBuf;
use x25519_dalek::{PublicKey, StaticSecret};

/// Максимум ключей (admin-panel) на одном TV; при переполнении удаляется самый старый.
pub const MAX_KEYS: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PairError {
    BadFormat,
    Decrypt,
    LowOrderPoint,
}

impl std::fmt::Display for PairError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PairError::BadFormat => write!(f, "malformed pairing message"),
            PairError::Decrypt => write!(f, "pairing message rejected"),
            PairError::LowOrderPoint => write!(f, "invalid public key"),
        }
    }
}

/// Короткий идентификатор ключа (8 hex) — по нему TV выбирает ключ, не раскрывая его.
pub fn kid(psk: &Psk) -> String {
    sc::sign(psk, "kid", b"")[..8].to_string()
}

pub struct PairKeypair {
    secret: StaticSecret,
    pub public: [u8; 32],
}

impl PairKeypair {
    pub fn generate() -> Self {
        let seed: [u8; 32] = sc::random_bytes();
        let secret = StaticSecret::from(seed);
        let public = PublicKey::from(&secret).to_bytes();
        PairKeypair { secret, public }
    }

    fn shared(&self, peer_pub: &[u8; 32]) -> Result<[u8; 32], PairError> {
        let shared = self.secret.diffie_hellman(&PublicKey::from(*peer_pub));
        if !shared.was_contributory() {
            return Err(PairError::LowOrderPoint);
        }
        Ok(shared.to_bytes())
    }
}

fn pair_key(shared: &[u8; 32], admin_pub: &[u8; 32], tv_pub: &[u8; 32]) -> [u8; 32] {
    let mut salt = Vec::with_capacity(64);
    salt.extend_from_slice(admin_pub);
    salt.extend_from_slice(tv_pub);
    let hk = Hkdf::<Sha256>::new(Some(&salt), shared);
    let mut out = [0u8; 32];
    hk.expand(b"tt-pair2 enc", &mut out).expect("hkdf length");
    out
}

fn pair_aad(admin_pub: &[u8; 32], tv_pub: &[u8; 32]) -> Vec<u8> {
    let mut aad = b"tt-pair2|".to_vec();
    aad.extend_from_slice(admin_pub);
    aad.extend_from_slice(tv_pub);
    aad
}

#[derive(Serialize, Deserialize)]
struct PairPayload {
    psk: String,
    label: String,
}

/// Сторона admin-panel: упаковывает свой PSK для TV с открытым ключом `tv_pub`.
/// Возвращает (открытый ключ админки, blob = iv ‖ шифртекст).
pub fn seal_pairing(tv_pub: &[u8; 32], psk: &Psk, label: &str) -> Result<([u8; 32], Vec<u8>), PairError> {
    let eph = PairKeypair::generate();
    let shared = eph.shared(tv_pub)?;
    let key = pair_key(&shared, &eph.public, tv_pub);
    let payload = serde_json::to_vec(&PairPayload { psk: sc::hex_encode(psk.as_bytes()), label: label.to_string() })
        .map_err(|_| PairError::BadFormat)?;
    let iv: [u8; 12] = sc::random_bytes();
    let ct = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| PairError::BadFormat)?
        .encrypt(Nonce::from_slice(&iv), Payload { msg: &payload, aad: &pair_aad(&eph.public, tv_pub) })
        .map_err(|_| PairError::Decrypt)?;
    let mut blob = iv.to_vec();
    blob.extend_from_slice(&ct);
    Ok((eph.public, blob))
}

/// Сторона TV: распаковывает PSK админки. Возвращает (PSK, метка).
pub fn open_pairing(tv: &PairKeypair, admin_pub: &[u8; 32], blob: &[u8]) -> Result<(Psk, String), PairError> {
    if blob.len() < 12 + 16 {
        return Err(PairError::BadFormat);
    }
    let shared = tv.shared(admin_pub)?;
    let key = pair_key(&shared, admin_pub, &tv.public);
    let plain = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| PairError::BadFormat)?
        .decrypt(
            Nonce::from_slice(&blob[..12]),
            Payload { msg: &blob[12..], aad: &pair_aad(admin_pub, &tv.public) },
        )
        .map_err(|_| PairError::Decrypt)?;
    let payload: PairPayload = serde_json::from_slice(&plain).map_err(|_| PairError::BadFormat)?;
    let bytes = sc::hex_decode(&payload.psk).ok_or(PairError::BadFormat)?;
    let arr: [u8; 32] = bytes.try_into().map_err(|_| PairError::BadFormat)?;
    let label: String = payload.label.chars().take(64).collect();
    Ok((Psk::from_bytes(arr), label))
}

/// Подтверждение от TV: «я получил именно этот ключ».
pub fn pair_ack(psk: &Psk, admin_pub: &[u8; 32], tv_pub: &[u8; 32]) -> String {
    let mut data = admin_pub.to_vec();
    data.extend_from_slice(tv_pub);
    sc::sign(psk, "pair-ack", &data)
}

pub fn verify_pair_ack(psk: &Psk, admin_pub: &[u8; 32], tv_pub: &[u8; 32], ack: &str) -> bool {
    let mut data = admin_pub.to_vec();
    data.extend_from_slice(tv_pub);
    sc::verify_sig(psk, "pair-ack", &data, ack)
}

pub fn parse_pub(hex: &str) -> Option<[u8; 32]> {
    sc::hex_decode(hex)?.try_into().ok()
}

// ─── Хранилище ключей ────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct StoredKey {
    pub kid: String,
    pub psk_hex: String,
    pub label: String,
    pub added_ms: i64,
}

impl StoredKey {
    pub fn new(psk: &Psk, label: &str) -> Self {
        StoredKey {
            kid: kid(psk),
            psk_hex: sc::hex_encode(psk.as_bytes()),
            label: label.to_string(),
            added_ms: sc::now_ms(),
        }
    }

    pub fn psk(&self) -> Option<Psk> {
        let bytes = sc::hex_decode(&self.psk_hex)?;
        let arr: [u8; 32] = bytes.try_into().ok()?;
        Some(Psk::from_bytes(arr))
    }
}

/// Добавляет ключ (без дублей по kid), ограничивает размер списка.
pub fn add_key(list: &mut Vec<StoredKey>, key: StoredKey) {
    list.retain(|k| k.kid != key.kid);
    list.push(key);
    while list.len() > MAX_KEYS {
        list.remove(0);
    }
}

pub struct KeyStore {
    path: PathBuf,
}

impl KeyStore {
    pub fn new(path: PathBuf) -> Self {
        KeyStore { path }
    }

    pub fn load(&self) -> Vec<StoredKey> {
        std::fs::read(&self.path)
            .ok()
            .and_then(|d| serde_json::from_slice::<Vec<StoredKey>>(&d).ok())
            .unwrap_or_default()
            .into_iter()
            .filter(|k| k.psk().is_some())
            .collect()
    }

    /// Атомарная запись: во временный файл, затем переименование.
    pub fn save(&self, keys: &[StoredKey]) -> std::io::Result<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(keys).map_err(std::io::Error::other)?)?;
        std::fs::rename(&tmp, &self.path)
    }
}

/// Ключ самой admin-panel: создаётся случайно при первом запуске и хранится в app data.
pub fn load_or_create_own_psk(path: &std::path::Path) -> Psk {
    #[derive(Serialize, Deserialize)]
    struct OwnKey {
        psk_hex: String,
    }
    if let Ok(data) = std::fs::read(path) {
        if let Ok(k) = serde_json::from_slice::<OwnKey>(&data) {
            if let Some(bytes) = sc::hex_decode(&k.psk_hex) {
                if let Ok(arr) = <[u8; 32]>::try_from(bytes) {
                    return Psk::from_bytes(arr);
                }
            }
        }
    }
    let psk = Psk::from_bytes(sc::random_bytes());
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let body = serde_json::to_vec_pretty(&OwnKey { psk_hex: sc::hex_encode(psk.as_bytes()) }).unwrap_or_default();
    if let Err(e) = std::fs::write(path, body) {
        eprintln!("cannot persist admin pairing key: {}", e);
    }
    psk
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_roundtrip_delivers_the_admin_key() {
        let tv = PairKeypair::generate();
        let admin_psk = Psk::from_bytes(sc::random_bytes());
        let (admin_pub, blob) = seal_pairing(&tv.public, &admin_psk, "Кафедра 410").unwrap();
        let (got, label) = open_pairing(&tv, &admin_pub, &blob).unwrap();
        assert_eq!(got.as_bytes(), admin_psk.as_bytes());
        assert_eq!(label, "Кафедра 410");
        let ack = pair_ack(&got, &admin_pub, &tv.public);
        assert!(verify_pair_ack(&admin_psk, &admin_pub, &tv.public, &ack));
        assert!(!verify_pair_ack(&Psk::from_bytes([9; 32]), &admin_pub, &tv.public, &ack));
    }

    #[test]
    fn key_is_not_visible_on_the_wire() {
        let tv = PairKeypair::generate();
        let admin_psk = Psk::from_bytes(sc::random_bytes());
        let (admin_pub, blob) = seal_pairing(&tv.public, &admin_psk, "x").unwrap();
        let wire = [admin_pub.to_vec(), blob.clone()].concat();
        let hex = sc::hex_encode(admin_psk.as_bytes());
        assert!(!sc::hex_encode(&wire).contains(&hex));
        assert!(!wire.windows(32).any(|w| w == admin_psk.as_bytes()));
    }

    #[test]
    fn passive_eavesdropper_and_tampering_fail() {
        let tv = PairKeypair::generate();
        let other_tv = PairKeypair::generate();
        let (admin_pub, blob) = seal_pairing(&tv.public, &Psk::from_bytes([1; 32]), "x").unwrap();
        // другой TV / подслушивающий без секретного ключа TV
        assert_eq!(open_pairing(&other_tv, &admin_pub, &blob).unwrap_err(), PairError::Decrypt);
        // порча любого байта
        for i in 0..blob.len() {
            let mut bad = blob.clone();
            bad[i] ^= 1;
            assert!(open_pairing(&tv, &admin_pub, &bad).is_err());
        }
        // подмена admin_pub
        let mut fake = admin_pub;
        fake[0] ^= 1;
        assert!(open_pairing(&tv, &fake, &blob).is_err());
        // короткий blob
        assert_eq!(open_pairing(&tv, &admin_pub, &[0; 5]).unwrap_err(), PairError::BadFormat);
    }

    #[test]
    fn low_order_points_are_rejected() {
        let tv = PairKeypair::generate();
        assert_eq!(open_pairing(&tv, &[0u8; 32], &[0u8; 40]).unwrap_err(), PairError::LowOrderPoint);
        assert!(seal_pairing(&[0u8; 32], &Psk::from_bytes([1; 32]), "x").is_err());
    }

    #[test]
    fn kid_matches_the_js_client_vector() {
        // тот же PSK и значение, что в admin-panel/lib/secure-channel.test.ts
        let psk = Psk::from_bytes(sc::hex_decode("cbacbdfdbaf3fa14a25dcd2047778f7d4be877ee384e743f1beb732e5331e310").unwrap().try_into().unwrap());
        assert_eq!(kid(&psk), "c982db98");
    }

    #[test]
    fn kid_is_stable_and_short() {
        let p = Psk::from_bytes([5; 32]);
        assert_eq!(kid(&p), kid(&p));
        assert_eq!(kid(&p).len(), 8);
        assert_ne!(kid(&p), kid(&Psk::from_bytes([6; 32])));
    }

    #[test]
    fn keystore_persists_dedups_and_caps() {
        let dir = std::env::temp_dir().join(format!("tt-ks-{}", sc::random_hex(4)));
        let store = KeyStore::new(dir.join("pairing.json"));
        assert!(store.load().is_empty());
        let mut list = vec![];
        for i in 0..(MAX_KEYS + 3) {
            add_key(&mut list, StoredKey::new(&Psk::from_bytes([i as u8 + 1; 32]), "k"));
        }
        assert_eq!(list.len(), MAX_KEYS);
        // повторное добавление не плодит дубликаты
        let last = list.last().unwrap().clone();
        add_key(&mut list, last.clone());
        assert_eq!(list.len(), MAX_KEYS);
        store.save(&list).unwrap();
        assert_eq!(store.load(), list);
        // битый файл → пустой список, без паники
        std::fs::write(dir.join("pairing.json"), b"{broken").unwrap();
        assert!(store.load().is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn own_key_is_created_once_and_reused() {
        let dir = std::env::temp_dir().join(format!("tt-own-{}", sc::random_hex(4)));
        let path = dir.join("admin-psk.json");
        let a = load_or_create_own_psk(&path);
        let b = load_or_create_own_psk(&path);
        assert_eq!(a.as_bytes(), b.as_bytes());
        let _ = std::fs::remove_dir_all(dir);
    }
}
