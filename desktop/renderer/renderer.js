
const ADMIN_PASSWORD = "Admin@123"; // Demo only
const voucherForm = document.getElementById("voucherForm");
const voucherCode = document.getElementById("voucherCode");
const redeemVoucherButton = document.getElementById(
  "redeemVoucherButton"
);
const voucherMessage = document.getElementById("voucherMessage");

const lockScreen = document.getElementById("lockScreen");
const activeScreen = document.getElementById("activeScreen");
const timerHeader = document.getElementById("timerHeader");
const compactScreen = document.getElementById("compactScreen");

const connection = document.getElementById("connection");
const connectionText = document.getElementById("connectionText");

const countdown = document.getElementById("countdown");
const activeCountdown = document.getElementById("activeCountdown");
const activeStatus = document.getElementById("activeStatus");

const status = document.getElementById("status");
const lockDescription = document.getElementById("lockDescription");

const adminButton = document.getElementById("adminButton");
const adminPanel = document.getElementById("adminPanel");
const adminPassword = document.getElementById("adminPassword");
const adminError = document.getElementById("adminError");
const adminLoginButton = document.getElementById("adminLoginButton");
const cancelAdminButton = document.getElementById("cancelAdminButton");

const maintenancePanel = document.getElementById("maintenancePanel");
const closeAppButton = document.getElementById("closeAppButton");
const relockButton = document.getElementById("relockButton");

const collapseButton = document.getElementById("collapseButton");
const expandButton = document.getElementById("expandButton");

const warningModal = document.getElementById("warningModal");
const warningDialog = document.getElementById("warningDialog");
const warningIcon = document.getElementById("warningIcon");
const warningTitle = document.getElementById("warningTitle");
const warningMessage = document.getElementById("warningMessage");
const warningTime = document.getElementById("warningTime");
const dismissWarningButton = document.getElementById("dismissWarningButton");

let currentMode = "locked";
let isCollapsed = false;
let warningOpen = false;

let latestData = {
  connected: false,
  isActive: false,
  remainingSeconds: 0,
  shutdownRemainingSeconds: null,
  status: "Connecting",
};

let lastUpdateTime = Date.now();
let displayTimer = null;

// These flags prevent duplicate alerts caused by frequent updates.
let warnedFiveMinutes = false;
let warnedThirtySeconds = false;
let previousActive = false;

function formatTime(totalSeconds) {
  if (
    totalSeconds === null ||
    totalSeconds === undefined ||
    !Number.isFinite(Number(totalSeconds))
  ) {
    return "--:--";
  }

  const seconds = Math.max(0, Math.ceil(Number(totalSeconds)));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(remainingSeconds).padStart(2, "0"),
  ].join(":");
}

function formatShutdownTime(totalSeconds) {
  if (
    totalSeconds === null ||
    totalSeconds === undefined ||
    !Number.isFinite(Number(totalSeconds))
  ) {
    return "--:--";
  }

  const seconds = Math.max(0, Math.ceil(Number(totalSeconds)));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return [
    String(minutes).padStart(2, "0"),
    String(remainingSeconds).padStart(2, "0"),
  ].join(":");
}

function getCurrentActiveRemainingSeconds() {
  const elapsed = Math.floor(
    (Date.now() - lastUpdateTime) / 1000
  );

  return Math.max(
    0,
    Number(latestData.remainingSeconds || 0) - elapsed
  );
}

function getCurrentShutdownRemainingSeconds() {
  if (
    latestData.shutdownRemainingSeconds === null ||
    latestData.shutdownRemainingSeconds === undefined
  ) {
    return null;
  }

  const elapsed = Math.floor(
    (Date.now() - lastUpdateTime) / 1000
  );

  return Math.max(
    0,
    Number(latestData.shutdownRemainingSeconds) - elapsed
  );
}

function requestWindowSize(width, height) {
  if (window.timerAPI?.resizeWindow) {
    window.timerAPI.resizeWindow(width, height);
  }
}

function setMode(mode) {
  currentMode = mode;

  document.body.classList.toggle(
    "active-mode",
    mode === "active"
  );

  document.body.classList.toggle(
    "locked-mode",
    mode !== "active"
  );

  // Keep the draggable header for the floating timer only.
  timerHeader.hidden = mode !== "active";

  lockScreen.hidden = mode === "active";
  activeScreen.hidden = mode !== "active";

  if (mode !== "active") {
    isCollapsed = false;
    document.body.classList.remove("compact-mode");
    compactScreen.hidden = true;

    if (warningOpen) {
      closeWarning(false);
    }
  }

  renderStatus();
}

