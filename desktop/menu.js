"use strict";

const HELP_URL = "https://github.com/kkkkhm/live-schedule-desktop#readme";
const RENDERER_COMMANDS = Object.freeze([
  "import-backup",
  "export-backup",
  "export-schedule-xlsx",
  "export-schedule-csv",
  "export-stats-csv",
  "check-update",
]);
const rendererCommandSet = new Set(RENDERER_COMMANDS);

function usableWindow(getWindow) {
  const window = typeof getWindow === "function" ? getWindow() : null;
  if (!window || window.isDestroyed?.() || !window.webContents || window.webContents.isDestroyed?.()) return null;
  return window;
}

function sendRendererCommand(getWindow, command) {
  if (!rendererCommandSet.has(command)) return false;
  const window = usableWindow(getWindow);
  if (!window) return false;
  window.webContents.send("app-menu:command", command);
  return true;
}

function clampZoom(value) {
  return Math.min(2, Math.max(0.5, Math.round(value * 10) / 10));
}

function changeZoom(getWindow, direction) {
  const window = usableWindow(getWindow);
  if (!window) return false;
  const current = Number(window.webContents.getZoomFactor()) || 1;
  const next = clampZoom(current + (direction < 0 ? -0.1 : 0.1));
  window.webContents.setZoomFactor(next);
  return next;
}

function resetZoom(getWindow) {
  const window = usableWindow(getWindow);
  if (!window) return false;
  window.webContents.setZoomFactor(1);
  return 1;
}

async function openHelp(shell, dialog) {
  try {
    await shell.openExternal(HELP_URL);
    return true;
  } catch (_error) {
    dialog.showErrorBox("直播排班工具", "无法打开帮助文档，请检查网络连接后重试。");
    return false;
  }
}

function buildFileMenu(getWindow, platform) {
  const submenu = [
    { label: "导入 JSON 备份", click: () => sendRendererCommand(getWindow, "import-backup") },
    { type: "separator" },
    { label: "导出 JSON 备份", click: () => sendRendererCommand(getWindow, "export-backup") },
    { label: "导出排班 Excel", click: () => sendRendererCommand(getWindow, "export-schedule-xlsx") },
    { label: "导出排班 CSV", click: () => sendRendererCommand(getWindow, "export-schedule-csv") },
    { label: "导出时长统计 CSV", click: () => sendRendererCommand(getWindow, "export-stats-csv") },
  ];
  if (platform !== "darwin") submenu.push({ type: "separator" }, { label: "退出", role: "quit" });
  return { label: "文件", submenu };
}

function buildMenuTemplate({ platform = process.platform, appName = "直播排班工具", getWindow, shell, dialog }) {
  const template = [];
  if (platform === "darwin") {
    template.push({
      label: appName,
      submenu: [
        { label: `关于 ${appName}`, role: "about" },
        { type: "separator" },
        { role: "hide", label: `隐藏 ${appName}` },
        { role: "hideOthers", label: "隐藏其他" },
        { role: "unhide", label: "全部显示" },
        { type: "separator" },
        { label: `退出 ${appName}`, role: "quit" },
      ],
    });
  }

  template.push(buildFileMenu(getWindow, platform));
  if (platform === "darwin") {
    template.push({
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" }, { role: "redo", label: "重做" }, { type: "separator" },
        { role: "cut", label: "剪切" }, { role: "copy", label: "复制" }, { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    });
  }
  template.push({
    label: "视图",
    submenu: [
      { label: "放大", accelerator: "CmdOrCtrl+=", click: () => changeZoom(getWindow, 1) },
      { label: "缩小", accelerator: "CmdOrCtrl+-", click: () => changeZoom(getWindow, -1) },
      { label: "恢复默认大小", accelerator: "CmdOrCtrl+0", click: () => resetZoom(getWindow) },
    ],
  });
  template.push({
    label: "帮助",
    submenu: [
      { label: "检查更新", click: () => sendRendererCommand(getWindow, "check-update") },
      { label: "帮助文档", click: () => { void openHelp(shell, dialog); } },
    ],
  });
  return template;
}

function installApplicationMenu({ Menu, ...options }) {
  const menu = Menu.buildFromTemplate(buildMenuTemplate(options));
  Menu.setApplicationMenu(menu);
  return menu;
}

module.exports = {
  HELP_URL,
  RENDERER_COMMANDS,
  buildMenuTemplate,
  changeZoom,
  clampZoom,
  installApplicationMenu,
  openHelp,
  resetZoom,
  sendRendererCommand,
};

