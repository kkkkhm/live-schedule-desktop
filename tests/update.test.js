"use strict";

const assert = require("node:assert/strict");
const Updates = require("../desktop/updates.js");

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

async function run() {
  assert.equal(Updates.normalizeVersion("desktop-v1.2.3"), "1.2.3");
  assert.equal(Updates.normalizeVersion("v2.0.0-beta.1"), "2.0.0");
  assert.equal(Updates.normalizeVersion("invalid"), "");
  assert.equal(Updates.compareVersions("1.0.3", "1.0.2"), 1);
  assert.equal(Updates.compareVersions("1.0.2", "1.0.2"), 0);
  assert.equal(Updates.compareVersions("1.0.1", "1.0.2"), -1);

  const release = {
    tag_name: "desktop-v1.0.3",
    name: "V1.0.3",
    body: "更新说明",
    published_at: "2026-10-11T00:00:00Z",
    html_url: "https://github.com/kkkkhm/live-schedule-desktop/releases/tag/desktop-v1.0.3",
    assets: [
      { name: "LiveSchedule-Windows-1.0.3-x64.exe", browser_download_url: "https://github.com/kkkkhm/live-schedule-desktop/releases/download/desktop-v1.0.3/LiveSchedule-Windows-1.0.3-x64.exe" },
      { name: "LiveSchedule-macOS-1.0.3-x64.zip", browser_download_url: "https://github.com/kkkkhm/live-schedule-desktop/releases/download/desktop-v1.0.3/LiveSchedule-macOS-1.0.3-x64.zip" },
      { name: "LiveSchedule-macOS-1.0.3-arm64.zip", browser_download_url: "https://github.com/kkkkhm/live-schedule-desktop/releases/download/desktop-v1.0.3/LiveSchedule-macOS-1.0.3-arm64.zip" }
    ]
  };

  assert.equal(Updates.selectReleaseAsset(release, "win32", "x64", "1.0.3").name, "LiveSchedule-Windows-1.0.3-x64.exe");
  assert.equal(Updates.selectReleaseAsset(release, "darwin", "x64", "1.0.3").name, "LiveSchedule-macOS-1.0.3-x64.zip");
  assert.equal(Updates.selectReleaseAsset(release, "darwin", "arm64", "1.0.3").name, "LiveSchedule-macOS-1.0.3-arm64.zip");
  assert.equal(Updates.selectReleaseAsset(release, "linux", "x64", "1.0.3"), null);
  assert.equal(Updates.isAllowedExternalUrl("https://github.com/kkkkhm/live-schedule-desktop/releases/tag/desktop-v1.0.3"), true);
  assert.equal(Updates.isAllowedExternalUrl("https://example.com/evil.exe"), false);

  const available = await Updates.checkForUpdates({ currentVersion: "1.0.2", platform: "darwin", arch: "arm64", fetchImpl: async () => response(200, release) });
  assert.equal(available.status, "update-available");
  assert.equal(available.latestVersion, "1.0.3");
  assert.match(available.downloadUrl, /arm64\.zip$/);

  const current = await Updates.checkForUpdates({ currentVersion: "1.0.3", platform: "win32", arch: "x64", fetchImpl: async () => response(200, release) });
  assert.equal(current.status, "up-to-date");

  const missing = await Updates.checkForUpdates({ currentVersion: "1.0.2", platform: "linux", arch: "x64", fetchImpl: async () => response(200, release) });
  assert.equal(missing.status, "asset-missing");

  const noRelease = await Updates.checkForUpdates({ currentVersion: "1.0.2", platform: "win32", arch: "x64", fetchImpl: async () => response(404, {}) });
  assert.equal(noRelease.status, "no-release");

  const failed = await Updates.checkForUpdates({ currentVersion: "1.0.2", platform: "win32", arch: "x64", fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(failed.status, "error");
  console.log("PASS GitHub release update checks");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
