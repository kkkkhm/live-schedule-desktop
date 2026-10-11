"use strict";

const assert = require("node:assert/strict");

async function run() {
  const port = Number(process.argv[2]) || 9223;
  const mode = process.argv[3] || "read";
  const pages = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const page = pages.find((item) => item.type === "page" && item.url.startsWith("file:"));
  assert.ok(page?.webSocketDebuggerUrl, "desktop renderer was not exposed on the smoke-test port");

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP smoke test timed out")), 5000);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer);
      resolve(message);
    });
    socket.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        returnByValue: true,
        expression: `(() => {
          if (${JSON.stringify(mode)} === "write") localStorage.setItem("desktop-smoke-key", "persisted");
          return ({
          title: document.title,
          readyState: document.readyState,
          hasLogic: Boolean(window.ScheduleLogic),
          hasSettingsTab: [...document.querySelectorAll(".tab")].some((item) => item.textContent.trim() === "排班设置"),
          hasSchedule: document.body.innerText.includes("周排班"),
          storage: localStorage.getItem("desktop-smoke-key")
        });
        })()`
      }
    }));
  });
  socket.close();

  const value = result.result?.result?.value;
  assert.deepEqual(value, {
    title: "直播周排班",
    readyState: "complete",
    hasLogic: true,
    hasSettingsTab: true,
    hasSchedule: true,
    storage: mode === "write" || mode === "check" ? "persisted" : null
  });
  console.log("PASS packaged desktop renderer smoke test", JSON.stringify(value));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

