// The window UI's bridge to main. Only archium: channels, so the UI can't reach anything else.
const { contextBridge, ipcRenderer } = require("electron");

const allowed = (channel) => typeof channel === "string" && channel.startsWith("archium:");

contextBridge.exposeInMainWorld("archium", {
  platform: process.platform,
  invoke: (channel, ...args) => (allowed(channel) ? ipcRenderer.invoke(channel, ...args) : Promise.reject(new Error("blocked channel"))),
  send: (channel, ...args) => allowed(channel) && ipcRenderer.send(channel, ...args),
  on: (channel, listener) => {
    if (!allowed(channel)) return () => {};
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
