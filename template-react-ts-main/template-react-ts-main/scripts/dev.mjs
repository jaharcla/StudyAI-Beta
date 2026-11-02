import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiEntrypoint = resolve(projectRoot, "server", "index.mjs");
const viteEntrypoint = resolve(projectRoot, "node_modules", "vite", "bin", "vite.js");

if (!existsSync(viteEntrypoint)) {
  console.error("StudyAI frontend dependencies are missing. Run npm install in the app directory.");
  process.exit(1);
}

const children = [];
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) {
      child.kill();
    }
  }
}

function start(name, args) {
  // Invoke Node directly; spawning npm through a Windows shell breaks when
  // npm_execpath is located under C:\\Program Files and emits DEP0190.
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  children.push(child);
  child.once("error", (error) => {
    console.error(`[StudyAI] Could not start ${name}: ${error.message}`);
    stop(1);
  });
  child.once("exit", (code, signal) => {
    if (stopping) return;
    console.error(`[StudyAI] ${name} stopped (${signal || code}). Stopping both servers.`);
    stop(code === 0 ? 0 : (code ?? 1));
  });
}

process.once("SIGINT", () => stop(130));
process.once("SIGTERM", () => stop(143));

console.log("[StudyAI] Starting API on http://127.0.0.1:4174 and frontend on http://localhost:5173");
start("API", [apiEntrypoint]);
start("frontend", [viteEntrypoint, "--config", resolve(projectRoot, "vite", "config.dev.mjs")]);
