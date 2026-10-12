# 桌面版构建与使用

## 最终用户

### Windows

双击 `LiveSchedule-Windows-1.0.8-x64.exe` 即可运行。程序是绿色便携版，不要求安装 Node.js，也不需要本地服务器。

### macOS

下载与处理器匹配的文件：

- Apple Silicon（M1/M2/M3/M4 等）：`LiveSchedule-macOS-1.0.8-arm64.zip`
- Intel Mac：`LiveSchedule-macOS-1.0.8-x64.zip`

解压后打开 `.app`。因为当前版本没有 Apple 开发者签名，首次打开如果被系统阻止，请进入“系统设置 → 隐私与安全性”，在安全提示处点击“仍要打开”。

## 生成 macOS 成品

仓库包含 `.github/workflows/build-desktop.yml`。把仓库推送到 GitHub 后，在 Actions 中手动运行 `Build desktop apps`，即可同时得到：

- `windows-portable`
- `macos-unsigned`（包含 x64 与 arm64 两个 ZIP）

也可以在 Mac 上执行：

```bash
npm ci
npm test
npm run pack:mac
```

macOS 构建产物会写入 `desktop-dist/`。

## 浏览器数据迁移

浏览器版和桌面版的数据目录互相独立。先使用“文件 → 导出 JSON 备份”，再在目标版本使用“文件 → 导入 JSON 备份”即可迁移原有排班。

## Excel 文件

“文件”菜单可以下载空白排班模板、导出可编辑排班模板、导入排班模板、导出展示版排班表，以及导入导出业绩表。Windows 与 macOS 使用相同的 `.xlsx` 格式。

排班模板与生成时的班组、人员、班次和直播间配置绑定。如果这些配置发生变化，请重新下载模板。导入会先显示预览；存在阻断错误时不会写入任何数据。

