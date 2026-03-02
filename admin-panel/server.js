// Сервер для упакованного Next.js приложения
const { createServer } = require('http');
const { parse } = require('url');
const path = require('path');
const fs = require('fs');

const next = require('next');

// Определяем базовую директорию
// В упакованном exe __dirname указывает на snapshot
const isPkg = typeof process.pkg !== 'undefined';

let appDir;
if (isPkg) {
  // В pkg используем директорию где находится exe файл
  const exeDir = path.dirname(process.execPath);
  // Проверяем наличие папки admin-panel рядом с exe
  const adminPanelDir = path.join(exeDir, 'admin-panel');
  if (fs.existsSync(adminPanelDir)) {
    appDir = adminPanelDir;
  } else {
    // Если папки нет, используем директорию exe
    appDir = exeDir;
  }
} else {
  appDir = __dirname;
}

const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '3001', 10);

console.log('Starting Next.js app from directory:', appDir);
console.log('.next exists:', fs.existsSync(path.join(appDir, '.next')));

// Используем обычный режим Next.js
const app = next({ 
  dev: false, // Всегда production в exe
  hostname, 
  port,
  dir: appDir
});

const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  server.listen(port, hostname, (err) => {
    if (err) {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
    console.log(`> Ready on http://${hostname}:${port}`);
  });
}).catch((err) => {
  console.error('Failed to prepare Next.js app:', err);
  console.error('App directory:', appDir);
  process.exit(1);
});
