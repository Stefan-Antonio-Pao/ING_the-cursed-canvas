const { app, BrowserWindow, dialog, session, ipcMain, nativeImage } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

let mainWindow = null;
let backendProcess = null;
let backendReady = false;
let backendStartupExitPromise = null;
let backendBaseUrl = null;
const APP_ID = "com.cursedcanvas.game";
const ICON_CACHE_VERSION = "icon-gallery-20260705-clean-default";
const GAME_ICON_DEFAULT = "clean";
const DESKTOP_ICON_OPTIONS = {
  clean: { webPath: "/static/icons/clean.png" },
  concept: { webPath: "/static/icons/concept.png" },
  skeuomorphic: { webPath: "/static/icons/skeuomorphic.png" },
  flattened: { webPath: "/static/icons/flattened.png" }
};

function normalizeIconId(iconId) {
  return Object.prototype.hasOwnProperty.call(DESKTOP_ICON_OPTIONS, iconId) ? iconId : GAME_ICON_DEFAULT;
}

function inferIconIdFromPath(iconPath) {
  if (typeof iconPath !== "string") return "";
  return Object.keys(DESKTOP_ICON_OPTIONS).find((iconId) => iconPath.includes(`${iconId}.png`)) || "";
}

function preferredWebIconPath(iconId) {
  const normalizedIconId = normalizeIconId(iconId);
  return `${DESKTOP_ICON_OPTIONS[normalizedIconId].webPath}?v=${ICON_CACHE_VERSION}`;
}

function iconPreferencePath() {
  return path.join(app.getPath("userData"), "icon-preference.json");
}

function readDesktopIconPreference() {
  return normalizeIconId(readJsonIfExists(iconPreferencePath()).iconId);
}

function writeDesktopIconPreference(iconId) {
  const normalizedIconId = normalizeIconId(iconId);
  try {
    fs.mkdirSync(path.dirname(iconPreferencePath()), { recursive: true });
    fs.writeFileSync(iconPreferencePath(), JSON.stringify({ iconId: normalizedIconId }, null, 2), "utf8");
  } catch (err) {
    appendLog(`Icon preference save failed: ${err.message || String(err)}`);
  }
  return normalizedIconId;
}

function desktopIconAssetPath(iconId, extension) {
  const normalizedIconId = normalizeIconId(iconId);
  const preferredExtension = extension || (process.platform === "win32" ? "ico" : "png");
  const candidates = [
    path.join(__dirname, "..", "assets", "icons", `${normalizedIconId}.${preferredExtension}`),
    path.join(__dirname, "..", "assets", "icons", `${normalizedIconId}.png`),
    path.join(__dirname, "..", "assets", preferredExtension === "ico" ? "icon.ico" : "icon.png"),
    path.join(__dirname, "..", "assets", "icon.png")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function createNativeIconImage(iconId) {
  const iconPath = desktopIconAssetPath(iconId);
  if (!iconPath) return { image: nativeImage.createEmpty(), iconPath: null };
  return { image: nativeImage.createFromPath(iconPath), iconPath };
}

function parseIconRequest(iconRequest) {
  const iconPath = typeof iconRequest === "string"
    ? iconRequest
    : (iconRequest && typeof iconRequest.iconPath === "string" ? iconRequest.iconPath : "");
  const requestedIconId = iconRequest && typeof iconRequest === "object" ? iconRequest.iconId : "";
  const iconId = normalizeIconId(requestedIconId || inferIconIdFromPath(iconPath));
  return {
    iconId,
    iconPath: iconPath || preferredWebIconPath(iconId)
  };
}

function logPath() {
  return path.join(app.getPath("userData"), "desktop.log");
}

function appendLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.mkdirSync(path.dirname(logPath()), { recursive: true });
    fs.appendFileSync(logPath(), line, "utf8");
  } catch (_err) {
    // Logging must never block startup.
  }
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return {};
  }
}

function loadConfig() {
  const packagedConfigPath = path.join(process.resourcesPath || "", "desktop-config.json");
  const devConfigPath = path.join(__dirname, "config.json");
  return {
    window: { width: 1280, height: 820 },
    experienceProxyUrl: "",
    experienceProxyAuthToken: "",
    ...readJsonIfExists(app.isPackaged ? packagedConfigPath : devConfigPath)
  };
}

function backendExecutableName() {
  return process.platform === "win32" ? "cursed-canvas-backend.exe" : "cursed-canvas-backend";
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean).map((item) => path.normalize(item)))];
}

