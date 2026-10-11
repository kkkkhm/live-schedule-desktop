"use strict";

const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const path = require("node:path");
const AppMenu = require("./menu");
const Updates = require("./updates");

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
    autoHideMenuBar: false,
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

function installMenu() {
  AppMenu.installApplicationMenu({
    Menu,
    appName: APP_TITLE,
    platform: process.platform,
    getWindow: () => BrowserWindow.getFocusedWindow() || mainWindow,
    shell,
    dialog,
  });
}

function registerUpdateHandlers() {
  ipcMain.handle("updates:get-info", () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch }));
  ipcMain.handle("updates:check", () => Updates.checkForUpdates({ currentVersion: app.getVersion(), platform: process.platform, arch: process.arch }));
  ipcMain.handle("updates:open-external", async (_event, url) => {
    if (!Updates.isAllowedExternalUrl(url)) return { ok: false, message: "已阻止不受信任的更新地址" };
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (_error) {
      return { ok: false, message: "无法打开下载页面" };
    }
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
  app.whenReady().then(() => { registerUpdateHandlers(); createWindow(); installMenu(); });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}

