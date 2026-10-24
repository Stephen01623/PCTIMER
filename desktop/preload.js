
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

  redeemVoucher(code) {
    return ipcRenderer.invoke("voucher:redeem", code);
  },

  closeApp() {
    ipcRenderer.send("app:close");
  },

  resizeWindow(width, height) {
    ipcRenderer.send("timer:resize", { width, height });
  },
});
