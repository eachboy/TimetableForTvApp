// src-tauri/src/mdns_discovery.rs  (Frontend)

use mdns_sd::{ServiceDaemon, ServiceEvent};
use std::time::Duration;
use tokio::time::timeout;

const SERVICE_TYPE: &str = "_timetable-update._tcp.local.";

pub async fn discover_update_server(timeout_secs: u64) -> Option<String> {
    let result = timeout(
        Duration::from_secs(timeout_secs),
        tokio::task::spawn_blocking(move || browse_for_service()),
    )
    .await;

    match result {
        Ok(Ok(Some(url))) => Some(url),
        Ok(Ok(None)) => {
            log::debug!("mDNS browse completed, no service found");
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

fn browse_for_service() -> Option<String> {
    let daemon = ServiceDaemon::new().ok()?;
    let receiver = daemon.browse(SERVICE_TYPE).ok()?;

    let deadline = std::time::Instant::now() + Duration::from_secs(4);

    loop {
        if std::time::Instant::now() > deadline {
            break;
        }

        match receiver.recv_timeout(Duration::from_millis(200)) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
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
                log::debug!("mDNS search started for {}", SERVICE_TYPE);
            }
            Ok(_) => {}
            Err(_) => {
                // Таймаут ожидания или временная ошибка — продолжаем цикл
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    }

    let _ = daemon.stop_browse(SERVICE_TYPE);
    None
}