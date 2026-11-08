// The baseline for the privacy run: Electron with its defaults and nothing of Archium's.
const { app, BrowserWindow } = require("electron");

app.setPath("userData", process.env.STOCK_USER_DATA);
globalThis.openPage = (url) => {
  const win = new BrowserWindow({ width: 1100, height: 760 });
  win.loadURL(url);
};
app.on("window-all-closed", () => {});
