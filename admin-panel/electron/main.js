"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const http_1 = require("http");
const url_1 = require("url");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const next_1 = __importDefault(require("next"));
let mainWindow = null;
let server = null;
const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
const port = parseInt(process.env.PORT || '3000', 10);
const hostname = 'localhost';
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
        icon: electron_1.app.isPackaged
            ? path.join(process.resourcesPath, 'app', 'public', 'favicon.ico')
            : path.join(__dirname, '../public/favicon.ico'),
        show: false,
    });
    // Показываем окно только после загрузки
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
    });
    // Загружаем приложение
    if (isDev) {
        // В режиме разработки подключаемся к dev серверу Next.js
        mainWindow.loadURL(`http://${hostname}:${port}`);
        mainWindow.webContents.openDevTools();
    }
    else {
        // В production запускаем Next.js сервер локально
        startNextServer();
    }
    // При закрытии окна — автоматический выход из аккаунта (очистка localStorage)
    mainWindow.on('close', (event) => {
        if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
            event.preventDefault();
            mainWindow.webContents
                .executeJavaScript("localStorage.removeItem('auth_token'); localStorage.removeItem('user_data');")
                .finally(() => {
                mainWindow?.destroy();
                mainWindow = null;
            });
        }
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
async function startNextServer() {
    try {
        // Определяем директорию приложения
        let appDir;
        let staticDir;
        if (electron_1.app.isPackaged) {
            // В упакованном приложении Next.js standalone находится в resources/app
            appDir = path.join(process.resourcesPath, 'app');
            staticDir = path.join(process.resourcesPath, 'app', '.next', 'static');
        }
        else {
            // В режиме разработки используем корневую директорию проекта
            appDir = path.join(__dirname, '..');
            staticDir = path.join(appDir, '.next', 'static');
        }
        console.log('Next.js app directory:', appDir);
        console.log('Directory exists:', fs.existsSync(appDir));
        console.log('Resources path:', process.resourcesPath);
        // Проверяем наличие standalone сборки
        // В упакованном приложении файлы из .next/standalone копируются напрямую в app
        let standaloneDir;
        let standaloneServerPath;
        if (electron_1.app.isPackaged) {
            // В production: файлы из .next/standalone копируются напрямую в app
            // Поэтому server.js и node_modules находятся в корне app
            standaloneDir = appDir;
            standaloneServerPath = path.join(appDir, 'server.js');
        }
        else {
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
            // Устанавливаем переменные окружения для Next.js
            process.env.PORT = port.toString();
            process.env.HOSTNAME = hostname;
            try {
                // Загружаем и запускаем standalone сервер
                console.log('Loading standalone server from:', standaloneServerPath);
                console.log('Standalone directory:', standaloneDir);
                // Проверяем наличие node_modules
                const nodeModulesPath = path.join(standaloneDir, 'node_modules');
                console.log('Node modules path:', nodeModulesPath);
                console.log('Node modules exists:', fs.existsSync(nodeModulesPath));
                console.log('Next module exists:', fs.existsSync(path.join(nodeModulesPath, 'next')));
                // Меняем рабочую директорию на standalone для правильной работы модулей
                const originalCwd = process.cwd();
                process.chdir(standaloneDir);
                // Устанавливаем переменные окружения для Next.js
                process.env.PORT = port.toString();
                process.env.HOSTNAME = hostname;
                const nodeModulesDir = path.join(standaloneDir, 'node_modules');
                if (fs.existsSync(nodeModulesDir)) {
                    // Добавляем node_modules в module.paths для правильного поиска модулей
                    const Module = require('module');
                    // Сохраняем оригинальный _nodeModulePaths
                    const originalNodeModulePaths = Module._nodeModulePaths;
                    // Переопределяем _nodeModulePaths для добавления нашего node_modules
                    Module._nodeModulePaths = function (from) {
                        const paths = originalNodeModulePaths ? originalNodeModulePaths.call(this, from) : [];
                        // Добавляем node_modules из standalone в начало списка путей
                        if (fs.existsSync(nodeModulesDir) && !paths.includes(nodeModulesDir)) {
                            paths.unshift(nodeModulesDir);
                        }
                        return paths;
                    };
                    // Также добавляем в глобальные пути модулей
                    const currentPaths = Module._resolveLookupPaths
                        ? Module._resolveLookupPaths('', null)
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
            }
            catch (err) {
                console.error('Error loading standalone server:', err);
                console.error('Stack:', err instanceof Error ? err.stack : 'No stack');
                // Возвращаем рабочую директорию
                if (typeof originalCwd !== 'undefined') {
                    process.chdir(originalCwd);
                }
                if (mainWindow) {
                    mainWindow.loadURL(`data:text/html,<html><body><h1>Error starting server</h1><pre>${err instanceof Error ? err.message : String(err)}</pre></body></html>`);
                }
            }
            return;
        }
        // Обычный режим Next.js (fallback)
        console.log('Using standard Next.js mode');
        const nextApp = (0, next_1.default)({
            dev: false,
            hostname,
            port,
            dir: appDir,
        });
        await nextApp.prepare();
        const handle = nextApp.getRequestHandler();
        server = (0, http_1.createServer)(async (req, res) => {
            try {
                const parsedUrl = (0, url_1.parse)(req.url || '/', true);
                await handle(req, res, parsedUrl);
            }
            catch (err) {
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
    catch (err) {
        console.error('Failed to start Next.js server:', err);
        console.error('Error details:', err);
        if (mainWindow) {
            mainWindow.loadURL(`data:text/html,<html><body><h1>Error starting server</h1><pre>${err}</pre></body></html>`);
        }
    }
}
electron_1.app.whenReady().then(() => {
    // Убираем меню-бар (File, Edit, View и т.д.)
    electron_1.Menu.setApplicationMenu(null);
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (server) {
        server.close();
    }
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('before-quit', async () => {
    // Очищаем сессию при выходе (резерв, если окно уже закрыто)
    const windows = electron_1.BrowserWindow.getAllWindows();
    await Promise.all(windows.map((win) => {
        if (win.webContents && !win.webContents.isDestroyed()) {
            return win.webContents.executeJavaScript("localStorage.removeItem('auth_token'); localStorage.removeItem('user_data');");
        }
        return Promise.resolve();
    }));
    if (server) {
        server.close();
    }
});
