import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const port = 5173;

function canConnect() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const finish = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function waitForPage() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await canConnect()) return;
    await delay(200);
  }
  throw new Error("工作台页面没有在 127.0.0.1:5173 起来。");
}

const alreadyRunning = await canConnect();
const vite = alreadyRunning
  ? null
  : spawn("npm", ["run", "dev"], { cwd: root, stdio: "inherit", shell: true, windowsHide: true });

try {
  await waitForPage();
} catch (error) {
  if (vite) vite.kill();
  throw error;
}

const electronPath = require("electron");
const desktop = spawn(electronPath, [path.join(root, "desktop", "main.cjs")], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, ZHIJIAO_DESKTOP_URL: `http://127.0.0.1:${port}` },
});

function stopVite() {
  if (vite && !vite.killed) vite.kill();
}

desktop.on("exit", (code) => {
  stopVite();
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  desktop.kill();
  stopVite();
});
