const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("cursedCanvasDesktop", {
  platform: process.platform
});
