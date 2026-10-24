
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
} = require("electron");

const { execFile } = require("child_process");

dotenv.config({
  path: path.join(__dirname, ".env"),
});

// ======================================================
// CONFIGURATION
// ======================================================

const API_BASE_URL = (
  process.env.API_BASE_URL ||
  "https://pctimer.onrender.com"
).replace(/\/+$/, "");

const DESKTOP_API_KEY = process.env.DESKTOP_API_KEY;

const LOCK_GRACE_PERIOD_SECONDS = 120;
const POLLING_INTERVAL_MS = 5000;

const FLOATING_WIDTH = 230;
const FLOATING_HEIGHT = 80;
const FLOATING_MARGIN = 12;

// Set false during testing to prevent actual Windows shutdown.
const ENABLE_WINDOWS_SHUTDOWN = true;

// ======================================================
// APPLICATION STATE
// ======================================================

let desktopDeviceId = null;
let cachePath = null;
let deviceIdPath = null;

let mainWindow = null;
let pollingInterval = null;
let countdownInterval = null;

let isFetching = false;
let currentMode = null;

let shutdownDeadlineMs = null;
let shutdownInitiated = false;
let allowApplicationClose = false;

let lastKnownTimer = null;
let serverConnected = false;

let latestTimerUpdate = null;
let latestModeUpdate = null;

// ======================================================
// LOCAL CACHE
// ======================================================

function saveLocalCache() {
  if (!cachePath) return;

  try {
    const data = {
      savedAtUtc: new Date().toISOString(),
      timer: lastKnownTimer,
      shutdownDeadlineMs,
    };

    fs.writeFileSync(
      cachePath,
      JSON.stringify(data, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("Unable to save local cache:", error.message);
  }
}

function loadLocalCache() {
  if (!cachePath) return false;

  try {
    if (!fs.existsSync(cachePath)) {
      console.log("No previous local timer cache found.");
      return false;
    }

    const data = JSON.parse(
      fs.readFileSync(cachePath, "utf8")
    );

    if (
      data.timer &&
      typeof data.timer.isActive === "boolean"
    ) {
      lastKnownTimer = data.timer;

      shutdownDeadlineMs =
        Number.isFinite(data.shutdownDeadlineMs)
          ? data.shutdownDeadlineMs
          : null;

      console.log("Previous timer cache restored.");
      return true;
    }
  } catch (error) {
    console.error("Unable to load local timer cache:", error.message);
  }

  return false;
}

// ======================================================
// DEVICE ID
// ======================================================

function loadOrCreateDeviceId() {
  try {
    if (fs.existsSync(deviceIdPath)) {
      desktopDeviceId = fs
        .readFileSync(deviceIdPath, "utf8")
        .trim();
    }

    if (!desktopDeviceId) {
      desktopDeviceId = crypto.randomUUID();

      fs.writeFileSync(
        deviceIdPath,
        desktopDeviceId,
        "utf8"
      );
    }

    console.log("Desktop device ID loaded.");
  } catch (error) {
    console.error("Unable to load device ID:", error.message);
    desktopDeviceId = crypto.randomUUID();
  }
}

// ======================================================
// TIMER HELPERS
// ======================================================

function getTimerRemainingSeconds(timer) {
  if (!timer || timer.isActive !== true) {
    return 0;
  }

  if (timer.endsAtUtc) {
    const endMs = Date.parse(timer.endsAtUtc);

    if (Number.isFinite(endMs)) {
      return Math.max(
        0,
        Math.ceil((endMs - Date.now()) / 1000)
      );
    }
  }

  return Math.max(
    0,
    Number(timer.remainingSeconds) || 0
  );
}

function startShutdownCountdownIfNeeded() {
  if (shutdownInitiated) return;

  // Start a fresh grace period if there is no valid future deadline.
  if (
    shutdownDeadlineMs === null ||
    shutdownDeadlineMs <= Date.now()
  ) {
    shutdownDeadlineMs =
      Date.now() + LOCK_GRACE_PERIOD_SECONDS * 1000;

    console.log(
      `Local grace period started: ${LOCK_GRACE_PERIOD_SECONDS} seconds.`
    );

    saveLocalCache();
  }
}

function cancelShutdownCountdown() {
  shutdownDeadlineMs = null;
  saveLocalCache();

  console.log("Local shutdown countdown cancelled.");
}

function getShutdownRemainingSeconds() {
  if (shutdownDeadlineMs === null) return null;

  return Math.max(
    0,
    Math.ceil((shutdownDeadlineMs - Date.now()) / 1000)
  );
}

// ======================================================
// RENDERER COMMUNICATION
// ======================================================

function sendTimerUpdate(data) {
  latestTimerUpdate = data;

  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.isLoading()) return;

  mainWindow.webContents.send("timer:update", data);
}

// ======================================================
// WINDOW MODES
// ======================================================

function setMode(mode) {
  latestModeUpdate = mode;

  if (!mainWindow || mainWindow.isDestroyed()) {
    currentMode = mode;
    return;
  }

  if (currentMode === mode) return;

  currentMode = mode;

  if (mode === "active") {
    mainWindow.setKiosk(false);
    mainWindow.setFullScreen(false);

    const area = screen.getPrimaryDisplay().workArea;

    mainWindow.setBounds({
      x: area.x + area.width - FLOATING_WIDTH - FLOATING_MARGIN,
      y: area.y + area.height - FLOATING_HEIGHT - FLOATING_MARGIN,
      width: FLOATING_WIDTH,
      height: FLOATING_HEIGHT,
    });

    mainWindow.setSkipTaskbar(true);
    mainWindow.setAlwaysOnTop(true, "screen-saver");
    mainWindow.show();
  } else {
    const bounds = screen.getPrimaryDisplay().bounds;

    mainWindow.setKiosk(false);
    mainWindow.setFullScreen(false);

    mainWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });

    mainWindow.setSkipTaskbar(false);
    mainWindow.setAlwaysOnTop(true, "screen-saver");
    mainWindow.setFullScreen(true);
    mainWindow.setKiosk(true);

    mainWindow.show();
    mainWindow.focus();
  }

  if (!mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send("timer:mode", mode);
  }
}

