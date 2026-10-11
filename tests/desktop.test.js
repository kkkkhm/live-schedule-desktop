const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const main = fs.readFileSync(path.join(root, "desktop", "main.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "desktop", "preload.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "build-desktop.yml"), "utf8");

assert.equal(packageJson.main, "desktop/main.js");
assert.match(packageJson.scripts["pack:win"], /--win portable --x64/);
assert.match(packageJson.scripts["pack:mac"], /--mac zip --x64 --arm64/);
assert.deepEqual(packageJson.build.files.includes("vendor/**/*"), true);
assert.match(main, /nodeIntegration:\s*false/);
assert.match(main, /contextIsolation:\s*true/);
assert.match(main, /sandbox:\s*true/);
assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/);
assert.match(main, /will-navigate/);
assert.match(main, /Updates\.isAllowedExternalUrl/);
assert.match(preload, /contextBridge\.exposeInMainWorld\("desktopUpdates"/);
assert.doesNotMatch(preload, /require\("node:fs"\)/);
assert.match(html, /Content-Security-Policy/);
assert.match(html, /id="checkUpdateBtn"/);
assert.match(workflow, /gh release create/);
assert.match(workflow, /needs: build/);

console.log("PASS desktop packaging and security configuration");

