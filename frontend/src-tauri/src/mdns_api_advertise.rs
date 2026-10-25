//! Регистрация mDNS `_timetable-api._tcp` — чтобы admin-panel находила API Timetable без сканирования подсети.

use mdns_sd::{ServiceDaemon, ServiceInfo};
use std::cmp::Reverse;
use std::net::{IpAddr, Ipv4Addr};

const SERVICE_TYPE: &str = "_timetable-api._tcp.local.";
const SERVICE_INSTANCE: &str = "tt-api";
pub const SERVICE_HOSTNAME: &str = "timetable-tv.local";
const DEFAULT_API_PORT: u16 = 8000;

pub struct MdnsTimetableApi {
    // Держим daemon живым — при дропе сервис снимается
    _daemon: ServiceDaemon,
}

impl MdnsTimetableApi {
    /// Регистрирует сервис API Timetable в локальной сети (Bonjour / mDNS).
    pub fn register() -> Result<Self, String> {
        let port = std::env::var("TIMETABLE_API_PORT")
            .ok()
            .and_then(|v| v.trim().parse::<u16>().ok())
            .unwrap_or(DEFAULT_API_PORT);

        let daemon =
            ServiceDaemon::new().map_err(|e| format!("mDNS daemon error (timetable-api): {}", e))?;

        let local_ip = preferred_ipv4_string().unwrap_or_else(|| "127.0.0.1".to_string());
        let advertised_hostname = normalize_mdns_hostname(SERVICE_HOSTNAME);
        let endpoint = format!("http://{}:{}", advertised_hostname, port);

        let properties = [
            ("version", "1"),
            ("proto", "tt-sc1"),
            ("app", "timetable-api"),
            ("hostname", advertised_hostname.as_str()),
            ("endpoint", endpoint.as_str()),
            ("ip", local_ip.as_str()),
        ];

        let service = ServiceInfo::new(
            SERVICE_TYPE,
            SERVICE_INSTANCE,
            &format!("{}.", advertised_hostname),
            local_ip.as_str(),
            port,
            &properties[..],
        )
        .map_err(|e| format!("ServiceInfo error (timetable-api): {}", e))?;

        daemon
            .register(service)
            .map_err(|e| format!("mDNS register error (timetable-api): {}", e))?;

        log::info!(
            "mDNS: registered timetable API {} on {}:{} as {} ({})",
            SERVICE_INSTANCE,
            local_ip,
            port,
            advertised_hostname,
            SERVICE_TYPE
        );

        Ok(Self { _daemon: daemon })
    }
}

fn preferred_ipv4_string() -> Option<String> {
    preferred_ipv4().map(|ip| ip.to_string())
}

fn preferred_ipv4() -> Option<Ipv4Addr> {
    if let Ok(raw) = std::env::var("TIMETABLE_API_MDNS_IP") {
        if let Ok(ip) = raw.trim().parse::<Ipv4Addr>() {
            log::info!("Using TIMETABLE_API_MDNS_IP for timetable-api mDNS: {}", ip);
            return Some(ip);
        }
    }

    if let Ok(raw) = std::env::var("TIMETABLE_UPDATE_SERVER_IP") {
        if let Ok(ip) = raw.trim().parse::<Ipv4Addr>() {
            log::info!(
                "Using TIMETABLE_UPDATE_SERVER_IP for timetable-api mDNS (shared): {}",
                ip
            );
            return Some(ip);
        }
    }

    let preferred_prefix = preferred_subnet_prefix();
    let mut ips: Vec<Ipv4Addr> = local_ip_address::list_afinet_netifas()
        .ok()?
        .into_iter()
        .filter_map(|(_, ip)| match ip {
            IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_link_local() => Some(ip),
            _ => None,
        })
        .collect();

    ips.sort_by_key(|ip| Reverse(ipv4_priority(*ip, preferred_prefix.as_deref())));
    ips.into_iter().next()
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

fn normalize_mdns_hostname(hostname: &str) -> String {
    let trimmed = hostname.trim().trim_end_matches('.');
    if trimmed.ends_with(".local") {
        trimmed.to_string()
    } else {
        format!("{}.local", trimmed)
    }
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
