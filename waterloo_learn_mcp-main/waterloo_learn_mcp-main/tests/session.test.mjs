import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function mockedResponse(status) {
  return {
    status: () => status,
    ok: () => status >= 200 && status < 300,
    headers: () => ({ 'content-type': status === 302 ? 'text/html' : 'application/json', 'content-disposition': '' }),
    text: async () => 'Session rejected',
    json: async () => ({ Items: [] }),
    body: async () => Buffer.from('file'),
  };
}

test('saved session reload and rejected-session errors', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learn-mcp-session-'));
  const authFile = path.join(dir, 'auth.json');
  await fs.writeFile(authFile, JSON.stringify({ cookies: [], origins: [], marker: 'initial' }));
  const previousAuthFile = process.env.LEARN_AUTH_FILE;
  const previousBaseUrl = process.env.LEARN_BASE_URL;
  process.env.LEARN_AUTH_FILE = authFile;
  const previousCodespaces = process.env.CODESPACES;
  process.env.CODESPACES = 'true';
  process.env.LEARN_BASE_URL = 'https://learn.mock.invalid';

  const { AuthError, apiGet, apiGetBinary, closeBrowser, getContext, setSessionContextFactoryForTests } = await import('../dist/session.js');
  const contexts = [];
  setSessionContextFactoryForTests(async () => {
    const ctx = {
      close: async () => {},
      request: { get: async (url) => mockedResponse(Number(new URL(url).pathname.slice(1))) },
    };
    contexts.push(ctx);
    return ctx;
  });
  try {
    const first = await getContext();
    const changed = new Date(Date.now() + 2_000);
    await fs.utimes(authFile, changed, changed);
    const second = await getContext();
    assert.notEqual(second, first);
    const sameTime = new Date(Date.now() + 4_000);
    await fs.writeFile(authFile, JSON.stringify({ cookies: [], origins: [], marker: 'replaced with different length' }));
    await fs.utimes(authFile, sameTime, sameTime);
    const third = await getContext();
    assert.notEqual(third, second);

    for (const status of [302, 401, 403]) {
      for (const get of [apiGet, apiGetBinary]) {
        await assert.rejects(get(`/${status}`), (error) => {
          assert.ok(error instanceof AuthError);
          assert.match(error.message, status === 302 ? /Session expired.*StudyAI Connect LEARN/ : new RegExp(`saved session \\(${status}`));
          if (status !== 302) assert.match(error.message, /StudyAI Connect LEARN/);
          return true;
        });
      }
    }
  } finally {
    await closeBrowser();
    setSessionContextFactoryForTests(null);
    await fs.rm(dir, { recursive: true, force: true });
    if (previousCodespaces === undefined) delete process.env.CODESPACES;
    else process.env.CODESPACES = previousCodespaces;
    if (previousAuthFile === undefined) delete process.env.LEARN_AUTH_FILE;
    else process.env.LEARN_AUTH_FILE = previousAuthFile;
    if (previousBaseUrl === undefined) delete process.env.LEARN_BASE_URL;
    else process.env.LEARN_BASE_URL = previousBaseUrl;
  }
});
