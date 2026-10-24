
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

// ======================================================
// ENVIRONMENT CONFIGURATION
// ======================================================

dotenv.config({
  path: path.join(__dirname, ".env"),
});

const API_BASE_URL = (
  process.env.API_BASE_URL ||
  "https://pctimer.onrender.com"
).replace(/\/+$/, "");

const DESKTOP_API_KEY = process.env.DESKTOP_API_KEY;

// ======================================================
// SETTINGS
// ======================================================

const LOCK_GRACE_PERIOD_SECONDS = 120;
const POLLING_INTERVAL_MS = 5000;

const FLOATING_WIDTH = 230;
const FLOATING_HEIGHT = 80;
const FLOATING_MARGIN = 12;

// Local cache stored in the user's application data folder.
let cachePath = null;

let mainWindow = null;
let pollingInterval = null;
let countdownInterval = null;

let isFetching = false;
let currentMode = null;

let shutdownDeadlineMs = null;
let shutdownInitiated = false;
let allowApplicationClose = false;

// Last successfully received server timer.
let lastKnownTimer = null;

// Whether the most recent server request succeeded.
let serverConnected = false;

// ======================================================
// LOCAL TIMER CACHE
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
    console.error(
      "Unable to save local timer cache:",
      error.message
    );
  }
}

function loadLocalCache() {
  if (!cachePath) return false;

  try {
    if (!fs.existsSync(cachePath)) {
      console.log("No previous local timer cache found.");
      return false;
    }

    const raw = fs.readFileSync(cachePath, "utf8");
    const data = JSON.parse(raw);

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
    console.error(
      "Unable to load local timer cache:",
      error.message
    );
  }

  return false;
}

// ======================================================
// COUNTDOWN HELPERS
// ======================================================

function getTimerRemainingSeconds(timer) {
  if (!timer || !timer.isActive) {
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
  if (
    shutdownDeadlineMs !== null ||
    shutdownInitiated
  ) {
    return;
  }

  shutdownDeadlineMs =
    Date.now() + LOCK_GRACE_PERIOD_SECONDS * 1000;

  saveLocalCache();

  console.log("Local shutdown grace period started.");
}

function cancelShutdownCountdown() {
  shutdownDeadlineMs = null;
  saveLocalCache();
}

function getShutdownRemainingSeconds() {
  if (shutdownDeadlineMs === null) {
    return null;
  }

  return Math.max(
    0,
    Math.ceil(
      (shutdownDeadlineMs - Date.now()) / 1000
    )
  );
}

// ======================================================
// ELECTRON WINDOW
// ======================================================

function createWindow() {
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
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (!serverConnected) {
      applyOfflineState();
    }

    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
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

  mainWindow.loadFile(
    path.join(__dirname, "renderer", "index.html")
  ).catch((error) => {
    console.error("Unable to load renderer:", error.message);
  });
}

// ======================================================
// WINDOW MODES
// ======================================================

function setMode(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (currentMode === mode) {
    return;
  }

  currentMode = mode;

  if (mode === "active") {
    // Active timer: small floating window.
    mainWindow.setKiosk(false);
    mainWindow.setFullScreen(false);

    const area = screen.getPrimaryDisplay().workArea;

    mainWindow.setBounds({
      x:
        area.x +
        area.width -
        FLOATING_WIDTH -
        FLOATING_MARGIN,
      y:
        area.y +
        area.height -
        FLOATING_HEIGHT -
        FLOATING_MARGIN,
      width: FLOATING_WIDTH,
      height: FLOATING_HEIGHT,
    });

    mainWindow.setSkipTaskbar(true);
    mainWindow.setAlwaysOnTop(true, "screen-saver");
    mainWindow.show();
  } else {
    // Inactive timer: lock interface.
    mainWindow.setKiosk(false);
    mainWindow.setFullScreen(false);

    const bounds = screen.getPrimaryDisplay().bounds;

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

  mainWindow.webContents.send("timer:mode", mode);
}

// ======================================================
// SEND STATE TO THE RENDERER
// ======================================================

function sendTimerUpdate(data) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("timer:update", data);
}

// ======================================================
// APPLY LAST SAVED TIMER WHEN OFFLINE
// ======================================================

function applyOfflineState() {
  serverConnected = false;

  // No saved timer means we cannot safely guess
  // whether a timer is active or should shut down.
  if (!lastKnownTimer) {
    cancelShutdownCountdown();
    setMode("locked");

    sendTimerUpdate({
      connected: false,
      isActive: false,
      status: "OfflineNoSavedTimer",
      remainingSeconds: 0,
      shutdownRemainingSeconds: null,
    });

    return;
  }

  let active = lastKnownTimer.isActive === true;
  let remaining = getTimerRemainingSeconds(lastKnownTimer);

  // An active timer may have expired while offline.
  if (active && remaining <= 0) {
    active = false;

    lastKnownTimer = {
      ...lastKnownTimer,
      isActive: false,
      remainingSeconds: 0,
      status: "ExpiredOffline",
    };

    saveLocalCache();
  }

  if (active) {
    // Resume the last known active timer.
    cancelShutdownCountdown();
    setMode("active");
  } else {
    // Continue the saved grace countdown, or start one
    // if the saved timer has expired / was inactive.
    startShutdownCountdownIfNeeded();
    setMode("locked");
  }

  sendTimerUpdate({
    connected: false,
    isActive: active,
    status: "Offline",
    remainingSeconds: remaining,
    shutdownRemainingSeconds:
      active ? null : getShutdownRemainingSeconds(),
    serverTimeUtc: lastKnownTimer.serverTimeUtc || null,
  });
}

// ======================================================
// APPLY LATEST SERVER TIMER
// ======================================================

function applyServerTimer(timer) {
  const remaining = Math.max(
    0,
    Number(timer.remainingSeconds) || 0
  );

  const active =
    timer.isActive === true &&
    timer.status !== "ShutdownRequested" &&
    remaining > 0;

  let endsAtUtc = timer.endsAtUtc || null;

  // If the API doesn't provide endsAtUtc, calculate
  // it using server time when available.
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
    endsAtUtc,
    status: timer.status || "Unknown",
    remainingSeconds: remaining,
    serverTimeUtc: timer.serverTimeUtc || null,
  };

  serverConnected = true;

  if (active) {
    // The latest server timer takes priority.
    cancelShutdownCountdown();
    setMode("active");
  } else {
    // Continue an existing grace period if one exists.
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
    shutdownRemainingSeconds:
      active ? null : getShutdownRemainingSeconds(),
    serverTimeUtc: lastKnownTimer.serverTimeUtc,
  });
}

