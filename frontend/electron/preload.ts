import { contextBridge } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  // Здесь можно добавить API для взаимодействия между процессами
  platform: process.platform,
});
