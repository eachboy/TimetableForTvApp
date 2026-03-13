use mdns_sd::{ServiceDaemon, ServiceInfo};

const SERVICE_TYPE: &str = "_timetable-update._tcp.local.";
const SERVICE_INSTANCE: &str = "timetable-admin";

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
        let local_ip = get_local_ip().unwrap_or_else(|| "127.0.0.1".to_string());

        // Дополнительные TXT записи — Frontend может читать метаданные
        let properties = [
            ("version", "1"),
            ("app", "timetable"),
        ];

        let service = ServiceInfo::new(
            SERVICE_TYPE,
            SERVICE_INSTANCE,
            &format!("{}.local.", hostname),
            local_ip.as_str(),
            port,
            &properties[..],
        )
        .map_err(|e| format!("ServiceInfo error: {}", e))?;

        daemon
            .register(service)
            .map_err(|e| format!("mDNS register error: {}", e))?;

        log::info!(
            "mDNS: registered {} on {}:{} ({})",
            SERVICE_INSTANCE,
            local_ip,
            port,
            SERVICE_TYPE
        );

        Ok(Self { _daemon: daemon })
    }
}

/// Получить первый не-loopback IPv4 адрес этой машины
fn get_local_ip() -> Option<String> {
    // mdns-sd умеет сам определять IP, но нам нужен он для логов
    // Используем простой UDP трюк: подключаемся к внешнему адресу
    // и смотрим какой локальный адрес выбрала ОС (соединение не устанавливается)
    use std::net::UdpSocket;
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
}