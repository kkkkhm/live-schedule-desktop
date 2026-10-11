"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopUpdates", Object.freeze({
  getInfo: () => ipcRenderer.invoke("updates:get-info"),
  check: () => ipcRenderer.invoke("updates:check"),
  openExternal: (url) => ipcRenderer.invoke("updates:open-external", url)
}));

