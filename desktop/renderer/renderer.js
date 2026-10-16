const ADMIN_PASSWORD = "Admin@123"; // Demo only

const lockScreen = document.getElementById("lockScreen");
const activeScreen = document.getElementById("activeScreen");

const connection = document.getElementById("connection");
const connectionText = document.getElementById("connectionText");

const countdown = document.getElementById("countdown");
const activeCountdown = document.getElementById("activeCountdown");

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

let currentMode = "locked";
let latestData = {
  connected: false,
  isActive: false,
  remainingSeconds: 0,
  shutdownRemainingSeconds: null,
};

let displayTimer = null;
let lastUpdateTime = Date.now();

function formatTime(totalSeconds) {
  if (
    totalSeconds === null ||
    totalSeconds === undefined ||
    !Number.isFinite(Number(totalSeconds))
  ) {
    return "--:--";
  }

  const seconds = Math.max(0, Math.floor(Number(totalSeconds)));

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

  const seconds = Math.max(0, Math.floor(Number(totalSeconds)));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return [
    String(minutes).padStart(2, "0"),
    String(remainingSeconds).padStart(2, "0"),
  ].join(":");
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

  lockScreen.hidden = mode === "active";
  activeScreen.hidden = mode !== "active";

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

  if (latestData.connected) {
    connectionText.textContent = "Connected to server";
  } else {
    connectionText.textContent = "Server disconnected";
  }
}

function renderStatus() {
  renderConnection();

  if (currentMode === "active" && latestData.isActive) {
    activeCountdown.textContent = formatTime(
      getCurrentActiveRemainingSeconds()
    );

    return;
  }

  if (!latestData.connected) {
    countdown.textContent = "--:--";
    status.textContent = "Shutdown paused: server unavailable.";
    lockDescription.textContent =
      "The timer status cannot be verified. Automatic shutdown is paused.";
    return;
  }

  if (
    latestData.status === "ShutdownFailed"
  ) {
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
    "No active timer was detected. The PC will shut down when the countdown ends.";
}

function getCurrentActiveRemainingSeconds() {
  const elapsed = Math.floor(
    (Date.now() - lastUpdateTime) / 1000
  );

  return Math.max(
    0,
    (Number(latestData.remainingSeconds) || 0) - elapsed
  );
}

function getCurrentShutdownRemainingSeconds() {
  if (
    !latestData.connected ||
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

function handleTimerUpdate(data) {
  latestData = {
    ...latestData,
    ...data,
  };

  lastUpdateTime = Date.now();

  if (latestData.connected && latestData.isActive) {
    setMode("active");
  } else {
    setMode("locked");
  }

  renderStatus();
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

  // This is demo-only administrator access.
  // It does not unlock Windows or disable Windows security.
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

window.timerAPI.onMode((mode) => {
  setMode(mode);
});

window.timerAPI.onUpdate((data) => {
  handleTimerUpdate(data);
});

displayTimer = setInterval(() => {
  renderStatus();
}, 250);

window.addEventListener("beforeunload", () => {
  if (displayTimer) {
    clearInterval(displayTimer);
  }
});