// ======================================================
// WINDOW CREATION
// ======================================================

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return;

  mainWindow = new BrowserWindow({
    width: FLOATING_WIDTH,
    height: FLOATING_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreen: false,
    kiosk: false,
    autoHideMenuBar: true,

    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("close", (event) => {
    if (
      currentMode === "locked" &&
      !shutdownInitiated &&
      !allowApplicationClose
    ) {
      event.preventDefault();
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("did-finish-load", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (latestModeUpdate) {
      mainWindow.webContents.send("timer:mode", latestModeUpdate);
    }

    if (latestTimerUpdate) {
      mainWindow.webContents.send("timer:update", latestTimerUpdate);
    }
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, url) => {
      console.error("Renderer load failed:", {
        errorCode,
        errorDescription,
        url,
      });
    }
  );

  mainWindow
    .loadFile(path.join(__dirname, "renderer", "index.html"))
    .catch((error) => {
      console.error("Unable to load renderer:", error.message);
    });
}

// ======================================================
// OFFLINE STATE
// ======================================================

function applyOfflineState() {
  serverConnected = false;

  if (!lastKnownTimer) {
    startShutdownCountdownIfNeeded();
    setMode("locked");

    sendTimerUpdate({
      connected: false,
      isActive: false,
      status: "OfflineNoSavedTimer",
      remainingSeconds: 0,
      shutdownRemainingSeconds: getShutdownRemainingSeconds(),
    });

    return;
  }

  let active = lastKnownTimer.isActive === true;
  let remaining = getTimerRemainingSeconds(lastKnownTimer);

  if (active && remaining <= 0) {
    active = false;

    lastKnownTimer = {
      ...lastKnownTimer,
      isActive: false,
      endsAtUtc: null,
      remainingSeconds: 0,
      status: "ExpiredOffline",
    };

    saveLocalCache();
  }

  if (active) {
    cancelShutdownCountdown();
    setMode("active");
  } else {
    startShutdownCountdownIfNeeded();
    setMode("locked");
  }

  sendTimerUpdate({
    connected: false,
    isActive: active,
    status: active ? "Offline" : "Offline",
    remainingSeconds: active ? remaining : 0,
    shutdownRemainingSeconds: active
      ? null
      : getShutdownRemainingSeconds(),
    serverTimeUtc: lastKnownTimer.serverTimeUtc || null,
  });
}

// ======================================================
// SERVER STATE
// ======================================================

function applyServerTimer(timer) {
  const rawRemaining = Math.max(
    0,
    Number(timer.remainingSeconds) || 0
  );

  let endsAtUtc = timer.endsAtUtc || null;
  let remaining = rawRemaining;

  if (endsAtUtc) {
    const endMs = Date.parse(endsAtUtc);

    if (Number.isFinite(endMs)) {
      remaining = Math.max(
        0,
        Math.ceil((endMs - Date.now()) / 1000)
      );
    }
  }

  const active =
    timer.isActive === true &&
    timer.status !== "ShutdownRequested" &&
    remaining > 0;

  if (active && !endsAtUtc) {
    const serverNow = timer.serverTimeUtc
      ? Date.parse(timer.serverTimeUtc)
      : Date.now();

    if (Number.isFinite(serverNow)) {
      endsAtUtc = new Date(
        serverNow + remaining * 1000
      ).toISOString();
    }
  }

  lastKnownTimer = {
    isActive: active,
    endsAtUtc: active ? endsAtUtc : null,
    status: timer.status || "Unknown",
    remainingSeconds: active ? remaining : 0,
    serverTimeUtc: timer.serverTimeUtc || null,
  };

  serverConnected = true;

  if (active) {
    cancelShutdownCountdown();
    setMode("active");
  } else {
    startShutdownCountdownIfNeeded();
    setMode("locked");
  }

  saveLocalCache();

  sendTimerUpdate({
    connected: true,
    isActive: active,
    status: lastKnownTimer.status,
    remainingSeconds: active
      ? getTimerRemainingSeconds(lastKnownTimer)
      : 0,
    shutdownRemainingSeconds: active
      ? null
      : getShutdownRemainingSeconds(),
    serverTimeUtc: lastKnownTimer.serverTimeUtc,
  });
}

// ======================================================
// SERVER POLLING
// ======================================================

async function fetchTimer() {
  if (isFetching || shutdownInitiated) return;

  if (!API_BASE_URL || !DESKTOP_API_KEY) {
    console.error("Missing API_BASE_URL or DESKTOP_API_KEY.");
    applyOfflineState();
    return;
  }

  isFetching = true;

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/desktop/timer`,
      {
        method: "GET",
        headers: {
          "X-Device-Key": DESKTOP_API_KEY,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      const body = await response.text();

      throw new Error(
        `HTTP ${response.status}: ${body.slice(0, 200)}`
      );
    }

    const timer = await response.json();

    console.log("Connected to timer server.");
    console.log("Server status:", timer.status);
    console.log("Server active:", timer.isActive);
    console.log("Server remaining:", timer.remainingSeconds);

    applyServerTimer(timer);
  } catch (error) {
    console.error("Server unavailable:", error.message);
    applyOfflineState();
  } finally {
    isFetching = false;
  }
}

// ======================================================
// VOUCHER REDEMPTION
// ======================================================

ipcMain.handle("voucher:redeem", async (_event, rawCode) => {
  if (typeof rawCode !== "string") {
    return {
      success: false,
      message: "Please enter a valid voucher code.",
    };
  }

  const code = rawCode.trim().toUpperCase();

  if (code.length < 8 || code.length > 40) {
    return {
      success: false,
      message: "Please check your voucher code.",
    };
  }

  if (!API_BASE_URL || !DESKTOP_API_KEY) {
    return {
      success: false,
      message: "The voucher service is not configured.",
    };
  }

  if (!desktopDeviceId) {
    return {
      success: false,
      message: "Unable to identify this computer. Restart the app.",
    };
  }

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/desktop/vouchers/redeem`,
      {
        method: "POST",
        headers: {
          "X-Device-Key": DESKTOP_API_KEY,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          code,
          deviceId: desktopDeviceId,
        }),
        signal: AbortSignal.timeout(15000),
      }
    );

    const responseText = await response.text();

    let result = {};

    try {
      result = responseText ? JSON.parse(responseText) : {};
    } catch {
      result = {};
    }

    if (!response.ok) {
      return {
        success: false,
        message:
          result.message ||
          (response.status === 401
            ? "Desktop authorization failed."
            : response.status === 400
              ? "Invalid or already-used voucher."
              : `Voucher redemption failed (${response.status}).`),
      };
    }

    await fetchTimer();

    return {
      success: true,
      message: result.message || "Voucher redeemed successfully!",
      data: result,
    };
  } catch (error) {
    console.error("Voucher redemption failed:", error.message);

    return {
      success: false,
      message:
        "Cannot contact the voucher server. Check your internet connection and try again.",
    };
  }
});

