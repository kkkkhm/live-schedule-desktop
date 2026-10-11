"use strict";

const { app, BrowserWindow, dialog } = require("electron");
const path = require("node:path");

const APP_TITLE = "直播排班工具";
let mainWindow = null;

function isTrustedLocalUrl(value) {
  try {
    const target = new URL(value);
    return target.protocol === "file:" && path.normalize(decodeURIComponent(target.pathname)).endsWith(path.normalize("/index.html"));
  } catch (_error) {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: APP_TITLE,
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor: "#f4f7fb",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedLocalUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    dialog.showErrorBox(APP_TITLE, `页面加载失败（${errorCode}）：${errorDescription}`);
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });

  mainWindow.loadFile(path.join(__dirname, "..", "index.html")).catch((error) => {
    dialog.showErrorBox(APP_TITLE, `无法启动应用：${error.message}`);
  });
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(createWindow);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}