// ======================================================
// FETCH SERVER TIMER
// ======================================================

async function fetchTimer() {
  if (isFetching || shutdownInitiated) {
    return;
  }

  if (!API_BASE_URL || !DESKTOP_API_KEY) {
    console.error(
      "Missing API_BASE_URL or DESKTOP_API_KEY."
    );

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

    // Always follow the latest successful server response.
    applyServerTimer(timer);
  } catch (error) {
    console.error(
      "Server unavailable; using local timer cache:",
      error.message
    );

    applyOfflineState();
  } finally {
    isFetching = false;
  }
}

// ======================================================
// LOCAL COUNTDOWN AND SHUTDOWN
// ======================================================

function initiateShutdown() {
  if (shutdownInitiated) {
    return;
  }

  shutdownInitiated = true;

  console.warn("Shutdown countdown finished.");

  sendTimerUpdate({
    connected: serverConnected,
    isActive: false,
    status: "ShuttingDown",
    remainingSeconds: 0,
    shutdownRemainingSeconds: 0,
  });

  // Windows will shut down immediately.
  // Test carefully and save any open work first.
  execFile(
    "shutdown.exe",
    ["/s", "/t", "0"],
    (error) => {
      if (error) {
        console.error(
          "Windows shutdown command failed:",
          error.message
        );

        shutdownInitiated = false;

        sendTimerUpdate({
          connected: serverConnected,
          isActive: false,
          status: "ShutdownFailed",
          remainingSeconds: 0,
          shutdownRemainingSeconds: 0,
        });
      }
    }
  );
}

function updateCountdown() {
  if (shutdownInitiated) {
    return;
  }

  // Update active countdown using the absolute expiry time.
  if (lastKnownTimer && lastKnownTimer.isActive) {
    const remaining =
      getTimerRemainingSeconds(lastKnownTimer);

    if (remaining <= 0) {
      lastKnownTimer = {
        ...lastKnownTimer,
        isActive: false,
        remainingSeconds: 0,
        status: "Expired",
      };

      saveLocalCache();

      startShutdownCountdownIfNeeded();
      setMode("locked");

      sendTimerUpdate({
        connected: serverConnected,
        isActive: false,
        status: serverConnected ? "Expired" : "Offline",
        remainingSeconds: 0,
        shutdownRemainingSeconds:
          getShutdownRemainingSeconds(),
      });

      return;
    }

    sendTimerUpdate({
      connected: serverConnected,
      isActive: true,
      status: serverConnected
        ? lastKnownTimer.status
        : "Offline",
      remainingSeconds: remaining,
      shutdownRemainingSeconds: null,
      serverTimeUtc: lastKnownTimer.serverTimeUtc,
    });

    return;
  }

  const shutdownRemaining = getShutdownRemainingSeconds();

  if (shutdownRemaining === null) {
    return;
  }

  if (shutdownRemaining <= 0) {
    initiateShutdown();
    return;
  }

  sendTimerUpdate({
    connected: serverConnected,
    isActive: false,
    status: serverConnected ? "Inactive" : "Offline",
    remainingSeconds: 0,
    shutdownRemainingSeconds: shutdownRemaining,
  });
}


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

  // Only allow the intended timer and warning sizes.
  const allowedSizes = [
    [42, 44],
    [230, 80],
    [390, 310],
  ];

  const allowed = allowedSizes.some(
    ([allowedWidth, allowedHeight]) =>
      width === allowedWidth && height === allowedHeight
  );

  if (!allowed) {
    return;
  }

  const area = screen.getPrimaryDisplay().workArea;
  const currentBounds = mainWindow.getBounds();

  // Keep the resized timer inside the screen.
  const x = Math.min(
    Math.max(currentBounds.x, area.x),
    area.x + area.width - width
  );

  const y = Math.min(
    Math.max(currentBounds.y, area.y),
    area.y + area.height - height
  );

  mainWindow.setBounds({
    x,
    y,
    width,
    height,
  });
});


// ======================================================
// ADMIN CLOSE BUTTON
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

  console.log("Local cache path:", cachePath);
  console.log("Timer API URL:", API_BASE_URL);
  console.log(
    "Desktop API key loaded:",
    Boolean(DESKTOP_API_KEY)
  );

  // Restore the last known timer before contacting server.
  loadLocalCache();

  createWindow();

  // Use cached timer immediately while the server connects.
  applyOfflineState();

  // Server state overrides the cache when reachable.
  fetchTimer();

  pollingInterval = setInterval(() => {
    fetchTimer();
  }, POLLING_INTERVAL_MS);

  countdownInterval = setInterval(() => {
    updateCountdown();
  }, 1000);
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
  // The application manages its own lifecycle.
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