function backendExecutableCandidates() {
  const name = backendExecutableName();
  if (app.isPackaged) {
    const exeDir = path.dirname(process.execPath);
    const resourceRoots = uniquePaths([
      process.resourcesPath,
      path.join(exeDir, "resources"),
      exeDir,
      process.cwd(),
      path.join(process.resourcesPath || "", "resources")
    ]);
    const candidates = [];
    resourceRoots.forEach((root) => {
      candidates.push(path.join(root, "backend", name));
      candidates.push(path.join(root, "backend", "cursed-canvas-backend", name));
      candidates.push(path.join(root, name));
    });
    return uniquePaths(candidates);
  }
  const python = process.platform === "win32"
    ? path.join(process.cwd(), "venv", "Scripts", "python.exe")
    : path.join(process.cwd(), "venv", "bin", "python");
  return [fs.existsSync(python) ? python : "python3"];
}

function backendExecutablePath() {
  const candidates = backendExecutableCandidates();
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function formatBackendCandidates() {
  return backendExecutableCandidates()
    .map((candidate) => `${fs.existsSync(candidate) ? "[found]" : "[missing]"} ${candidate}`)
    .join("\n");
}

function backendArgs() {
  if (app.isPackaged) return [];
  return [path.join(process.cwd(), "desktop_backend.py")];
}

function waitForHttp(url, timeoutMs = process.platform === "win32" ? 120000 : 45000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(`${url}/api/status`, (response) => {
        response.resume();
        backendReady = true;
        appendLog(`Backend ready at ${url}/api/status`);
        resolve();
      });
      request.on("error", () => {
        if (Date.now() >= deadline) {
          reject(new Error(`Backend did not become ready in time. Log: ${logPath()}`));
        } else {
          setTimeout(check, 350);
        }
      });
      request.setTimeout(1200, () => {
        request.destroy();
      });
    };
    check();
  });
}

function probeLocalRuntime(url, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const request = http.get(`${url}/api/local-runtime/check`, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          const result = JSON.parse(body || "{}");
          if (result.ok) {
            appendLog(`Local runtime check ok: torch=${result.torch_version || "unknown"}`);
          } else {
            appendLog(`Local runtime check failed: ${result.error_type || "Error"} ${result.error || ""}`);
          }
        } catch (_err) {
          appendLog(`Local runtime check returned non-JSON response: ${body.slice(0, 300)}`);
        }
        resolve();
      });
    });
    request.on("error", (err) => {
      appendLog(`Local runtime check request failed: ${err.message || String(err)}`);
      resolve();
    });
    request.setTimeout(timeoutMs, () => {
      appendLog("Local runtime check timed out.");
      request.destroy();
      resolve();
    });
  });
}

function isLocalAppUrl(value) {
  try {
    const parsed = new URL(value || "");
    return parsed.protocol === "http:" && parsed.hostname === "127.0.0.1";
  } catch (_err) {
    return false;
  }
}

function configureMediaPermissions() {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details = {}) => {
    if (permission === "media" && isLocalAppUrl(details.requestingUrl)) {
      appendLog(`Granted media permission for ${details.requestingUrl || "local app"}`);
      callback(true);
      return;
    }
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details = {}) => {
    if (permission !== "media") return false;
    return isLocalAppUrl(requestingOrigin) || isLocalAppUrl(details.requestingUrl);
  });
}

function findFreePort(startPort = 7860) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    const tryPort = () => {
      const server = net.createServer();
      server.once("error", () => {
        port += 1;
        if (port > startPort + 50) {
          reject(new Error("Could not find a free localhost port."));
        } else {
          tryPort();
        }
      });
      server.once("listening", () => {
        server.close(() => resolve(port));
      });
      server.listen(port, "127.0.0.1");
    };
    tryPort();
  });
}

