require("dotenv").config();

const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
} = require("electron");

const { execFile } = require("child_process");
const path = require("path");

// ======================================================
// WINDOW AND APPLICATION STATE
// ======================================================

let mainWindow = null;
let pollingInterval = null;
let countdownInterval = null;

let isFetching = false;
let currentMode = null;

let shutdownDeadlineMs = null;
let shutdownInitiated = false;

// Allows the app to close after the admin uses
// the application's Close Application button.
let allowApplicationClose = false;

// ======================================================
// CONFIGURATION
// ======================================================

const LOCK_GRACE_PERIOD_SECONDS = 120; // 2 minutes
const POLLING_INTERVAL_MS = 5000;

const FLOATING_WIDTH = 230;
const FLOATING_HEIGHT = 80;
const FLOATING_MARGIN = 12;

const API_BASE_URL = process.env.API_BASE_URL;
const DESKTOP_API_KEY = process.env.DESKTOP_API_KEY;

// ======================================================
// CREATE ELECTRON WINDOW
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

  // IMPORTANT:
  // The close handler must be registered AFTER
  // mainWindow has been created.
  // This fixes the null .on() error.
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

    setMode("locked");
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadFile(
    path.join(__dirname, "renderer", "index.html")
  );
}

// ======================================================
// CHANGE WINDOW MODE
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
    // ----------------------------------------------
    // ACTIVE SESSION: SMALL FLOATING COUNTDOWN
    // ----------------------------------------------

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
    // ----------------------------------------------
    // NO ACTIVE SESSION: FULL-SCREEN LOCK INTERFACE
    // ----------------------------------------------

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
// SHUTDOWN COUNTDOWN
// ======================================================

function startShutdownCountdownIfNeeded() {
  if (
    shutdownDeadlineMs !== null ||
    shutdownInitiated
  ) {
    return;
  }

  shutdownDeadlineMs =
    Date.now() + LOCK_GRACE_PERIOD_SECONDS * 1000;
}

function cancelShutdownCountdown() {
  shutdownDeadlineMs = null;
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
// WINDOWS SHUTDOWN
// ======================================================

function initiateShutdown() {
  if (shutdownInitiated) {
    return;
  }

  shutdownInitiated = true;

  console.log("Shutdown countdown finished.");

  sendTimerUpdate({
    connected: true,
    isActive: false,
    status: "ShuttingDown",
    remainingSeconds: 0,
    shutdownRemainingSeconds: 0,
  });

  // Windows shutdown command.
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
          connected: true,
          isActive: false,
          status: "ShutdownFailed",
          remainingSeconds: 0,
          shutdownRemainingSeconds: 0,
        });
      }
    }
  );
}

// ======================================================
// SEND TIMER DATA TO THE RENDERER
// ======================================================

function sendTimerUpdate(data) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("timer:update", data);
}

// ======================================================
// CHECK TIMER API
// ======================================================

async function fetchTimer() {
  if (isFetching || shutdownInitiated) {
    return;
  }

  if (!API_BASE_URL || !DESKTOP_API_KEY) {
    console.error(
      "Missing API_BASE_URL or DESKTOP_API_KEY in desktop/.env"
    );

    cancelShutdownCountdown();
    setMode("locked");

    sendTimerUpdate({
      connected: false,
      isActive: false,
      status: "Disconnected",
      remainingSeconds: 0,
      shutdownRemainingSeconds: null,
    });

    return;
  }

  isFetching = true;

  try {
    const response = await fetch(
      `${API_BASE_URL.replace(/\/+$/, "")}/api/desktop/timer`,
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
      throw new Error(
        `Timer API returned HTTP ${response.status}`
      );
    }

    const timer = await response.json();

    const remaining = Math.max(
      0,
      Number(timer.remainingSeconds) || 0
    );

    const active =
      timer.isActive === true &&
      timer.status !== "ShutdownRequested" &&
      remaining > 0;

    if (active) {
      // Active session found:
      // cancel the shutdown countdown.
      cancelShutdownCountdown();
      setMode("active");
    } else {
      // No active session:
      // switch to lock interface and start 2 minutes.
      startShutdownCountdownIfNeeded();
      setMode("locked");
    }

    sendTimerUpdate({
      connected: true,
      isActive: active,
      status: timer.status || "Unknown",
      remainingSeconds: remaining,
      shutdownRemainingSeconds:
        active ? null : getShutdownRemainingSeconds(),
      serverTimeUtc: timer.serverTimeUtc || null,
    });
  } catch (error) {
    console.error(
      "Unable to retrieve timer status:",
      error.message
    );

    // IMPORTANT:
    // If the backend cannot be reached, do not shut
    // down because the session status is unknown.
    cancelShutdownCountdown();
    setMode("locked");

    sendTimerUpdate({
      connected: false,
      isActive: false,
      status: "Disconnected",
      remainingSeconds: 0,
      shutdownRemainingSeconds: null,
    });
  } finally {
    isFetching = false;
  }
}

// ======================================================
// UPDATE THE COUNTDOWN EVERY SECOND
// ======================================================

function updateCountdown() {
  if (shutdownInitiated) {
    return;
  }

  const remaining = getShutdownRemainingSeconds();

  if (remaining === null) {
    return;
  }

  if (remaining <= 0) {
    initiateShutdown();
    return;
  }

  sendTimerUpdate({
    connected: true,
    isActive: false,
    shutdownRemainingSeconds: remaining,
  });
}

// ======================================================
// ADMIN APPLICATION CLOSE BUTTON
// ======================================================

ipcMain.on("app:close", () => {
  // This event comes from the application's
  // Administrator Access interface.
  allowApplicationClose = true;

  app.quit();
});

// ======================================================
// APPLICATION STARTUP
// ======================================================

app.whenReady().then(() => {
  createWindow();

  // Check the server immediately.
  fetchTimer();

  // Check the server every 5 seconds.
  pollingInterval = setInterval(() => {
    fetchTimer();
  }, POLLING_INTERVAL_MS);

  // Update shutdown countdown every second.
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
});

app.on("window-all-closed", () => {
  // Do not automatically quit just because the
  // window was closed. The application manages its
  // own lifecycle.
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});