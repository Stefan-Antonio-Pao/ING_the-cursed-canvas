const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cursedCanvasDesktop", {
  platform: process.platform,
  setWindowIcon: (iconPath, iconId) => ipcRenderer.invoke("desktop:set-window-icon", { iconPath, iconId }),
  quitApp: () => ipcRenderer.invoke("desktop:quit-app")
});
