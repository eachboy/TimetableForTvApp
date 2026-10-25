use mdns_sd::{ServiceDaemon, ServiceInfo};
use std::cmp::Reverse;
use std::net::{IpAddr, Ipv4Addr};

const SERVICE_TYPE: &str = "_timetable-update._tcp.local.";
// Имя инстанса mDNS должно быть <= 15 байт.
// "timetable-admin" гранично длинное и даёт warning в mdns_sd::service_daemon.
// Укоротим до "tt-admin", чтобы убрать ошибку длины имени.
const SERVICE_INSTANCE: &str = "tt-admin";
pub const SERVICE_HOSTNAME: &str = "timetable-admin.local";

pub struct MdnsService {
    // Держим daemon живым — при дропе сервис снимается
    _daemon: ServiceDaemon,
}

impl MdnsService {
    /// Регистрирует mDNS сервис и держит его активным
    pub fn register(hostname: &str, port: u16) -> Result<Self, String> {
        let daemon = ServiceDaemon::new()
            .map_err(|e| format!("mDNS daemon error: {}", e))?;

        // Получаем локальный IP автоматически через mdns-sd
        let local_ip = preferred_ipv4_string().unwrap_or_else(|| "127.0.0.1".to_string());
        let advertised_hostname = normalize_mdns_hostname(hostname);
        let endpoint = format!("http://{}:{}", advertised_hostname, port);

        // Дополнительные TXT записи — Frontend может читать метаданные
        let properties = [
            ("version", "1"),
            ("app", "timetable"),
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
        .map_err(|e| format!("ServiceInfo error: {}", e))?;

        daemon
            .register(service)
            .map_err(|e| format!("mDNS register error: {}", e))?;

        log::info!(
            "mDNS: registered {} on {}:{} as {} ({})",
            SERVICE_INSTANCE,
            local_ip,
            port,
            advertised_hostname,
            SERVICE_TYPE
        );

        Ok(Self { _daemon: daemon })
    }
}

pub(crate) fn preferred_ipv4_string() -> Option<String> {
    preferred_ipv4().map(|ip| ip.to_string())
}

fn preferred_ipv4() -> Option<Ipv4Addr> {
    if let Ok(raw) = std::env::var("TIMETABLE_UPDATE_SERVER_IP") {
        if let Ok(ip) = raw.trim().parse::<Ipv4Addr>() {
            log::info!("Using TIMETABLE_UPDATE_SERVER_IP for mDNS/update server: {}", ip);
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