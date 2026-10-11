# GitHub Releases 跨平台更新设计

## 目标

将直播排班工具上传到公开仓库 `https://github.com/kkkkhm/live-schedule-desktop`，通过 GitHub Actions 构建 Windows、macOS Intel 和 macOS Apple Silicon 成品，并自动发布到 GitHub Releases。桌面应用支持检查新版本；发现新版本后由用户点击并在系统浏览器中下载匹配当前平台的安装包，不自动覆盖本地程序。

## 发布仓库

- 仓库：`kkkkhm/live-schedule-desktop`
- 可见性：公开。
- 默认分支：`main`。
- 版本标签：`desktop-v<版本号>`，例如 `desktop-v1.0.3`。
- Release 版本号从标签中解析，应用内部版本使用不带前缀的语义化版本号。

## 更新检查

Electron 主进程访问 GitHub Releases 最新版本接口：

`https://api.github.com/repos/kkkkhm/live-schedule-desktop/releases/latest`

启动桌面应用后异步检查一次，不阻塞窗口打开或本地排班。排班设置页新增“应用更新”区域，显示当前版本、检查状态和“检查更新”按钮。手动检查与启动检查共用同一个更新模块。

如果最新 Release 的版本高于本地版本，界面显示最新版本、Release 更新说明和“前往下载”按钮。用户点击后，应用通过系统浏览器打开匹配当前平台和架构的 Release 资源下载地址。

浏览器版不执行 GitHub 更新请求，更新区域显示“仅桌面版支持检查更新”。

## 资源匹配

Release 文件名保持固定模式：

- Windows x64：`LiveSchedule-Windows-<版本>-x64.exe`
- macOS Apple Silicon：`LiveSchedule-macOS-<版本>-arm64.zip`
- macOS Intel：`LiveSchedule-macOS-<版本>-x64.zip`

Windows 仅支持当前 x64 构建。macOS 根据 Electron 的 `process.arch` 选择 `arm64` 或 `x64`。找不到匹配资源时显示明确错误，并提供打开 Release 页面作为后备入口。

## 安全边界

- 更新网络请求只在 Electron 主进程执行。
- 预加载脚本仅向页面暴露读取版本、检查更新和打开已验证下载地址三个最小接口。
- 渲染页面不获得 Node.js、文件系统、Shell 或任意网络权限。
- 外部地址只允许 HTTPS，并限制为 `github.com`、`api.github.com` 及 GitHub Release 资源使用的受信任域名。
- 检查失败、GitHub 限流或离线时不影响任何排班功能和本地数据。
- 不在应用或仓库中保存 GitHub 令牌；公开仓库使用匿名 API。

## GitHub Actions

现有矩阵构建继续分别运行：

- `windows-latest`：运行测试并生成 Windows x64 便携 EXE。
- `macos-latest`：运行测试并生成 macOS x64 与 arm64 未签名 ZIP。

当推送 `desktop-v*` 标签时，发布任务下载两个构建任务的产物，自动创建对应 GitHub Release，生成发布说明并上传全部三个文件。手动运行工作流只生成可下载的 Actions Artifacts，不自动创建正式 Release。

由于不使用 Apple Developer 证书，macOS 成品保持未签名，用户首次打开时仍需在“系统设置 → 隐私与安全性”中手动允许。Windows 未签名成品也可能触发 SmartScreen 提示。

## 异常处理

- 无网络或 GitHub API 失败：显示“暂时无法检查更新”，可手动重试。
- API 返回无 Release：显示“尚未发布可用版本”。
- Release 标签无法解析：视为检查失败，不提示错误更新。
- 已是最新版：显示当前已是最新版。
- 找不到当前平台资源：显示资源缺失，并允许打开 Release 页面。
- 打开外部链接失败：显示错误，不改变应用状态。

## 测试与验收

- 语义化版本比较覆盖高于、等于、低于及带 `desktop-v` 前缀的版本。
- 资源选择覆盖 Windows x64、macOS x64、macOS arm64和资源缺失。
- 更新模块覆盖成功、无 Release、网络失败和格式异常。
- 桌面安全测试确认上下文隔离、沙箱及最小预加载接口保持有效。
- 浏览器版确认不会执行更新请求。
- GitHub Actions 配置检查确认标签发布任务收集并上传三个目标文件。
- 上传仓库后执行测试并推送首个标签，确认 GitHub Release 自动生成。

## 首次发布

实现版本使用 `1.0.3`，提交到 `main` 后推送标签 `desktop-v1.0.3`。应用第一次启动时会将 `1.0.3` Release 识别为当前版本；后续发布更高版本时才显示更新提示。
