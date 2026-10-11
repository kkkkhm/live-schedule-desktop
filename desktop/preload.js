"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopUpdates", Object.freeze({
  getInfo: () => ipcRenderer.invoke("updates:get-info"),
  check: () => ipcRenderer.invoke("updates:check"),
  openExternal: (url) => ipcRenderer.invoke("updates:open-external", url)
}));

const allowedMenuCommands = new Set([
  "import-backup",
  "export-backup",
  "export-schedule-xlsx",
  "export-schedule-csv",
  "export-stats-csv",
  "check-update",
]);

contextBridge.exposeInMainWorld("desktopMenu", Object.freeze({
  onCommand: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, command) => {
      if (allowedMenuCommands.has(command)) callback(command);
    };
    ipcRenderer.on("app-menu:command", listener);
    return () => ipcRenderer.removeListener("app-menu:command", listener);
  },
}));

