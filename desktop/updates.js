"use strict";

const REPOSITORY = "kkkkhm/live-schedule-desktop";
const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;

function normalizeVersion(value) {
  const match = String(value || "").trim().replace(/^desktop-v/i, "").replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1, 4).map(Number).join(".") : "";
}

function compareVersions(leftValue, rightValue) {
  const left = normalizeVersion(leftValue);
  const right = normalizeVersion(rightValue);
  if (!left || !right) return null;
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

function expectedAssetName(platform, arch, version) {
  if (platform === "win32" && arch === "x64") return `LiveSchedule-Windows-${version}-x64.exe`;
  if (platform === "darwin" && ["x64", "arm64"].includes(arch)) return `LiveSchedule-macOS-${version}-${arch}.zip`;
  return "";
}

function isAllowedExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "github.com"
      && url.pathname.startsWith(`/${REPOSITORY}/releases/`);
  } catch (_error) {
    return false;
  }
}

function selectReleaseAsset(release, platform, arch, version) {
  const expected = expectedAssetName(platform, arch, version);
  if (!expected) return null;
  const asset = (release?.assets || []).find((item) => item?.name === expected && isAllowedExternalUrl(item.browser_download_url));
  return asset ? { name: asset.name, downloadUrl: asset.browser_download_url } : null;
}

async function checkForUpdates({ currentVersion, platform, arch, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") return { status: "error", currentVersion, message: "当前环境不支持网络检查" };
  try {
    const response = await fetchImpl(LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "live-schedule-desktop" }
    });
    if (response.status === 404) return { status: "no-release", currentVersion, releaseUrl: RELEASES_URL };
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    const release = await response.json();
    const latestVersion = normalizeVersion(release?.tag_name);
    const comparison = compareVersions(latestVersion, currentVersion);
    if (!latestVersion || comparison === null || !isAllowedExternalUrl(release?.html_url)) {
      return { status: "error", currentVersion, message: "发布版本信息格式无效" };
    }
    const base = {
      currentVersion,
      latestVersion,
      releaseName: String(release.name || release.tag_name || latestVersion),
      notes: String(release.body || "").slice(0, 6000),
      publishedAt: release.published_at || "",
      releaseUrl: release.html_url
    };
    if (comparison <= 0) return { status: "up-to-date", ...base };
    const asset = selectReleaseAsset(release, platform, arch, latestVersion);
    if (!asset) return { status: "asset-missing", ...base, message: "当前系统的更新文件尚未上传" };
    return { status: "update-available", ...base, ...asset };
  } catch (_error) {
    return { status: "error", currentVersion, message: "暂时无法检查更新，请稍后重试" };
  }
}

module.exports = {
  REPOSITORY,
  RELEASES_URL,
  LATEST_RELEASE_API,
  normalizeVersion,
  compareVersions,
  expectedAssetName,
  isAllowedExternalUrl,
  selectReleaseAsset,
  checkForUpdates
};