function resolveIconUrl(iconPath) {
  if (!backendBaseUrl) return null;
  if (/^https?:\/\//i.test(iconPath)) return iconPath;
  const separator = iconPath.startsWith("/") ? "" : "/";
  return `${backendBaseUrl}${separator}${iconPath}`;
}

function fetchImageBuffer(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Icon fetch timed out: ${url}`));
    });
  });
}

async function applyWindowIconFromPath(iconRequest, options = {}) {
  if (!mainWindow) return false;
  const { iconId, iconPath } = parseIconRequest(iconRequest);
  const url = resolveIconUrl(iconPath);
  try {
    const nativeIcon = createNativeIconImage(iconId);
    let image = nativeIcon.image;
    let source = nativeIcon.iconPath;
    if (image.isEmpty()) {
      if (!url) return false;
      const buffer = await fetchImageBuffer(url);
      image = nativeImage.createFromBuffer(buffer);
      source = url;
    }
    if (image.isEmpty()) {
      appendLog(`Window icon image is empty for ${source || iconPath}`);
      return false;
    }
    let applied = false;
    try {
      mainWindow.setIcon(image);
      applied = true;
    } catch (err) {
      appendLog(`Window icon update failed for BrowserWindow: ${err.message || String(err)}`);
    }
    if (process.platform === "darwin" && app.dock && typeof app.dock.setIcon === "function") {
      try {
        app.dock.setIcon(image);
        applied = true;
      } catch (err) {
        appendLog(`Dock icon update failed: ${err.message || String(err)}`);
      }
    }
    if (applied && options.persist !== false) writeDesktopIconPreference(iconId);
    if (applied) appendLog(`Window icon updated to ${iconId} from ${source || iconPath}`);
    return applied;
  } catch (err) {
    appendLog(`Window icon update failed: ${err.message || String(err)}`);
    return false;
  }
}

async function startBackend(config) {
  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}`;
  backendBaseUrl = url;
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      CURSED_CANVAS_DESKTOP: "1",
      CURSED_CANVAS_PORT: String(port),
      EXPERIENCE_PROXY_URL: config.experienceProxyUrl || process.env.EXPERIENCE_PROXY_URL || "",
      EXPERIENCE_PROXY_AUTH_TOKEN: config.experienceProxyAuthToken || process.env.EXPERIENCE_PROXY_AUTH_TOKEN || ""
    };
    const executable = backendExecutablePath();
    backendReady = false;
    appendLog("Starting The Cursed Canvas desktop app.");
    appendLog(`resourcesPath=${process.resourcesPath || ""}`);
    appendLog(`backendExecutable=${executable}`);
    appendLog(`backendExists=${fs.existsSync(executable)}`);
    appendLog(`backendCandidates=\n${formatBackendCandidates()}`);
    appendLog(`cwd=${process.cwd()}`);
    appendLog(`port=${port}`);
    appendLog(`experienceProxyUrl=${env.EXPERIENCE_PROXY_URL || ""}`);
    if (!fs.existsSync(executable)) {
      reject(new Error(`Backend executable was not found. Log: ${logPath()}`));
      return;
    }
    backendProcess = spawn(executable, backendArgs(), {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let resolved = false;
    backendProcess.stdout.on("data", (data) => {
      const text = data.toString();
      process.stdout.write(text);
      appendLog(`[backend stdout] ${text.trimEnd()}`);
    });

    backendProcess.stderr.on("data", (data) => {
      const text = data.toString();
      process.stderr.write(text);
      appendLog(`[backend stderr] ${text.trimEnd()}`);
    });

    backendProcess.on("error", (err) => {
      appendLog(`Backend spawn error: ${err.message || String(err)}`);
      if (!resolved) reject(new Error(`${err.message || String(err)}. Log: ${logPath()}`));
    });

    backendStartupExitPromise = new Promise((_, exitReject) => {
      backendProcess.once("exit", (code) => {
        if (!backendReady) {
          exitReject(new Error(`Backend exited before startup (code ${code}). Log: ${logPath()}`));
        }
      });
    });

    backendProcess.on("exit", (code) => {
      appendLog(`Backend exited with code ${code}`);
      backendProcess = null;
      if (!resolved) reject(new Error(`Backend exited before startup (code ${code}). Log: ${logPath()}`));
      if (mainWindow && code !== 0) {
        dialog.showErrorBox("The Cursed Canvas", "The local game backend stopped unexpectedly.");
      }
    });

    resolved = true;
    resolve(url);
  });
}

function createWindow(config, preferredIconId) {
  const windowOptions = {
    width: config.window?.width || 1280,
    height: config.window?.height || 820,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#07090f",
    title: "The Cursed Canvas",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  };
  const nativeIconPath = desktopIconAssetPath(preferredIconId);
  if (nativeIconPath) windowOptions.icon = nativeIconPath;

  mainWindow = new BrowserWindow(windowOptions);
  void applyWindowIconFromPath({ iconId: preferredIconId }, { persist: false });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL("data:text/html;charset=utf-8,<body style='margin:0;background:#07090f;color:#d8d1bf;font-family:serif;display:grid;place-items:center;height:100vh'>Loading The Cursed Canvas...</body>");
}

async function boot() {
  const config = loadConfig();
  const preferredIconId = readDesktopIconPreference();
  createWindow(config, preferredIconId);
  try {
    const url = await startBackend(config);
    await Promise.race([waitForHttp(url), backendStartupExitPromise]);
    probeLocalRuntime(url);
    await applyWindowIconFromPath({ iconId: preferredIconId }, { persist: false });
    await mainWindow.loadURL(url);
  } catch (err) {
    appendLog(`Startup failed: ${err.message || String(err)}`);
    dialog.showErrorBox("The Cursed Canvas", err.message || String(err));
    app.quit();
  }
}

ipcMain.handle("desktop:set-window-icon", async (_event, iconRequest) => {
  if (!iconRequest) return false;
  return applyWindowIconFromPath(iconRequest, { persist: true });
});

ipcMain.handle("desktop:quit-app", async () => {
  app.quit();
  return true;
});

if (process.platform === "win32") {
  app.setAppUserModelId(APP_ID);
}

app.whenReady().then(() => {
  configureMediaPermissions();
  return boot();
});

app.on("window-all-closed", () => {
  if (backendProcess) backendProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (backendProcess) backendProcess.kill();
});
