import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const mcpRoot = path.resolve(appRoot, "../../waterloo_learn_mcp-main/waterloo_learn_mcp-main");
const VIEWER_PORT = 6080;
const VNC_PORT = 5900;

export function learnAuthFile(env = process.env) {
  return env.LEARN_AUTH_FILE || path.resolve(appRoot, "../../.studyai-private/learn-auth-state.json");
}

export function learnViewerUrl(env = process.env) {
  if (env.CODESPACES !== "true") return null;
  const name = env.CODESPACE_NAME || "";
  const domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "";
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(name) || !/^[a-z0-9.-]+$/i.test(domain) || domain.startsWith(".") || domain.endsWith(".")) return null;
  return `https://${name}-${VIEWER_PORT}.${domain}/vnc.html?autoconnect=true&resize=remote`;
}

export async function hasSavedAuthState(file) {
  try {
    const info = await stat(file);
    return info.isFile() && info.size > 20;
  } catch {
    return false;
  }
}

function safeChildEnvironment(env, display) {
  const safe = {};
  for (const name of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LD_LIBRARY_PATH"]) {
    if (env[name]) safe[name] = env[name];
  }
  safe.DISPLAY = display;
  return safe;
}

function ensurePortFree(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error("Temporary LEARN sign-in services are already in use.")));
    server.listen(port, "127.0.0.1", () => server.close(error => error ? reject(error) : resolve()));
  });
}

function waitForViewer(port, signal) {
  const deadline = Date.now() + 10_000;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (signal.aborted) return reject(new Error("Sign-in was cancelled."));
      const request = net.connect(port, "127.0.0.1");
      request.once("connect", () => { request.destroy(); resolve(); });
      request.once("error", () => {
        request.destroy();
        if (Date.now() >= deadline) reject(new Error("Could not start the private LEARN sign-in viewer."));
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

const childStopPromises = new WeakMap();

function stopChild(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  const existing = childStopPromises.get(child);
  if (existing) return existing;
  const stopping = new Promise(resolve => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 1200);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
  childStopPromises.set(child, stopping);
  return stopping;
}

async function runCodespacesLogin({ env, authFile, signal, onViewerReady }) {
  if (env.CODESPACES !== "true" || process.platform !== "linux") {
    throw new Error("The temporary LEARN sign-in viewer requires Linux GitHub Codespaces.");
  }
  if (!learnViewerUrl(env)) throw new Error("GitHub Codespaces private port forwarding is unavailable.");
  const stateDirectory = path.dirname(authFile);
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await chmod(stateDirectory, 0o700);
  await ensurePortFree(VIEWER_PORT);
  const display = `:${100 + (process.pid % 500)}`;
  const childEnv = safeChildEnvironment(env, display);
  const children = [];
  const start = (command, args, childEnvironment = childEnv) => {
    const child = spawn(command, args, { env: childEnvironment, stdio: "ignore", windowsHide: true });
    children.push(child);
    return child;
  };
  const stopAll = async () => { await Promise.all(children.reverse().map(stopChild)); };
  const abort = () => { void stopAll(); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const novncRoot = env.STUDYAI_NOVNC_ROOT || "/usr/share/novnc";
    if (!existsSync(path.join(novncRoot, "vnc.html"))) throw new Error("The Codespaces noVNC package is not installed.");
    const tsx = path.join(mcpRoot, "node_modules", "tsx", "dist", "cli.mjs");
    const loginScript = path.join(mcpRoot, "scripts", "codespaces-login.ts");
    if (!existsSync(tsx) || !existsSync(loginScript)) throw new Error("The Codespaces LEARN login helper is not installed.");
    start("Xvfb", [display, "-screen", "0", "1280x800x24", "-nolisten", "tcp", "-ac"]);
    start("x11vnc", ["-display", display, "-rfbport", String(VNC_PORT), "-localhost", "-nopw", "-forever", "-shared", "-noxdamage", "-quiet"]);
    start("websockify", [`--web=${novncRoot}`, "--host=0.0.0.0", String(VIEWER_PORT), `127.0.0.1:${VNC_PORT}`]);
    await waitForViewer(VIEWER_PORT, signal);
    onViewerReady?.();
    const loginEnv = { ...childEnv, LEARN_AUTH_FILE: authFile, LEARN_BASE_URL: env.LEARN_BASE_URL || "https://learn.uwaterloo.ca" };
    const login = start(process.execPath, [tsx, loginScript], loginEnv);
    const exitCode = await new Promise((resolve, reject) => {
      const onAbort = () => { void stopChild(login); reject(new Error("Sign-in was cancelled.")); };
      signal.addEventListener("abort", onAbort, { once: true });
      login.once("error", () => { signal.removeEventListener("abort", onAbort); reject(new Error("Could not start the LEARN sign-in browser.")); });
      login.once("exit", code => { signal.removeEventListener("abort", onAbort); resolve(code); });
    });
    if (exitCode !== 0 || !(await hasSavedAuthState(authFile))) throw new Error("LEARN sign-in did not complete.");
  } finally {
    signal.removeEventListener("abort", abort);
    await stopAll();
  }
}

export function createLearnAuthController({ env = process.env, authFile = learnAuthFile(env), runLogin = runCodespacesLogin } = {}) {
  let flowState = "idle";
  let flow = null;
  let abort = null;
  let lastError = null;

  async function getStatus(connectorState = "") {
    let state;
    if (flowState === "connecting") state = "connecting";
    else if (connectorState === "connected") { state = "connected"; flowState = "idle"; }
    else if (flowState === "session-saved") { state = "session-saved"; flowState = "idle"; }
    else if (connectorState === "reauth-required") state = "reauth-required";
    else if (connectorState === "offline") state = "offline";
    else if (await hasSavedAuthState(authFile)) state = "session-saved";
    else state = "login-required";
    return { enabled: env.CODESPACES === "true", state, viewerUrl: state === "connecting" ? learnViewerUrl(env) : null, ...(lastError ? { message: lastError } : {}) };
  }

  async function start() {
    if (env.CODESPACES !== "true") throw new Error("LEARN sign-in is available only in GitHub Codespaces.");
    if (!learnViewerUrl(env)) throw new Error("GitHub Codespaces private port forwarding is unavailable.");
    if (flowState === "connecting") return getStatus();
    lastError = null;
    flowState = "connecting";
    abort = new AbortController();
    const currentAbort = abort;
    let resolveViewer;
    let rejectViewer;
    const viewerReady = new Promise((resolve, reject) => { resolveViewer = resolve; rejectViewer = reject; });
    flow = Promise.resolve()
      .then(() => runLogin({ env, authFile, signal: currentAbort.signal, onViewerReady: resolveViewer }))
      .then(async () => { flowState = await hasSavedAuthState(authFile) ? "session-saved" : "idle"; })
      .catch(() => { flowState = "idle"; lastError = "Sign-in ended before LEARN accepted the session. Try again."; rejectViewer(new Error("Could not start the private LEARN sign-in viewer.")); })
      .finally(() => { if (abort === currentAbort) abort = null; flow = null; });
    await Promise.race([viewerReady, flow.then(() => { throw new Error("LEARN sign-in ended before the viewer started."); })]);
    return getStatus();
  }

  async function stop(connectorState = "") {
    const wasConnecting = Boolean(abort);
    if (abort) abort.abort();
    await flow?.catch(() => {});
    flowState = "idle";
    if (wasConnecting) lastError = "Sign-in cancelled.";
    abort = null;
    return getStatus(connectorState);
  }

  return { start, stop, getStatus };
}