// ======================================================
// LOCAL COUNTDOWN
// ======================================================

function initiateShutdown() {
  if (shutdownInitiated) return;

  if (!ENABLE_WINDOWS_SHUTDOWN) {
    console.warn(
      "Grace period ended. Windows shutdown is disabled for testing."
    );

    shutdownDeadlineMs = null;
    saveLocalCache();

    sendTimerUpdate({
      connected: serverConnected,
      isActive: false,
      status: "GracePeriodEnded",
      remainingSeconds: 0,
      shutdownRemainingSeconds: 0,
    });

    return;
  }

  shutdownInitiated = true;

  console.warn("Grace period ended. Shutting down Windows.");

  sendTimerUpdate({
    connected: serverConnected,
    isActive: false,
    status: "ShuttingDown",
    remainingSeconds: 0,
    shutdownRemainingSeconds: 0,
  });

  execFile("shutdown.exe", ["/s", "/t", "0"], (error) => {
    if (error) {
      console.error("Windows shutdown failed:", error.message);

      shutdownInitiated = false;

      sendTimerUpdate({
        connected: serverConnected,
        isActive: false,
        status: "ShutdownFailed",
        remainingSeconds: 0,
        shutdownRemainingSeconds: 0,
      });
    }
  });
}

function updateCountdown() {
  if (shutdownInitiated) return;

  if (lastKnownTimer && lastKnownTimer.isActive === true) {
    const remaining = getTimerRemainingSeconds(lastKnownTimer);

    if (remaining <= 0) {
      lastKnownTimer = {
        ...lastKnownTimer,
        isActive: false,
        endsAtUtc: null,
        remainingSeconds: 0,
        status: "Expired",
      };

      saveLocalCache();

      startShutdownCountdownIfNeeded();
      setMode("locked");

      sendTimerUpdate({
        connected: serverConnected,
        isActive: false,
        status: "Expired",
        remainingSeconds: 0,
        shutdownRemainingSeconds: getShutdownRemainingSeconds(),
      });

      return;
    }

    sendTimerUpdate({
      connected: serverConnected,
      isActive: true,
      status: serverConnected ? lastKnownTimer.status : "Offline",
      remainingSeconds: remaining,
      shutdownRemainingSeconds: null,
      serverTimeUtc: lastKnownTimer.serverTimeUtc,
    });

    return;
  }

  // Grace period is local. It does not require internet access.
  startShutdownCountdownIfNeeded();

  const remaining = getShutdownRemainingSeconds();

  console.log("Local grace countdown:", remaining);

  if (remaining <= 0) {
    initiateShutdown();
    return;
  }

  sendTimerUpdate({
    connected: serverConnected,
    isActive: false,
    status: serverConnected ? "Inactive" : "Offline",
    remainingSeconds: 0,
    shutdownRemainingSeconds: remaining,
  });
}

