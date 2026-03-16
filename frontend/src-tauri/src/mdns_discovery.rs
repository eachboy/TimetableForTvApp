// src-tauri/src/mdns_discovery.rs  (Frontend)

use mdns_sd::{ServiceDaemon, ServiceEvent};
use std::time::Duration;
use tokio::time::timeout;

const SERVICE_TYPE: &str = "_timetable-update._tcp.local.";

pub async fn discover_update_server(timeout_secs: u64) -> Option<String> {
    // Запускаем блокирующий browse в отдельном потоке и ограничиваем общее время ожидания.
    let browse_timeout = Duration::from_secs(timeout_secs.max(5)); // не меньше 5 секунд

    let result = timeout(
        browse_timeout,
        tokio::task::spawn_blocking(move || browse_for_service(timeout_secs)),
    )
    .await;

    match result {
        Ok(Ok(Some(url))) => Some(url),
        Ok(Ok(None)) => {
            log::debug!(
                "mDNS browse completed without resolving any service ({}s window)",
                timeout_secs
            );
            None
        }
        Ok(Err(e)) => {
            log::warn!("mDNS browse task failed: {}", e);
            None
        }
        Err(_) => {
            log::debug!("mDNS discovery timed out after {}s", timeout_secs);
            None
        }
    }
}

fn browse_for_service(timeout_secs: u64) -> Option<String> {
    log::info!(
        "mDNS browse started for {} with timeout {}s",
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
                    "mDNS ServiceResolved: fullname={}, addresses_v4={:?}, port={}",
                    info.get_fullname(),
                    info.get_addresses_v4(),
                    info.get_port()
                );
                let ip = info
                    .get_addresses_v4()
                    .into_iter()
                    .next()
                    .map(|addr| addr.to_string())?;

                let port = info.get_port();
                let url = format!("http://{}:{}", ip, port);

                log::info!("mDNS resolved: {} → {}", info.get_fullname(), url);

                let _ = daemon.stop_browse(SERVICE_TYPE);
                return Some(url);
            }
            Ok(ServiceEvent::SearchStarted(_)) => {
                log::debug!("mDNS SearchStarted event for {}", SERVICE_TYPE);
            }
            Ok(ev) => {
                log::debug!("mDNS event: {:?}", ev);
            }
            Err(_) => {
                // Таймаут ожидания или временная ошибка — продолжаем цикл
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    }

    let _ = daemon.stop_browse(SERVICE_TYPE);
    None
}