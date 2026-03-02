import { app, BrowserWindow, Menu } from 'electron';
import { createServer } from 'http';
import { parse } from 'url';
import * as path from 'path';
import * as fs from 'fs';
import next from 'next';

let mainWindow: BrowserWindow | null = null;
let server: any = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const port = parseInt(process.env.PORT || '3001', 10);
const hostname = 'localhost';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    fullscreen: true, // Полноэкранный режим
    frame: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: app.isPackaged 
      ? path.join(process.resourcesPath, 'app', 'public', 'favicon.ico')
      : path.join(__dirname, '../public/favicon.ico'),
    show: false,
  });

  // Показываем окно только после загрузки
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    // Убеждаемся, что окно в полноэкранном режиме
    if (mainWindow && !mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(true);
    }
  });

  // Загружаем приложение
  if (isDev) {
    // В режиме разработки подключаемся к dev серверу Next.js
    mainWindow.loadURL(`http://${hostname}:${port}`);
    mainWindow.webContents.openDevTools();
  } else {
    // В production запускаем Next.js сервер локально
    startNextServer();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function startNextServer() {
  try {
    // Определяем директорию приложения
    let appDir: string;
    let staticDir: string;
    
    if (app.isPackaged) {
      // В упакованном приложении Next.js standalone находится в resources/app
      appDir = path.join(process.resourcesPath, 'app');
      staticDir = path.join(process.resourcesPath, 'app', '.next', 'static');
    } else {
      // В режиме разработки используем корневую директорию проекта
      appDir = path.join(__dirname, '..');
      staticDir = path.join(appDir, '.next', 'static');
    }

    console.log('Next.js app directory:', appDir);
    console.log('Directory exists:', fs.existsSync(appDir));
    console.log('Resources path:', process.resourcesPath);
    
    // Проверяем наличие standalone сборки
    // В упакованном приложении файлы из .next/standalone копируются напрямую в app
    let standaloneDir: string;
    let standaloneServerPath: string;
    
    if (app.isPackaged) {
      // В production: файлы из .next/standalone копируются напрямую в app
      standaloneDir = appDir;
      standaloneServerPath = path.join(appDir, 'server.js');
    } else {
      // В разработке: используем стандартный путь
      standaloneDir = path.join(appDir, '.next', 'standalone');
      standaloneServerPath = path.join(standaloneDir, 'server.js');
    }
    
    const hasStandalone = fs.existsSync(standaloneServerPath);
    
    console.log('Standalone directory:', standaloneDir);
    console.log('Standalone exists:', fs.existsSync(standaloneDir));
    console.log('Server.js exists:', fs.existsSync(standaloneServerPath));

    if (hasStandalone) {
      // Используем standalone режим Next.js
      console.log('Using Next.js standalone mode');
      console.log('Standalone directory:', standaloneDir);
      console.log('Static directory:', staticDir);
      
      // Сохраняем оригинальную рабочую директорию
      const originalCwd = process.cwd();
      
      // Меняем рабочую директорию на standalone для правильной работы модулей
      process.chdir(standaloneDir);
      
      // Проверяем наличие node_modules
      const nodeModulesPath = path.join(standaloneDir, 'node_modules');
      console.log('Node modules path:', nodeModulesPath);
      console.log('Node modules exists:', fs.existsSync(nodeModulesPath));
      
      // Устанавливаем переменные окружения для Next.js
      process.env.PORT = port.toString();
      process.env.HOSTNAME = hostname;
      
      const nodeModulesDir = path.join(standaloneDir, 'node_modules');
      
      if (fs.existsSync(nodeModulesDir)) {
        // Добавляем node_modules в module.paths для правильного поиска модулей
        const Module = require('module');
        
        // Сохраняем оригинальный _nodeModulePaths
        const originalNodeModulePaths = (Module as any)._nodeModulePaths;
        
        // Переопределяем _nodeModulePaths для добавления нашего node_modules
        (Module as any)._nodeModulePaths = function(from: string) {
          const paths = originalNodeModulePaths ? originalNodeModulePaths.call(this, from) : [];
          // Добавляем node_modules из standalone в начало списка путей
          if (fs.existsSync(nodeModulesDir) && !paths.includes(nodeModulesDir)) {
            paths.unshift(nodeModulesDir);
          }
          return paths;
        };
        
        // Также добавляем в глобальные пути модулей
        const currentPaths = (Module as any)._resolveLookupPaths 
          ? (Module as any)._resolveLookupPaths('', null)
          : [];
        if (Array.isArray(currentPaths) && !currentPaths.includes(nodeModulesDir)) {
          currentPaths.unshift(nodeModulesDir);
        }
        
        // Устанавливаем NODE_PATH
        const originalNodePath = process.env.NODE_PATH || '';
        process.env.NODE_PATH = nodeModulesDir + (originalNodePath ? path.delimiter + originalNodePath : '');
      }
      
      // Загружаем server.js
      require(standaloneServerPath);
      
      // Ждем запуска сервера
      console.log('Waiting for server to start...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log(`> Next.js standalone server should be ready on http://${hostname}:${port}`);
      if (mainWindow) {
        mainWindow.loadURL(`http://${hostname}:${port}`);
      }
    } else {
      // Обычный режим Next.js (fallback)
      console.log('Using standard Next.js mode');
      const nextApp = next({
        dev: false,
        hostname,
        port,
        dir: appDir,
      });

      await nextApp.prepare();
      const handle = nextApp.getRequestHandler();

      server = createServer(async (req, res) => {
        try {
          const parsedUrl = parse(req.url || '/', true);
          await handle(req, res, parsedUrl);
        } catch (err) {
          console.error('Error occurred handling', req.url, err);
          res.statusCode = 500;
          res.end('internal server error');
        }
      });

      server.listen(port, hostname, () => {
        console.log(`> Next.js server ready on http://${hostname}:${port}`);
        if (mainWindow) {
          mainWindow.loadURL(`http://${hostname}:${port}`);
        }
      });
    }
  } catch (err) {
    console.error('Failed to start Next.js server:', err);
    console.error('Error details:', err);
    if (mainWindow) {
      mainWindow.loadURL(`data:text/html,<html><body><h1>Error starting server</h1><pre>${err instanceof Error ? err.message : String(err)}</pre></body></html>`);
    }
  }
}

app.whenReady().then(() => {
  // Убираем меню-бар (File, Edit, View и т.д.)
  Menu.setApplicationMenu(null);
  
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (server) {
    server.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (server) {
    server.close();
  }
});
