# Ручной релиз

Перед созданием релиза убедитесь, что все тесты проходят и версия приложения обновлена во всех нужных местах.

## 1. Запуск тестов

Из корня репозитория (все тесты одной командой):

```bash
npm test
```

Отдельно:

```bash
npm run test:frontend   # frontend: Vitest + cargo test
npm run test:admin      # admin-panel: Vitest
```

## 2. Версия приложения

Версия должна быть одинаковой в:

- `frontend/package.json` — поле `version`
- `admin-panel/package.json` — поле `version`
- `frontend/src-tauri/Cargo.toml` — поле `version`
- `frontend/src-tauri/tauri.conf.json` — поле `version`
- `admin-panel/src-tauri/Cargo.toml` — поле `version`
- `admin-panel/src-tauri/tauri.conf.json` — поле `version`

При релизе обновите версию (например, с `1.1.1` на `1.2.0`) во всех перечисленных файлах.

## 3. Коммит и пуш

```bash
git add -A
git commit -m "Release v1.2.0"   # подставьте свою версию
git push origin main
```

## 4. Создание тега и релиз в Git

**Вариант A: тег по версии (рекомендуется)**

```bash
VERSION=1.1.0   # версия из package.json
git tag "v${VERSION}"
git push origin "v${VERSION}"
``` 

При push в `main` GitHub Actions (CD) соберёт приложения и создаст GitHub Release с тегом `v<VERSION>` и артефактами (exe, msi, deb, AppImage).

**Вариант B: ручной запуск CD**

В GitHub: **Actions → CD — Release (main) → Run workflow**. Укажите версию (например `1.2.0`) и при необходимости отметьте «Пре-релиз».

## Автоматический релиз при push в main

При push в `main` workflow **CD — Release (main)**:

1. Собирает Frontend и Admin Panel (Tauri) под Windows и Linux.
2. Читает версию из `frontend/package.json`.
3. Создаёт GitHub Release с тегом `v<version>` (например `v1.1.1`) и прикрепляет собранные артефакты.

При ручном запуске workflow можно переопределить версию через input.
