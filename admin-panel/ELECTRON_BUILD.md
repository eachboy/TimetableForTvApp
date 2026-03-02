# Сборка Admin Panel в EXE файл с помощью Electron

## Требования

- Node.js (версия 18 или выше)
- npm

## Установка зависимостей

```bash
npm install
```

## Разработка

Для запуска приложения в режиме разработки с Electron:

```bash
npm run electron:dev
```

Это запустит Next.js dev сервер и Electron приложение одновременно.

## Сборка EXE файла

Для сборки исполняемого файла выполните:

```bash
npm run electron:build
```

Это выполнит следующие шаги:
1. Очистка папки `dist` (если существует)
2. Сборка Next.js приложения (`npm run build`)
3. Компиляция TypeScript файлов Electron (`npm run electron:compile`)
4. Создание EXE файла с помощью electron-builder

Готовый установщик будет находиться в папке `dist-build/`.

**Примечание:** Если папка `dist` заблокирована, сборка будет создана в `dist-build/` для обхода проблемы.

### Устранение проблем при сборке

Если вы получаете ошибку о том, что файл `app.asar` заблокирован:

1. **Закройте все запущенные приложения Electron:**
   ```powershell
   Get-Process | Where-Object {$_.ProcessName -like "*electron*" -or $_.ProcessName -like "*Timetable*"} | Stop-Process -Force
   ```

2. **Переименуйте папку dist (если удаление не работает):**
   ```powershell
   $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
   Rename-Item -Path dist -NewName "dist_backup_$timestamp" -Force
   ```
   
   Это позволит electron-builder создать новую папку dist. Старую папку можно удалить позже вручную.

3. **Или удалите папку dist вручную (если возможно):**
   ```powershell
   Remove-Item -Path dist -Recurse -Force
   ```

4. **Запустите сборку снова:**
   ```bash
   npm run electron:build
   ```

**Примечание:** Скрипт очистки автоматически попытается переименовать папку dist, если её не удается удалить.

## Промежуточная сборка (без установщика)

Для создания папки с приложением без установщика:

```bash
npm run electron:pack
```

## Структура файлов

- `electron/main.ts` - главный процесс Electron
- `electron/preload.ts` - preload скрипт для безопасного взаимодействия
- `electron/tsconfig.json` - конфигурация TypeScript для Electron
- `package.json` - содержит конфигурацию electron-builder в секции `build`

## Конфигурация

Конфигурация сборки находится в `package.json` в секции `build`. Вы можете изменить:
- `appId` - идентификатор приложения
- `productName` - название приложения
- `win.target` - формат установщика (nsis, portable и т.д.)
- `nsis` - настройки установщика NSIS
