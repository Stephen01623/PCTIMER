const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("timerAPI", {
  onMode(callback) {
    ipcRenderer.on("timer:mode", (_event, mode) => {
      callback(mode);
    });
  },

  onUpdate(callback) {
    ipcRenderer.on("timer:update", (_event, data) => {
      callback(data);
    });
  },

  closeApp() {
    ipcRenderer.send("app:close");
  },
});