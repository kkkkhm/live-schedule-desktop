const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "desktop-dist");
const builderCli = path.join(rootDir, "node_modules", "electron-builder", "cli.js");
const { version } = require(path.join(rootDir, "package.json"));

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
    },
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function findApp(directory) {
  if (!fs.existsSync(directory)) {
    throw new Error(`未找到 macOS 打包目录：${directory}`);
  }

  const appName = fs.readdirSync(directory).find((name) => name.endsWith(".app"));
  if (!appName) throw new Error(`未在 ${directory} 中找到 .app`);
  return path.join(directory, appName);
}

function packageArchitecture(arch, appDirectoryName) {
  run(process.execPath, [builderCli, "--mac", "--dir", `--${arch}`]);

  const appPath = findApp(path.join(outputDir, appDirectoryName));
  const zipPath = path.join(outputDir, `LiveSchedule-macOS-${version}-${arch}.zip`);
  fs.rmSync(zipPath, { force: true });
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, zipPath]);
}

if (process.platform !== "darwin") {
  throw new Error("macOS 安装包必须在 macOS 上构建");
}

fs.mkdirSync(outputDir, { recursive: true });
packageArchitecture("x64", "mac");
packageArchitecture("arm64", "mac-arm64");