function renderConnection() {
  connection.classList.toggle(
    "connected",
    latestData.connected
  );

  connection.classList.toggle(
    "disconnected",
    !latestData.connected
  );

  connectionText.textContent = latestData.connected
    ? "Connected to server"
    : "Offline mode";
}

function renderStatus() {
  renderConnection();

  // Active timer: display the remaining session time.
  if (currentMode === "active" && latestData.isActive) {
    const remaining = getCurrentActiveRemainingSeconds();

    activeCountdown.textContent = formatTime(remaining);

    activeStatus.textContent = latestData.connected
      ? "Connected to server"
      : "Offline timer running";

    checkWarnings(remaining);
    return;
  }

  // Offline mode: keep showing the LOCAL shutdown countdown.
  // Do not replace it with "--:--" just because the server is unavailable.
  if (!latestData.connected) {
    const shutdownRemaining = getCurrentShutdownRemainingSeconds();

    countdown.textContent =
      shutdownRemaining === null
        ? "--:--"
        : formatShutdownTime(shutdownRemaining);

    status.textContent = "Offline mode";

    lockDescription.textContent =
      shutdownRemaining === null
        ? "Waiting for the local shutdown countdown..."
        : "The local shutdown countdown continues even without internet.";

    return;
  }

  if (latestData.status === "ShutdownFailed") {
    countdown.textContent = "00:00";
    status.textContent = "Automatic shutdown failed.";
    lockDescription.textContent =
      "Please contact the administrator.";
    return;
  }

  if (latestData.status === "ShuttingDown") {
    countdown.textContent = "00:00";
    status.textContent = "PC shutdown requested.";
    lockDescription.textContent =
      "The computer is preparing to shut down.";
    return;
  }

  countdown.textContent = formatShutdownTime(
    getCurrentShutdownRemainingSeconds()
  );

  status.textContent = "No active timer session.";
  lockDescription.textContent =
    "The PC will shut down when the shutdown countdown ends.";
}

function checkWarnings(remainingSeconds) {
  if (
    !latestData.isActive ||
    currentMode !== "active" ||
    !Number.isFinite(remainingSeconds)
  ) {
    return;
  }

  if (remainingSeconds <= 30 && !warnedThirtySeconds) {
    warnedThirtySeconds = true;
    warnedFiveMinutes = true;

    showWarning("thirty-seconds");
    return;
  }

  if (remainingSeconds <= 300 && !warnedFiveMinutes) {
    warnedFiveMinutes = true;
    showWarning("five-minutes");
  }
}

function showWarning(type) {
  warningOpen = true;
  warningModal.hidden = false;

  if (type === "thirty-seconds") {
    warningDialog.classList.add("warning-critical");
    warningIcon.textContent = "!";
    warningTitle.textContent = "30 seconds remaining!";
    warningMessage.textContent =
      "Your PC timer is almost finished. Save your work immediately.";
    warningTime.textContent = formatTime(
      getCurrentActiveRemainingSeconds()
    );
    dismissWarningButton.textContent = "I understand";
  } else {
    warningDialog.classList.remove("warning-critical");
    warningIcon.textContent = "!";
    warningTitle.textContent = "5 minutes remaining";
    warningMessage.textContent =
      "Your PC timer will finish in 5 minutes. Please save your work.";
    warningTime.textContent = formatTime(
      getCurrentActiveRemainingSeconds()
    );
    dismissWarningButton.textContent = "OK, I understand";
  }

  if (!isCollapsed) {
    requestWindowSize(390, 310);
  }

  dismissWarningButton.focus();
}

function closeWarning(restoreSize = true) {
  warningOpen = false;
  warningModal.hidden = true;

  if (restoreSize && currentMode === "active") {
    requestWindowSize(
      isCollapsed ? 42 : 230,
      isCollapsed ? 44 : 80
    );
  }
}

function handleTimerUpdate(data) {
  const wasActive = previousActive;

  latestData = {
    ...latestData,
    ...data,
  };

  lastUpdateTime = Date.now();

  const isActiveNow =
    latestData.isActive === true &&
    Number(latestData.remainingSeconds) > 0;

  if (isActiveNow && !wasActive) {
    // Reset alerts for a new active timer session.
    warnedFiveMinutes = false;
    warnedThirtySeconds = false;
  }

  if (!isActiveNow && wasActive) {
    warnedFiveMinutes = false;
    warnedThirtySeconds = false;

    if (warningOpen) {
      closeWarning(false);
    }
  }

  previousActive = isActiveNow;

  if (isActiveNow) {
    setMode("active");
  } else {
    setMode("locked");
  }

  renderStatus();
}