// ======================================================
// WINDOW RESIZE
// ======================================================

ipcMain.on("timer:resize", (_event, size) => {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    currentMode !== "active"
  ) {
    return;
  }

  const width = Number(size?.width);
  const height = Number(size?.height);

  const allowedSizes = [
    [42, 44],
    [230, 80],
    [390, 310],
  ];

  const allowed = allowedSizes.some(
    ([allowedWidth, allowedHeight]) =>
      width === allowedWidth && height === allowedHeight
  );

  if (!allowed) return;

  const area = screen.getPrimaryDisplay().workArea;
  const bounds = mainWindow.getBounds();

  mainWindow.setBounds({
    x: Math.min(
      Math.max(bounds.x, area.x),
      area.x + area.width - width
    ),
    y: Math.min(
      Math.max(bounds.y, area.y),
      area.y + area.height - height
    ),
    width,
    height,
  });
});

// ======================================================
// APP CLOSE
// ======================================================

ipcMain.on("app:close", () => {
  allowApplicationClose = true;
  app.quit();
});

// ======================================================
// STARTUP
// ======================================================

app.whenReady().then(() => {
  cachePath = path.join(
    app.getPath("userData"),
    "timer-cache.json"
  );

  deviceIdPath = path.join(
    app.getPath("userData"),
    "desktop-device-id.txt"
  );

  console.log("Local cache path:", cachePath);
  console.log("Timer API URL:", API_BASE_URL);
  console.log("Desktop API key loaded:", Boolean(DESKTOP_API_KEY));
  console.log("Windows shutdown enabled:", ENABLE_WINDOWS_SHUTDOWN);

  loadOrCreateDeviceId();
  loadLocalCache();

  createWindow();

  // Apply cached/offline state immediately without waiting for the server.
  applyOfflineState();

  // Run the local countdown independently from server polling.
  countdownInterval = setInterval(() => {
    updateCountdown();
  }, 1000);

  // Server updates are additional, not required for the local countdown.
  fetchTimer();

  pollingInterval = setInterval(() => {
    fetchTimer();
  }, POLLING_INTERVAL_MS);
});

// ======================================================
// CLEANUP
// ======================================================

app.on("before-quit", () => {
  allowApplicationClose = true;

  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }

  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  saveLocalCache();
});

app.on("window-all-closed", () => {
  // Keep application lifecycle under explicit control.
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();

    // Reapply current state to the recreated window.
    if (lastKnownTimer) {
      applyOfflineState();
    } else {
      fetchTimer();
    }
  }
});
