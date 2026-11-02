/**
 * Public synthetic-demo E2E smoke test.
 * No LEARN login, real course content or external AI provider required.
 *
 * Run from the app directory, after installing a Chromium browser:
 *   npm install --no-save --package-lock=false playwright
 *   npx playwright install chromium
 *   node scripts/e2e-smoke.mjs
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const frontend = "http://127.0.0.1:5173";
const backend = "http://127.0.0.1:4174";
const server = spawn(process.execPath, ["scripts/dev.mjs"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
let browser;
for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", (data) => { output = (output + data.toString("utf8")).slice(-12000); });
}

async function waitForServer(url, deadlineMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (server.exitCode !== null) throw new Error("StudyAI server exited early:\n" + output);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response;
    } catch { /* server is still starting */ }
    await delay(300);
  }
  throw new Error("Timed out waiting for " + url + "\n" + output);
}

async function smoke(viewport, label) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  let step = "load";
  try {
    page.on("pageerror", (error) => { console.error("[browser error]", error.message); });
    await page.goto(frontend, { waitUntil: "domcontentloaded" });
    step = "open synthetic demo";
    await page.getByRole("button", { name: "Try demo challenge" }).click();
    await page.getByText("SYNTHETIC DEMO").waitFor();
    await page.locator(".question-meta").waitFor();

    step = "reload and recover session";
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("SYNTHETIC DEMO").waitFor();
    await page.locator(".question-meta").waitFor();

    step = "complete demo encounter";
    let answered = 0;
    for (; answered < 40; answered++) {
      if (await page.getByRole("heading", { name: "Encounter complete" }).count()) break;
      const choices = page.locator(".answer-grid .answer");
      await choices.first().click();
      await page.getByRole("button", { name: /Submit answer/ }).click();
      await page.getByRole("button", { name: /Next question|View results/ }).click();
    }
    if (answered === 40) throw new Error("Demo encounter failed to finish within 40 questions");
    await page.getByRole("heading", { name: "Encounter complete" }).waitFor();
    const progress = await page.getByRole("progressbar", { name: "Questions answered" }).getAttribute("aria-valuenow");
    const total = await page.getByRole("progressbar", { name: "Questions answered" }).getAttribute("aria-valuemax");
    if (!total || total === "0" || progress !== total) throw new Error("Encounter result did not report full progress");

    step = "replay demo";
    await page.getByRole("button", { name: "Replay challenge" }).click();
    await page.locator(".question-meta").waitFor();

    console.log("PASS " + label + ": demo loaded, restored, completed (" + total + " questions), and replayed");
  } catch (error) {
    await mkdir("test-results", { recursive: true });
    await page.screenshot({ path: "test-results/studyai-" + label + ".png", fullPage: true }).catch(() => {});
    throw new Error(label + " failed at " + step + ": " + error.message);
  } finally {
    await context.close();
  }
}

try {
  const health = await (await waitForServer(backend + "/api/health")).json();
  if (!health || typeof health.state !== "string") throw new Error("API health response is invalid");
  await waitForServer(frontend);
  browser = await chromium.launch({ headless: true });
  await smoke({ width: 1280, height: 800 }, "desktop");
  await smoke({ width: 390, height: 844 }, "mobile");
} catch (error) {
  console.error(error);
  console.error("Recent dev-server output:\n" + output);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
