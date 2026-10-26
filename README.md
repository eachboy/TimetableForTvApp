# Timetable for TV

Система электронного расписания для информационных экранов (ТВ) в учебном заведении: на телевизоре показывается актуальное расписание занятий, новости и медиа, а сотрудники управляют всем содержимым из отдельного приложения — **панели управления** — с любого компьютера в той же локальной сети.

Всё работает **без интернета и без внешнего сервера**: ТВ-приложение само содержит API и базу данных, панель находит его в сети автоматически, а обновления ТВ раздаются прямо с компьютера администратора.

[![CI](https://github.com/eachboy/TimetableForTvApp/actions/workflows/ci-feature.yml/badge.svg)](https://github.com/eachboy/TimetableForTvApp/actions/workflows/ci-feature.yml)
[![Release](https://img.shields.io/github/v/release/eachboy/TimetableForTvApp)](https://github.com/eachboy/TimetableForTvApp/releases/latest)

---

## Содержание

- [Возможности](#возможности)
- [Как это устроено](#как-это-устроено)
- [Структура репозитория](#структура-репозитория)
- [Технологии](#технологии)
- [Быстрый старт для разработчика](#быстрый-старт-для-разработчика)
- [Конфигурация](#конфигурация)
- [Сеть, порты и обнаружение](#сеть-порты-и-обнаружение)
- [Безопасность](#безопасность)
- [База данных](#база-данных)
- [Автообновление ТВ](#автообновление-тв)
- [Тесты](#тесты)
- [Сборка](#сборка)
- [Релизы и версионирование](#релизы-и-версионирование)
- [CI/CD](#cicd)
- [Ветки и процесс работы](#ветки-и-процесс-работы)
- [Решение проблем](#решение-проблем)
- [Лицензии третьих сторон](#лицензии-третьих-сторон)
- [Лицензия проекта](#лицензия-проекта)

---

## Возможности

### ТВ-приложение (`frontend`)

- Полноэкранное расписание занятий на неделю с подсветкой **текущей пары** и тёмной темой, рассчитанной на большой экран.
- Новости и медиа (изображения/видео) в ротации на экране.
- Погода (данные приходят из панели управления, подпись проверяется).
- **Встроенный HTTP API** на Rust (axum) + **SQLite** — отдельный бэкенд не нужен.
- Автозапуск вместе с системой, запуск в полноэкранном режиме без рамки окна.
- Автообновление из панели управления по локальной сети.
- Пасхалка: если на расписании удерживать пульт ← + → около 8 секунд, открываются мини-игры (DOOM, Drift); выход — удержание ← + → 3 секунды (см. `frontend/app/games`, `secret-games-activator.tsx`).

### Панель управления (`admin-panel`)

- Вход по учётным записям, управление аккаунтами.
- Редактор расписания (в том числе drag-and-drop), преподаватели, аудитории, новости, медиа.
- Дашборд: системные метрики ТВ, свободные аудитории, активные занятия, уведомления.
- Экспорт/импорт базы данных.
- Раздел **«Обновления»**: проверка новых релизов на GitHub, загрузка установщиков и раздача их ТВ по сети.
- Автоматический поиск ТВ в сети (mDNS + сканирование подсети) и автоматическое **сопряжение** без ввода кодов.

---

## Как это устроено

1. **ТВ-приложение** — Tauri-оболочка над статически экспортированным Next.js. Внутри процесса поднимается API на порту `8000` и хранится SQLite-база в каталоге данных приложения. Анонсирует себя по mDNS как `timetable-tv.local`.
2. **Панель управления** — Tauri-приложение для ПК администратора. Находит ТВ в сети, общается с ним по защищённому каналу и одновременно поднимает **update-сервер** на порту `9000` (`timetable-admin.local`).
3. **Обновления** — панель скачивает релиз с GitHub, собирает `latest.json` в формате Tauri Updater и раздаёт его ТВ. ТВ проверяет подпись релиза встроенным публичным ключом.
4. **`shared/`** — Rust-модули, общие для обоих приложений (`secure_channel.rs`, `pairing.rs`, `firewall.rs`); подключаются через `#[path]`, поэтому изменять их нужно **в одном месте**.

---

## Структура репозитория

```text
.
├── frontend/                 # ТВ-приложение
│   ├── app/                  # Next.js App Router (расписание, игры)
│   ├── components/           # UI-компоненты (schedule-*, week-schedule-table, games/…)
│   ├── lib/                  # клиент API, движок DOOM, drift и тесты
│   ├── public/doom/          # DOOM (WASM + shareware WAD), офлайн
│   └── src-tauri/            # Rust: API-сервер, БД (rusqlite), mDNS, secure_api, updater
│       ├── src/api_server.rs # HTTP API (полный аналог прежнего Python-бэкенда)
│       ├── src/db.rs         # схема и запросы SQLite
│       ├── src/bin/          # api_server_main.rs — API как отдельная утилита (api-server)
│       └── timetable.db      # чистая seed-БД (схема + аккаунт admin), копируется в каталог данных при первом запуске
├── admin-panel/              # Панель управления
│   ├── app/                  # страницы: dashboard, schedule, teachers, rooms, news, media, accounts, database, updates
│   ├── components/, hooks/, lib/  # UI, клиентская часть secure-channel
│   └── src-tauri/            # Rust: update-сервер, mDNS, tv_link (связь с ТВ), github.rs
├── shared/                   # Rust-код, общий для обоих приложений
├── scripts/
│   ├── bump-version.mjs      # единое повышение версии (package.json, tauri.conf.json, Cargo.toml/lock)
│   ├── check-versions.mjs    # проверка согласованности версий (используется в CD)
│   └── make-seed-db.py       # чистая seed-БД из рабочей
├── .github/                  # workflows, шаблоны issue/PR, dependabot, release-drafter
└── README.md
```

> Корневые `package.json`/`package-lock.json` нужны только для локального MCP-сервера shadcn и в репозиторий не попадают (см. `.gitignore`).

---

## Технологии

| Слой | Стек |
| --- | --- |
| UI | Next.js 16 (static export, `output: 'export'`), React 19, Tailwind CSS 4, shadcn/ui, Radix, Recharts, dnd-kit |
| Десктоп | Tauri 2 (плагины: updater, autostart, shell, log) |
| Бэкенд ТВ | Rust, axum 0.7, tokio, rusqlite (bundled SQLite), bcrypt, jsonwebtoken |
| Сеть | mdns-sd, tiny_http (update-сервер) |
| Криптография | AES-256-GCM, HKDF-SHA256, HMAC-SHA256, X25519 (RustCrypto, `x25519-dalek`) |
| Тесты | Vitest + jsdom (UI), `cargo test` (Rust) |
| CI/CD | GitHub Actions, release-drafter, dependabot |

---

## Быстрый старт для разработчика

### Требования

- **Node.js 22** и npm
- **Rust** stable (≥ 1.77.2) — https://rustup.rs
- **Windows**: Microsoft C++ Build Tools и WebView2 (на Windows 11 уже установлен)
- **Linux**: пакеты Tauri:
  ```bash
  sudo apt-get install -y pkg-config libglib2.0-dev libwebkit2gtk-4.1-dev \
    libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev libssl-dev
  ```

### Запуск ТВ-приложения

```bash
cd frontend
npm ci
npm run tauri dev          # Next.js на :3001 + окно Tauri + API на :8000
```

Только веб-часть (без Tauri): `npm run dev` (порт 3001).

### Запуск панели управления

```bash
cd admin-panel
npm ci
npm run tauri dev          # Next.js на :3000 + окно Tauri
```

Для разработки на одной машине запустите **оба** приложения: панель найдёт ТВ по `127.0.0.1:8000` и сопряжётся с ним автоматически.

### API ТВ как отдельная утилита

```bash
cd frontend/src-tauri
DB_PATH=./timetable.db MEDIA_DIR=./media cargo run --bin api-server
```

(PowerShell: `$env:DB_PATH="./timetable.db"; $env:MEDIA_DIR="./media"; cargo run --bin api-server`)

---

## Конфигурация

### Переменные окружения Next.js (`admin-panel/.env`)

Скопируйте `admin-panel/.env.example` в `admin-panel/.env`:

| Переменная | Назначение |
| --- | --- |
| `NEXT_PUBLIC_APP_NAME` | Название приложения |
| `NEXT_PUBLIC_API_URL` | *Необязательно.* Адрес ТВ, который проверяется первым. Если там ТВ не найден — панель ищет его по сети сама |

### Переменные окружения Rust (опционально)

| Переменная | Где | Назначение |
| --- | --- | --- |
| `TIMETABLE_API_URL` / `TIMETABLE_FRONTEND_API_URL` | admin-panel | Принудительный адрес API ТВ |
| `TIMETABLE_PREFERRED_SUBNET` | оба | Предпочтительная подсеть для mDNS/анонсов (если у ПК несколько сетевых адаптеров) |
| `TIMETABLE_UPDATE_SERVER_IP` | оба | Принудительный IP update-сервера |
| `TIMETABLE_UPDATE_SERVER_URL` | admin-panel | Публичный URL update-сервера целиком |
| `TIMETABLE_API_PORT` | frontend | Порт API ТВ (по умолчанию `8000`) |
| `TIMETABLE_API_MDNS_IP` | frontend | IP, который ТВ анонсирует по mDNS |
| `TIMETABLE_PSK` | оба | Задать общий ключ канала вручную (вместо автосопряжения) |
| `TIMETABLE_ALLOW_PLAIN` | frontend | `1` — разрешить незашифрованные запросы (**только для отладки**) |
| `TIMETABLE_JWT_SECRET` | frontend | Секрет JWT (≥ 16 символов); если не задан — генерируется и сохраняется в `jwt.secret` в каталоге данных |
| `TZ_OFFSET_HOURS` | frontend | Смещение часового пояса для «текущей пары» (по умолчанию UTC+3) |
| `DB_PATH`, `MEDIA_DIR` | `api-server` | Пути к БД и медиа для отдельной утилиты |

---

## Сеть, порты и обнаружение

| Порт | Протокол | Кто слушает | Зачем |
| --- | --- | --- | --- |
| `8000` | TCP | ТВ | API |
| `9000` | TCP | Панель | update-сервер (`latest.json`, установщики, подписанный `weather.json`) |
| `5353` | UDP | оба | mDNS |

На Windows приложения при запуске проверяют правила брандмауэра и **запрашивают разрешение (UAC)** на их добавление. Отказ не ломает работу — запрос повторится при следующем запуске. Правила нужны, чтобы другой компьютер в сети достучался до ТВ/панели.

Обнаружение: mDNS-сервисы `_timetable-api._tcp.local.` (`timetable-tv.local`) и `timetable-admin.local`; если mDNS заблокирован — панель сканирует подсеть и проверяет подлинность найденного ТВ через `hello` (HMAC).

---

## Безопасность

- **Защищённый канал `tt-sc1`** между панелью и ТВ: каждый запрос шифруется AES-256-GCM, ключ выводится через HKDF-SHA256 из общего секрета (PSK) и случайной соли запроса; ответ привязан к id запроса; сервер отвергает запросы со смещением времени > ±5 минут и повторы (replay-защита). Подробности — `shared/secure_channel.rs`.
- **Автосопряжение** (`shared/pairing.rs`): у каждой панели при первом запуске создаётся собственный PSK, который передаётся ТВ зашифрованным по X25519, пока ТВ «открыт для сопряжения». TV хранит до 8 ключей панелей. **Не защищено** от активного MITM строго в момент первого сопряжения — открывайте окно сопряжения только когда это нужно и только в доверенной сети.
- **Аккаунты**: пароли хранятся как bcrypt-хэши; доступ к API по JWT.
- **Обновления** подписаны ключом minisign (Tauri signer); публичный ключ зашит в `frontend/src-tauri/tauri.conf.json`. Транспорт обновления — HTTP внутри LAN (`dangerousInsecureTransportProtocol`), целостность обеспечивает подпись.
- Приватные ключи, `env/`, `pairing.json`, `*.key` **никогда не коммитятся** (см. `.gitignore`).

---

## База данных

- Схема создаётся автоматически (`CREATE TABLE IF NOT EXISTS` в `frontend/src-tauri/src/db.rs`): `teachers`, `news`, `media`, `rooms`, `schedule_items`, `notifications`, `system_metrics`, `accounts`, `schema_version`.
- При первом запуске ТВ копирует seed-БД `timetable.db` (ресурс сборки) в каталог данных приложения; дальше используется копия там. Seed нужен, чтобы в системе существовала хотя бы одна учётная запись для входа.
- Экспорт базы — раздел «База данных» в панели (`/api/database/export`).

> **Seed-БД в репозитории — чистая**: только схема и один аккаунт `admin` / `admin`. **Смените пароль сразу после первого входа** (раздел «Аккаунты»). Реальные данные в git не коммитятся: `*.db` в `frontend/src-tauri/.gitignore` защищает от случайного добавления новых баз, а сам seed отслеживается принудительно.
>
> Пересоздать чистый seed из любой рабочей БД (нужен `pip install bcrypt`):
> ```bash
> python scripts/make-seed-db.py путь/к/рабочей.db frontend/src-tauri/timetable.db [логин] [пароль]
> ```

---

## Автообновление ТВ

1. CI собирает ТВ-приложение и подписывает `*.msi` (Windows) и `*.AppImage` (Linux), создавая рядом `*.sig`.
2. Администратор в разделе **«Обновления»** панели проверяет GitHub Releases, скачивает `*.msi`/`*.AppImage` и их `.sig`.
3. Панель формирует `latest.json` (Tauri Updater v2) и раздаёт его на `http://timetable-admin.local:9000/latest.json`.
4. ТВ проверяет этот адрес, скачивает установщик, сверяет подпись публичным ключом и устанавливает (`installMode: passive`).

Чтобы обновление было замечено, **версия в `tauri.conf.json` должна быть выше** установленной — поэтому версию всегда повышают скриптом (см. ниже).

---

## Тесты

```bash
# UI-логика (Vitest)
cd frontend    && npm test
cd admin-panel && npm test

# Rust (API, secure-channel, pairing, update-сервер)
cd frontend/src-tauri    && cargo test
cd admin-panel/src-tauri && cargo test

# Линт и типы
npm run lint && npx tsc --noEmit
```

> `cargo test`/`cargo check` требуют, чтобы существовала директория `out/` (результат `npm run build`) — этого требует `tauri::generate_context!`. В CI сборка Next.js выполняется до проверки Rust.

Нагрузочный тест (k6): `npm run test:load` в соответствующем приложении.

---

## Сборка

```bash
cd frontend    && npm run tauri build   # установщики в frontend/src-tauri/target/release/bundle
cd admin-panel && npm run tauri build   # установщики в admin-panel/src-tauri/target/release/bundle
```

Сборка ТВ-приложения подписывает артефакты обновления, поэтому нужны переменные:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content env/frontend/frontend.key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<пароль ключа>"
```

Результат: `*.msi`, `*.exe` (NSIS) для Windows; `*.deb`, `*.AppImage` для Linux.

### Генерация ключа подписи (один раз)

```bash
cd frontend
npx tauri signer generate -w ../env/frontend/frontend.key
```

Публичный ключ (`.key.pub`) вставьте в `plugins.updater.pubkey` в `frontend/src-tauri/tauri.conf.json`. **Приватный ключ и пароль не коммитьте** — они хранятся в GitHub Secrets (см. ниже).

---

## Релизы и версионирование

Версия приложения хранится в четырёх местах каждого приложения: `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` (+ запись пакета в `Cargo.lock`). Менять их вручную нельзя:

```bash
node scripts/bump-version.mjs                     # patch для обоих приложений: 1.3.3 -> 1.3.4
node scripts/bump-version.mjs minor frontend      # только ТВ
node scripts/bump-version.mjs 1.5.0 admin-panel   # точная версия
node scripts/check-versions.mjs frontend          # проверить согласованность
```

**Тег релиза берётся из `frontend/package.json`** (`v<версия>`). Если релиз с таким тегом уже есть, CD его пропустит — для нового релиза версию нужно повысить.

### GitHub Secrets (Settings → Secrets and variables → Actions)

| Secret | Содержимое |
| --- | --- |
| `FRONTEND_TAURI_PRIVATE_KEY` | Приватный ключ подписи ТВ (содержимое `frontend.key`) |
| `FRONTEND_TAURI_KEY_PASSWORD` | Пароль к этому ключу |
| `ADMIN_TAURI_PRIVATE_KEY`, `ADMIN_TAURI_KEY_PASSWORD` | *Необязательно.* Панель сама себя по сети не обновляет |

---

## CI/CD

| Workflow | Триггер | Что делает |
| --- | --- | --- |
| `ci-feature.yml` | push в `feature/**`, `fix/**`, `develop`; PR в `develop`/`main` | Для обоих приложений: `tsc`, `eslint`, Vitest, `next build`, `cargo check --locked`, `cargo test --locked` |
| `pr-build-summary.yml` | завершение CI для PR | Комментарий в PR с результатом и артефактами |
| `cd-main.yml` | push в `main` (изменения в `frontend/`, `admin-panel/`, `shared/`) или ручной запуск | Проверка версий → сборка Tauri (Windows + Linux) → публикация GitHub Release с установщиками и `.sig` |
| `release-drafter.yml` | push в `main` | Ведёт черновик заметок релиза по меткам PR; CD подставляет их в релиз |
| `dependabot.yml` | еженедельно | PR с обновлениями npm, cargo и GitHub Actions |

В релиз попадают:

- **Frontend (ТВ)**: `*.msi`, `*.msi.sig`, `*.exe`, `*.deb`, `*.AppImage`, `*.AppImage.sig`
- **Admin Panel**: только `*.exe` и `*.deb`. Её `*.msi`/`*.AppImage` намеренно не публикуются: update-сервер панели берёт *первый* найденный `*.msi`/`*.AppImage` и перепутал бы его с установщиком ТВ.

---

## Ветки и процесс работы

- `main` — стабильная ветка; каждый push с новой версией выпускает релиз.
- `develop` — интеграционная ветка; PR сюда запускают CI.
- `feature/*`, `fix/*` — рабочие ветки от `develop`.

Типовой цикл: ветка от `develop` → PR в `develop` (CI зелёный) → PR `develop` → `main` с повышением версии (`bump-version`) → автоматический релиз. Метки PR (`feature`, `fix`, `breaking-change`, …) определяют разделы заметок релиза. Шаблоны issue и PR лежат в `.github/`.

---

## Решение проблем

| Симптом | Что проверить |
| --- | --- |
| Панель не находит ТВ | Оба ПК в одной подсети? Разрешены ли порты `8000/9000` и UDP `5353` в брандмауэре? Задайте `TIMETABLE_API_URL` или `NEXT_PUBLIC_API_URL` |
| У ПК несколько сетевых адаптеров (VPN, Hyper-V) | Укажите `TIMETABLE_PREFERRED_SUBNET` |
| ТВ не видит обновление | Версия в `tauri.conf.json` выше установленной? В релизе есть `.sig`? ТВ достаёт `timetable-admin.local:9000`? |
| Сборка Tauri падает: `frontendDist ... doesn't exist` | Сначала `npm run build` (создаёт `out/`) |
| Сборка падает на подписи | Не заданы `TAURI_SIGNING_PRIVATE_KEY` / `..._PASSWORD` |
| `cargo ... --locked` падает в CI | `Cargo.lock` не обновлён — запустите `cargo metadata` в `src-tauri` и закоммитьте lock |
| CD пишет «Релиз уже существует» | Повысьте версию: `node scripts/bump-version.mjs` |

---

## Лицензии третьих сторон

- `frontend/public/doom/` — движок doomgeneric в WebAssembly (проект pi-doom, GPL-2.0), исходный код DOOM принадлежит id Software (GPL-2.0). `doom1.wad` — shareware-версия 1.9 (эпизод 1), разрешённая id Software к свободному распространению.
- Остальные зависимости — под собственными лицензиями (см. `package.json` и `Cargo.toml`).

## Лицензия проекта

© 2026 eachboy. Все права защищены (*All rights reserved*): код опубликован для ознакомления, его использование, копирование и распространение без письменного разрешения автора не допускаются. Подробности — в файле [`LICENSE`](LICENSE).
