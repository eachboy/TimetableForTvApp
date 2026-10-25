// Поднимает версию во всех файлах обоих приложений (package.json, package-lock.json,
// tauri.conf.json, Cargo.toml). Без этого автообновление Tauri не увидит новую версию.
//   node scripts/bump-version.mjs            -> patch (1.3.0 -> 1.3.1)
//   node scripts/bump-version.mjs minor      -> 1.3.0 -> 1.4.0
//   node scripts/bump-version.mjs major      -> 1.3.0 -> 2.0.0
//   node scripts/bump-version.mjs 1.5.2      -> точная версия
//   второй аргумент — приложение: frontend | admin-panel | all (по умолчанию all), например:
//   node scripts/bump-version.mjs patch frontend   -> меняется только TV
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[3] ?? 'all';
const apps = target === 'all' ? ['frontend', 'admin-panel'] : [target];
if (!apps.every((a) => ['frontend', 'admin-panel'].includes(a))) {
  console.error('Приложение: frontend | admin-panel | all');
  process.exit(1);
}
const arg = process.argv[2] ?? 'patch';

const current = JSON.parse(fs.readFileSync(path.join(root, apps[0], 'package.json'), 'utf8')).version;
const [maj, min, pat] = current.split('.').map(Number);
const next = /^\d+\.\d+\.\d+$/.test(arg)
  ? arg
  : arg === 'major' ? `${maj + 1}.0.0`
  : arg === 'minor' ? `${maj}.${min + 1}.0`
  : `${maj}.${min}.${pat + 1}`;

function editJson(file, fn) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(text);
  fn(data);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(file, JSON.stringify(data, null, 2).replace(/\n/g, eol) + (text.endsWith('\n') ? eol : ''));
}

for (const app of apps) {
  editJson(path.join(root, app, 'package.json'), (d) => { d.version = next; });
  editJson(path.join(root, app, 'package-lock.json'), (d) => {
    d.version = next;
    if (d.packages?.['']) d.packages[''].version = next;
  });
  editJson(path.join(root, app, 'src-tauri/tauri.conf.json'), (d) => { d.version = next; });
  const cargo = path.join(root, app, 'src-tauri/Cargo.toml');
  if (fs.existsSync(cargo)) {
    const t = fs.readFileSync(cargo, 'utf8');
    fs.writeFileSync(cargo, t.replace(/^version\s*=\s*"[^"]+"/m, `version = "${next}"`));
    // CI собирает с --locked, поэтому версия нашего пакета в Cargo.lock должна совпадать
    const lock = path.join(root, app, 'src-tauri/Cargo.lock');
    const pkgName = t.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    if (pkgName && fs.existsSync(lock)) {
      const l = fs.readFileSync(lock, 'utf8');
      const re = new RegExp(`(name = "${pkgName}"\\r?\\nversion = ")[^"]+(")`);
      fs.writeFileSync(lock, l.replace(re, `$1${next}$2`));
    }
  }
}
console.log(`${current} -> ${next}`);
