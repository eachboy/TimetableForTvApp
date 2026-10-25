//! Открытие портов в брандмауэре Windows с запросом разрешения (окно UAC).
//!
//! Без правила входящих подключений другой ПК в сети не достучится ни до TV (TCP 8000),
//! ни до админки (TCP 9000), а mDNS-поиск не получит ответы (UDP 5353).
//! Приложение проверяет правила при каждом запуске; если их нет — просит Windows
//! подтвердить добавление (UAC). Отказ не ломает приложение: повторим запрос при следующем запуске.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rule {
    pub name: &'static str,
    pub protocol: &'static str, // "TCP" | "UDP"
    pub port: u16,
}

/// Правила для TV (frontend).
pub const TV_RULES: [Rule; 2] = [
    Rule { name: "Timetable TV API (TCP 8000)", protocol: "TCP", port: 8000 },
    Rule { name: "Timetable mDNS (UDP 5353)", protocol: "UDP", port: 5353 },
];

/// Правила для админки.
pub const ADMIN_RULES: [Rule; 2] = [
    Rule { name: "Timetable Admin server (TCP 9000)", protocol: "TCP", port: 9000 },
    Rule { name: "Timetable mDNS (UDP 5353)", protocol: "UDP", port: 5353 },
];

#[derive(Debug, PartialEq, Eq)]
pub enum FirewallResult {
    /// Все правила уже есть.
    AlreadyOpen,
    /// Пользователь разрешил, правила добавлены.
    Granted,
    /// Пользователь отказал в окне UAC (или нет прав).
    Declined,
    /// Не Windows — ничего делать не нужно.
    NotApplicable,
    Failed(String),
}

/// Команда netsh для добавления входящего правила.
pub fn add_rule_command(rule: &Rule) -> String {
    format!(
        "netsh advfirewall firewall add rule name=\"{}\" dir=in action=allow protocol={} localport={} profile=any",
        rule.name, rule.protocol, rule.port
    )
}

/// Команды только для отсутствующих правил (`exists` — проверка по имени правила).
pub fn missing_commands(rules: &[Rule], exists: impl Fn(&str) -> bool) -> Vec<String> {
    rules.iter().filter(|r| !exists(r.name)).map(add_rule_command).collect()
}

/// Одна строка для `cmd /c` — все команды подряд.
pub fn join_for_cmd(commands: &[String]) -> String {
    commands.join(" & ")
}

#[cfg(windows)]
fn rule_exists(name: &str) -> bool {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("netsh")
        .args(["advfirewall", "firewall", "show", "rule", &format!("name={}", name)])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Проверяет правила и при необходимости просит разрешение у пользователя (окно UAC).
/// Блокирующая: вызывать из отдельного потока.
#[cfg(windows)]
pub fn ensure(rules: &[Rule]) -> FirewallResult {
    use std::os::windows::process::CommandExt;
    let commands = missing_commands(rules, rule_exists);
    if commands.is_empty() {
        return FirewallResult::AlreadyOpen;
    }
    log::info!("Firewall rules are missing, asking Windows for permission (UAC): {:?}", commands);

    // Start-Process -Verb RunAs показывает стандартное окно «Разрешить этому приложению вносить изменения?».
    let inner = join_for_cmd(&commands).replace('\'', "''");
    let script = format!(
        "$p = Start-Process -FilePath cmd.exe -ArgumentList '/c {}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode",
        inner
    );
    let status = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(0x0800_0000)
        .status();
    match status {
        Ok(s) if s.success() => {
            if missing_commands(rules, rule_exists).is_empty() {
                FirewallResult::Granted
            } else {
                FirewallResult::Failed("rules were not created".to_string())
            }
        }
        // Отмена в окне UAC → PowerShell завершается с ошибкой.
        Ok(_) => FirewallResult::Declined,
        Err(e) => FirewallResult::Failed(e.to_string()),
    }
}

#[cfg(not(windows))]
pub fn ensure(_rules: &[Rule]) -> FirewallResult {
    FirewallResult::NotApplicable
}

/// Запуск в фоне при старте приложения (не блокирует окно).
pub fn ensure_in_background(rules: &'static [Rule]) {
    std::thread::spawn(move || match ensure(rules) {
        FirewallResult::Declined => log::warn!(
            "Firewall permission was declined: other PCs in the LAN may not reach this app. \
             It will be requested again on the next launch."
        ),
        FirewallResult::Failed(e) => log::warn!("Cannot configure firewall: {}", e),
        FirewallResult::Granted => log::info!("Firewall rules added"),
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_is_well_formed() {
        assert_eq!(
            add_rule_command(&TV_RULES[0]),
            "netsh advfirewall firewall add rule name=\"Timetable TV API (TCP 8000)\" dir=in action=allow protocol=TCP localport=8000 profile=any"
        );
    }

    #[test]
    fn only_missing_rules_are_added() {
        let none = missing_commands(&TV_RULES, |_| false);
        assert_eq!(none.len(), 2);
        let one = missing_commands(&TV_RULES, |n| n.contains("TCP 8000"));
        assert_eq!(one.len(), 1);
        assert!(one[0].contains("UDP") && one[0].contains("5353"));
        assert!(missing_commands(&TV_RULES, |_| true).is_empty());
        assert_eq!(join_for_cmd(&none).matches(" & ").count(), 1);
    }

    #[test]
    fn ports_match_the_apps() {
        assert!(TV_RULES.iter().any(|r| r.protocol == "TCP" && r.port == 8000));
        assert!(ADMIN_RULES.iter().any(|r| r.protocol == "TCP" && r.port == 9000));
        assert!(TV_RULES.iter().chain(ADMIN_RULES.iter()).any(|r| r.protocol == "UDP" && r.port == 5353));
    }

    #[cfg(not(windows))]
    #[test]
    fn noop_off_windows() {
        assert_eq!(ensure(&TV_RULES), FirewallResult::NotApplicable);
    }
}
