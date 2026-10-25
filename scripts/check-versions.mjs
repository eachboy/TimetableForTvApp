// Проверяет, что версия приложения одинакова в package.json, tauri.conf.json и Cargo.toml.
// Автообновление Tauri сравнивает версию из tauri.conf.json, а тег релиза берётся из package.json —
// расхождение даёт релиз, который TV не увидит как новый.
//   node scripts/check-versions.mjs frontend
//   node scripts/check-versions.mjs admin-panel
// (запускается в CD перед сборкой; исправляется командой node scripts/bump-version.mjs)
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? '.');
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
const conf = JSON.parse(fs.readFileSync(path.join(dir, 'src-tauri/tauri.conf.json'), 'utf8')).version;
const cargo = fs.readFileSync(path.join(dir, 'src-tauri/Cargo.toml'), 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1];

if (pkg !== conf || pkg !== cargo) {
  console.error(
    `Версии не совпадают: package.json=${pkg}, tauri.conf.json=${conf}, Cargo.toml=${cargo}.\n` +
      'Исправьте командой: node scripts/bump-version.mjs <версия> [frontend|admin-panel|all]',
  );
  process.exit(1);
}
console.log(`${path.basename(dir)}: версия ${pkg} согласована`);
