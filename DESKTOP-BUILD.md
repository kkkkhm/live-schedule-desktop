# 桌面版构建与使用

## 最终用户

### Windows

双击 `LiveSchedule-Windows-1.0.4-x64.exe` 即可运行。程序是绿色便携版，不要求安装 Node.js，也不需要本地服务器。

### macOS

下载与处理器匹配的文件：

- Apple Silicon（M1/M2/M3/M4 等）：`LiveSchedule-macOS-1.0.4-arm64.zip`
- Intel Mac：`LiveSchedule-macOS-1.0.4-x64.zip`

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

浏览器版和桌面版的数据目录互相独立。先在浏览器版点击“导出备份”，再在桌面版点击“导入备份”即可迁移原有排班。

