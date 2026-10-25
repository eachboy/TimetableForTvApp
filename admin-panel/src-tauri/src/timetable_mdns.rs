//! Поиск Timetable REST API в LAN через mDNS (`_timetable-api._tcp`).

use mdns_sd::{ServiceDaemon, ServiceEvent};
use std::cmp::Reverse;
use std::collections::HashSet;
use std::net::Ipv4Addr;
use std::time::Duration;

const SERVICE_TYPE: &str = "_timetable-api._tcp.local.";
const STABLE_HOSTNAMES: [&str; 2] = ["timetable-tv.local", "timetable-api.local"];

/// Ищет базовый URL API (например `http://192.168.1.10:8000`).
pub fn browse_timetable_api_blocking(timeout_secs: u64) -> Option<String> {
    for hostname in STABLE_HOSTNAMES {
        let url = format!("http://{}:8000", hostname);
        if probe_timetable_health_blocking(&url) {
            log::info!("Resolved timetable API via stable hostname: {}", url);
            return Some(url);
        }
    }

    log::info!(
        "mDNS browse started for {} (timeout {}s)",
        SERVICE_TYPE,
        timeout_secs
    );

    let daemon = ServiceDaemon::new().ok()?;
    let receiver = daemon.browse(SERVICE_TYPE).ok()?;

    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs.max(5));

    loop {
        if std::time::Instant::now() > deadline {
            break;
        }

        match receiver.recv_timeout(Duration::from_millis(200)) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                log::info!(
                    "mDNS (timetable-api) resolved: fullname={}, hostname={}, addresses_v4={:?}, port={}",
                    info.get_fullname(),
                    info.get_hostname(),
                    info.get_addresses_v4(),
                    info.get_port()
                );
                let candidates = mdns_candidate_urls(&info);
                for url in candidates {
                    if probe_timetable_health_blocking(&url) {
                        log::info!("mDNS timetable-api: {} → {}", info.get_fullname(), url);
                        let _ = daemon.stop_browse(SERVICE_TYPE);
                        return Some(url);
                    }
                }
            }
            Ok(ServiceEvent::SearchStarted(_)) => {
                log::debug!("mDNS SearchStarted for {}", SERVICE_TYPE);
            }
            Ok(ev) => {
                log::debug!("mDNS (timetable-api) event: {:?}", ev);
            }
            Err(_) => {
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    }

    let _ = daemon.stop_browse(SERVICE_TYPE);
    None
}

/// Проверяет, что по адресу настоящий TV с нашим ключом (а не просто «кто-то на :8000»).
fn probe_timetable_health_blocking(base_url: &str) -> bool {
    crate::tv_link::candidate_blocking(base_url)
}

fn mdns_candidate_urls(info: &mdns_sd::ServiceInfo) -> Vec<String> {
    let mut urls = Vec::new();
    let mut seen = HashSet::new();
    let port = info.get_port();

    if let Some(endpoint) = info.get_property_val_str("endpoint") {
        let normalized = endpoint.trim().trim_end_matches('/').to_string();
        if !normalized.is_empty() && seen.insert(normalized.clone()) {
            urls.push(normalized);
        }
    }

    let hostname = info.get_hostname().trim().trim_end_matches('.');
    if !hostname.is_empty() {
        let url = format!("http://{}:{}", hostname, port);
        if seen.insert(url.clone()) {
            urls.push(url);
        }
    }

    if let Some(hostname) = info.get_property_val_str("hostname") {
        let hostname = hostname.trim().trim_end_matches('.');
        if !hostname.is_empty() {
            let url = format!("http://{}:{}", hostname, port);
            if seen.insert(url.clone()) {
                urls.push(url);
            }
        }
    }

    for ip in preferred_ipv4_order(info.get_addresses_v4()) {
        let url = format!("http://{}:{}", ip, port);
        if seen.insert(url.clone()) {
            urls.push(url);
        }
    }

    urls
}

fn preferred_ipv4_order(addresses: HashSet<&Ipv4Addr>) -> Vec<Ipv4Addr> {
    let preferred_prefix = preferred_subnet_prefix();
    let mut ips: Vec<Ipv4Addr> = addresses.into_iter().copied().collect();
    ips.sort_by_key(|ip| Reverse(ipv4_priority(*ip, preferred_prefix.as_deref())));
    ips
}

fn preferred_subnet_prefix() -> Option<String> {
    std::env::var("TIMETABLE_PREFERRED_SUBNET")
        .ok()
        .and_then(|value| {
            let prefix = value.trim().trim_end_matches('.').to_string();
            if prefix.split('.').count() == 3 {
                Some(prefix)
            } else {
                None
            }
        })
}

fn ipv4_priority(ip: Ipv4Addr, preferred_prefix: Option<&str>) -> i32 {
    let ip_str = ip.to_string();

    if preferred_prefix
        .map(|prefix| ip_str.starts_with(&format!("{}.", prefix)))
        .unwrap_or(false)
    {
        return 100;
    }

    let octets = ip.octets();
    if octets[0] == 172 && (16..=31).contains(&octets[1]) {
        30
    } else if octets[0] == 192 && octets[1] == 168 {
        20
    } else if octets[0] == 10 {
        10
    } else {
        0
    }
}
