// The only bridge into Archium's own pages (toolbar, assistant). Web pages never get it.
const { contextBridge, ipcRenderer } = require("electron");

const EVENTS = new Set(["state", "command", "found", "model-progress", "ask"]);

contextBridge.exposeInMainWorld("archium", {
  send: (command, arg) => ipcRenderer.send("archium", command, arg),
  invoke: (command, arg) => ipcRenderer.invoke("archium", command, arg),
  on(event, fn) {
    if (!EVENTS.has(event)) throw new Error(`Unknown event ${event}`);
    ipcRenderer.on(event, (_, data) => fn(data));
  },
});
