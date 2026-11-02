import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser } from 'playwright';

const BASE_URL = process.env.LEARN_BASE_URL ?? 'https://learn.uwaterloo.ca';
const AUTH_FILE = process.env.LEARN_AUTH_FILE;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

async function checkAuthenticatedCourses(): Promise<boolean> {
  const response = await browserContext!.request.get(
    `${BASE_URL}/d2l/api/lp/1.31/enrollments/myenrollments/?orgUnitTypeId=3`,
    { maxRedirects: 0, timeout: 10_000, headers: { Accept: 'application/json' } },
  ).catch(() => null);
  if (!response) return false;
  try {
    if (!response.ok() || !(response.headers()['content-type'] ?? '').includes('json')) return false;
    const body = await response.json();
    return Array.isArray(body?.Items);
  } catch {
    return false;
  } finally {
    await response.dispose().catch(() => {});
  }
}

let browser: Browser | null = null;
let browserContext: Awaited<ReturnType<Browser['newContext']>> | null = null;

async function saveState(): Promise<void> {
  if (!AUTH_FILE || !browserContext) throw new Error('Missing session destination.');
  const directory = path.dirname(AUTH_FILE);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const temporary = `${AUTH_FILE}.${randomUUID()}.tmp`;
  try {
    await browserContext.storageState({ path: temporary });
    await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, AUTH_FILE);
    await fs.chmod(AUTH_FILE, 0o600);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function main(): Promise<void> {
  if (process.platform !== 'linux' || process.env.CODESPACES !== 'true' || !AUTH_FILE) {
    throw new Error('Codespaces-only login configuration is required.');
  }
  browser = await chromium.launch({ headless: false });
  browserContext = await browser.newContext();
  const page = await browserContext.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(`${BASE_URL}/d2l/home`, { waitUntil: 'domcontentloaded', timeout: 45_000 });

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let authenticated = false;
  while (Date.now() < deadline) {
    if (await checkAuthenticatedCourses()) {
      authenticated = true;
      break;
    }
    await page.waitForTimeout(1500);
  }
  if (!authenticated) throw new Error('Manual WatIAM and Duo sign-in was not completed.');
  await saveState();
  process.stdout.write('LEARN_SESSION_SAVED\n');
}

process.once('SIGTERM', () => {
  void browser?.close().finally(() => process.exit(143));
});

main()
  .catch(() => { process.exitCode = 1; })
  .finally(async () => {
    await browserContext?.close().catch(() => {});
    await browser?.close().catch(() => {});
  });