function collapseTimer() {
  if (currentMode !== "active" || isCollapsed) {
    return;
  }

  isCollapsed = true;
  document.body.classList.add("compact-mode");

  compactScreen.hidden = false;
  lockScreen.hidden = true;
  activeScreen.hidden = true;
  timerHeader.hidden = true;

  if (warningOpen) {
    closeWarning(false);
  }

  requestWindowSize(42, 44);
}

function expandTimer() {
  if (!isCollapsed) {
    return;
  }

  isCollapsed = false;
  document.body.classList.remove("compact-mode");

  compactScreen.hidden = true;
  timerHeader.hidden = false;
  activeScreen.hidden = false;

  renderStatus();

  if (warningOpen) {
    requestWindowSize(390, 310);
  } else {
    requestWindowSize(230, 80);
  }
}

function openAdminPanel() {
  adminPanel.hidden = false;
  maintenancePanel.hidden = true;

  adminError.hidden = true;
  adminError.textContent = "";

  adminPassword.value = "";
  adminPassword.focus();
}

function closeAdminPanel() {
  adminPanel.hidden = true;
  adminError.hidden = true;
  adminPassword.value = "";
}

function verifyAdminPassword() {
  if (adminPassword.value !== ADMIN_PASSWORD) {
    adminError.textContent = "Incorrect administrator password.";
    adminError.hidden = false;
    adminPassword.select();
    return;
  }

  adminPanel.hidden = true;
  maintenancePanel.hidden = false;
  adminError.hidden = true;

  status.textContent = "Administrator access verified.";
}

adminButton.addEventListener("click", openAdminPanel);
cancelAdminButton.addEventListener("click", closeAdminPanel);
adminLoginButton.addEventListener("click", verifyAdminPassword);

adminPassword.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    verifyAdminPassword();
  }

  if (event.key === "Escape") {
    closeAdminPanel();
  }
});

closeAppButton.addEventListener("click", () => {
  window.timerAPI.closeApp();
});

relockButton.addEventListener("click", () => {
  maintenancePanel.hidden = true;
  adminPanel.hidden = true;
  adminPassword.value = "";
  renderStatus();
});

collapseButton.addEventListener("click", collapseTimer);
expandButton.addEventListener("click", expandTimer);

dismissWarningButton.addEventListener("click", () => {
  closeWarning(true);
});

window.timerAPI.onMode((mode) => {
  setMode(mode);
});

window.timerAPI.onUpdate((data) => {
  handleTimerUpdate(data);
});

displayTimer = setInterval(() => {
  renderStatus();

  if (warningOpen && !warningModal.hidden) {
    warningTime.textContent = formatTime(
      getCurrentActiveRemainingSeconds()
    );
  }
}, 250);

window.addEventListener("beforeunload", () => {
  if (displayTimer) {
    clearInterval(displayTimer);
  }
});


function showVoucherMessage(message, type) {
  voucherMessage.textContent = message;
  voucherMessage.className = `voucher-message ${type}`;
  voucherMessage.hidden = false;
}

function setVoucherLoading(isLoading) {
  redeemVoucherButton.disabled = isLoading;
  voucherCode.disabled = isLoading;

  redeemVoucherButton.textContent = isLoading
    ? "Validating voucher..."
    : "Redeem Voucher";
}

voucherForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const code = voucherCode.value.trim().toUpperCase();

  if (!code) {
    showVoucherMessage(
      "Please enter your voucher code.",
      "error"
    );
    voucherCode.focus();
    return;
  }

  if (!window.timerAPI?.redeemVoucher) {
    showVoucherMessage(
      "Voucher redemption is unavailable in this app version.",
      "error"
    );
    return;
  }

  setVoucherLoading(true);
  voucherMessage.hidden = true;

  try {
    const result = await window.timerAPI.redeemVoucher(code);

    if (!result?.success) {
      showVoucherMessage(
        result?.message || "Unable to redeem this voucher.",
        "error"
      );
      return;
    }

    voucherCode.value = "";

    showVoucherMessage(
      result.message || "Voucher redeemed successfully! Starting your timer...",
      "success"
    );

    status.textContent =
      "Voucher accepted. Updating timer from the server...";
  } catch (error) {
    console.error("Voucher UI error:", error);

    showVoucherMessage(
      "An unexpected error occurred. Please try again.",
      "error"
    );
  } finally {
    setVoucherLoading(false);
  }
});


