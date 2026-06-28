const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

let mainWindow = null;
let backendProcess = null;
let backendReady = false;
let backendStartupExitPromise = null;

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

function backendExecutablePath() {
  if (app.isPackaged) {
    const name = process.platform === "win32" ? "cursed-canvas-backend.exe" : "cursed-canvas-backend";
    return path.join(process.resourcesPath, "backend", name);
  }
  const python = process.platform === "win32"
    ? path.join(process.cwd(), "venv", "Scripts", "python.exe")
    : path.join(process.cwd(), "venv", "bin", "python");
  return fs.existsSync(python) ? python : "python3";
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

async function startBackend(config) {
  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}`;
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
    appendLog(`cwd=${process.cwd()}`);
    appendLog(`port=${port}`);
    appendLog(`experienceProxyUrl=${env.EXPERIENCE_PROXY_URL || ""}`);
    if (!fs.existsSync(executable)) {
      reject(new Error(`Backend executable was not found: ${executable}. Log: ${logPath()}`));
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

function createWindow(config) {
  mainWindow = new BrowserWindow({
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
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL("data:text/html;charset=utf-8,<body style='margin:0;background:#07090f;color:#d8d1bf;font-family:serif;display:grid;place-items:center;height:100vh'>Loading The Cursed Canvas...</body>");
}

async function boot() {
  const config = loadConfig();
  createWindow(config);
  try {
    const url = await startBackend(config);
    await Promise.race([waitForHttp(url), backendStartupExitPromise]);
    await mainWindow.loadURL(url);
  } catch (err) {
    appendLog(`Startup failed: ${err.message || String(err)}`);
    dialog.showErrorBox("The Cursed Canvas", err.message || String(err));
    app.quit();
  }
}

app.whenReady().then(boot);

app.on("window-all-closed", () => {
  if (backendProcess) backendProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (backendProcess) backendProcess.kill();
});
