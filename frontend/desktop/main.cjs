const { app, BrowserWindow } = require("electron");

const pageUrl = process.env.ZHIJIAO_DESKTOP_URL || "http://127.0.0.1:5173";

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 880,
    minHeight: 640,
    title: "智教harness",
    backgroundColor: "#f4f7f5",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.loadURL(pageUrl);
  return window;
}

app.whenReady().then(() => {
  app.setAppUserModelId("zhijiao.harness");
  const window = createWindow();
  app.on("second-instance", () => {
    if (window.isMinimized()) window.restore();
    window.focus();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
