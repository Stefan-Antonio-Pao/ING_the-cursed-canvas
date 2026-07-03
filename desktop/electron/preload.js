const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cursedCanvasDesktop", {
  platform: process.platform,
  setWindowIcon: (iconPath) => ipcRenderer.invoke("desktop:set-window-icon", iconPath),
  quitApp: () => ipcRenderer.invoke("desktop:quit-app")
});
