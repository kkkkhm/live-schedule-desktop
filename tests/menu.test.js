"use strict";

const assert = require("node:assert/strict");
const AppMenu = require("../desktop/menu");

function findMenu(template, label) {
  return template.find((item) => item.label === label);
}

function fakeWindow(initialZoom = 1) {
  let zoom = initialZoom;
  const sent = [];
  return {
    sent,
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      getZoomFactor: () => zoom,
      setZoomFactor: (value) => { zoom = value; },
      send: (channel, command) => sent.push([channel, command]),
    },
    zoom: () => zoom,
  };
}

{
  const win = fakeWindow();
  const template = AppMenu.buildMenuTemplate({
    platform: "win32",
    appName: "直播排班工具",
    getWindow: () => win,
    shell: { openExternal: async () => {} },
    dialog: { showErrorBox: () => {} },
  });
  const file = findMenu(template, "文件");
  const view = findMenu(template, "视图");
  const help = findMenu(template, "帮助");
  assert.ok(file && view && help, "Windows menu should contain File, View and Help");
  assert.deepEqual(file.submenu.filter((item) => item.label).map((item) => item.label), [
    "导入排班模板", "导出可编辑排班模板", "下载空白排班模板", "导出展示版排班表",
    "导入业绩表", "导出业绩表", "下载空白业绩模板",
    "导入 JSON 备份", "导出 JSON 备份", "导出排班 CSV", "导出时长统计 CSV", "退出",
  ]);
  assert.deepEqual(view.submenu.map((item) => item.label), ["放大", "缩小", "恢复默认大小"]);
  assert.deepEqual(help.submenu.map((item) => item.label), ["检查更新", "帮助文档"]);
}

{
  const win = fakeWindow();
  assert.equal(AppMenu.sendRendererCommand(() => win, "export-backup"), true);
  assert.equal(AppMenu.sendRendererCommand(() => win, "unknown-command"), false);
  assert.deepEqual(win.sent, [["app-menu:command", "export-backup"]]);
}

{
  const win = fakeWindow(1.95);
  assert.equal(AppMenu.changeZoom(() => win, 1), 2);
  assert.equal(AppMenu.changeZoom(() => win, 1), 2);
  assert.equal(AppMenu.changeZoom(() => win, -1), 1.9);
  assert.equal(AppMenu.resetZoom(() => win), 1);
  const tiny = fakeWindow(0.5);
  assert.equal(AppMenu.changeZoom(() => tiny, -1), 0.5);
}

assert.equal(AppMenu.HELP_URL, "https://github.com/kkkkhm/live-schedule-desktop#readme");
assert.deepEqual(AppMenu.RENDERER_COMMANDS, [
  "import-backup",
  "export-backup",
  "import-schedule-template",
  "export-editable-schedule-template",
  "download-blank-schedule-template",
  "export-display-schedule-xlsx",
  "import-performance-template",
  "export-performance-template",
  "download-blank-performance-template",
  "export-schedule-csv",
  "export-stats-csv",
  "check-update",
]);

console.log("PASS native application menu");

