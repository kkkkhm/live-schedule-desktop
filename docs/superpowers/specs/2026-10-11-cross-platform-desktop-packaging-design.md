# 直播周排班工具跨平台桌面版设计

## 目标

把现有纯前端排班工具封装成无需 Node.js、本地 HTTP 服务或浏览器配置即可运行的桌面应用，同时支持 Windows 和 macOS。现有排班、历史、业绩、统计、Excel/CSV/JSON 导出及 V1–V5 数据迁移功能保持不变。

## 交付形式

- Windows：绿色便携版 `.exe`，用户双击即可运行，不要求安装。
- macOS：未签名的 `.zip`，其中包含 `.app`。用户首次打开时通过“系统设置 → 隐私与安全性”手动允许。
- 源码中保留可重复执行的 Windows 和 macOS 打包命令。
- macOS 最终产物通过 macOS 构建环境生成；Windows 机器只负责 Windows 产物和 macOS 构建配置验证。

不包含代码签名、Apple 公证、自动更新、云同步和多人共享。

## 技术方案

使用 Electron 封装现有页面。桌面主进程创建单一 `BrowserWindow`，通过 `loadFile` 加载本地 `index.html`，不启动 HTTP 服务。渲染层继续使用现有 HTML、CSS 和 JavaScript，避免重写已验证的排班业务逻辑。

应用默认禁用 Node.js 渲染层集成，启用上下文隔离和沙箱。禁止弹出任意外部窗口与应用内外部导航；当前工具本身不需要访问互联网。

## 文件结构

- `desktop/main.js`：Electron 主进程、窗口生命周期和安全策略。
- `desktop/preload.js`：最小预加载入口；默认不向页面暴露 Node.js 能力。
- `package.json`：开发启动、测试及 Windows/macOS 打包命令。
- `build/`：应用图标等打包资源。
- `.github/workflows/build-desktop.yml`：在 Windows 与 macOS 构建机上分别生成产物。

现有 `index.html`、`app.js`、`logic.js`、`styles.css` 和 `vendor/` 直接作为应用资源打包。

## 数据与迁移

桌面版继续使用 `localStorage`，数据由 Electron 保存在当前系统用户的应用数据目录。应用升级沿用现有 V5 数据结构和迁移逻辑。

浏览器中的旧数据不会自动读取。用户先在浏览器版点击“导出备份”，再在桌面版点击“导入备份”即可迁移；这一流程避免直接读取浏览器配置目录造成权限和兼容问题。

JSON、CSV 和 Excel 导出继续使用现有下载逻辑，文件由 Electron 下载到系统默认下载目录。若下载失败，界面继续显示现有错误提示。

## 构建与发布

使用 `electron-builder`：

- `pack:win` 生成 x64 Windows portable EXE。
- `pack:mac` 分别生成 Apple Silicon（arm64）与 Intel（x64）两个未签名 ZIP，避免通用包体积过大。
- GitHub Actions 使用 Windows 与 macOS runner 分别构建并上传产物，避免在 Windows 上交叉构建 macOS 应用的不可靠行为。

本地首次构建需要下载 Electron 和打包依赖，但最终用户运行产物不需要任何开发环境或网络。

## 桌面行为

- 单实例运行；重复启动时聚焦已有窗口。
- 默认窗口提供适合宽排班表的最小尺寸，并允许最大化和缩放。
- 关闭应用前无需额外保存，因为编辑仍会自动写入本地存储。
- 应用内不提供开发者工具入口。
- 标题显示“直播周排班工具”。

## 错误处理

- 主页面加载失败时显示可识别的错误页并记录本地日志。
- 打包时若缺少图标，允许使用默认图标完成首版构建，不阻断功能交付。
- macOS 未签名导致首次启动被拦截属于已知分发限制，在 README 中给出手动允许步骤。
- 构建命令失败时不得覆盖已有可用产物。

## 验收标准

1. 现有逻辑测试全部通过。
2. Windows portable EXE 可在未安装 Node.js 的用户环境中启动。
3. 关闭并重新打开桌面应用后，排班数据仍存在。
4. JSON、CSV 和 Excel 文件可正常导出并打开。
5. JSON 备份可重新导入，V4 示例数据能自动升级到 V5。
6. 应用不能导航到外部网站，也不能从页面直接调用 Node.js API。
7. Windows 构建产物经过实际启动检查。
8. macOS 构建配置在 macOS runner 上生成未签名 `.app` ZIP；首次启动说明完整。

