import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLearnAuthController, hasSavedAuthState, learnViewerUrl } from "./learn-auth.mjs";

test("Codespaces viewer URL is generated only from valid private-forwarding metadata", () => {
  assert.equal(learnViewerUrl({ CODESPACES: "true", CODESPACE_NAME: "study-space", GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev" }),
    "https://study-space-6080.app.github.dev/vnc.html?autoconnect=true&resize=remote");
  assert.equal(learnViewerUrl({ CODESPACES: "true", CODESPACE_NAME: "bad host", GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev" }), null);
  assert.equal(learnViewerUrl({ CODESPACES: "false", CODESPACE_NAME: "study-space", GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev" }), null);
});

test("saved auth detection checks presence without parsing or exposing state contents", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studyai-auth-state-"));
  const file = path.join(dir, "state.json");
  try {
    assert.equal(await hasSavedAuthState(file), false);
    await writeFile(file, "opaque test bytes longer than twenty bytes", { mode: 0o600 });
    assert.equal(await hasSavedAuthState(file), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mock login transitions to session-saved and drops the temporary viewer", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studyai-auth-flow-"));
  const file = path.join(dir, "state.json");
  let finishLogin;
  const login = new Promise(resolve => { finishLogin = resolve; });
  const auth = createLearnAuthController({
    env: { CODESPACES: "true", CODESPACE_NAME: "study-space", GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev" },
    authFile: file,
    runLogin: async ({ onViewerReady }) => { onViewerReady(); return login; },
  });
  try {
    assert.equal((await auth.start()).state, "connecting");
    assert.ok((await auth.getStatus()).viewerUrl);
    await writeFile(file, "mock storage state with adequate test data", { mode: 0o600 });
    finishLogin();
    await new Promise(resolve => setTimeout(resolve, 0));
    const state = await auth.getStatus();
    assert.equal(state.state, "session-saved");
    assert.equal(state.viewerUrl, null);
  } finally {
    await auth.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("cancel aborts the user-controlled sign-in flow and clears the viewer URL", async () => {
  let aborted = false;
  const auth = createLearnAuthController({
    env: { CODESPACES: "true", CODESPACE_NAME: "study-space", GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev" },
    authFile: "unused",
    runLogin: ({ signal, onViewerReady }) => new Promise(resolve => {
      onViewerReady();
      signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true });
    }),
  });
  assert.equal((await auth.start()).state, "connecting");
  const status = await auth.stop();
  assert.equal(aborted, true);
  assert.equal(status.state, "login-required");
  assert.equal(status.viewerUrl, null);
});

test("expired sessions return to connected after manual reauthentication", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studyai-auth-expiry-"));
  const file = path.join(dir, "state.json");
  await writeFile(file, "mock storage state with adequate test data", { mode: 0o600 });
  let finishLogin;
  const login = new Promise(resolve => { finishLogin = resolve; });
  const auth = createLearnAuthController({
    env: { CODESPACES: "true", CODESPACE_NAME: "study-space", GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev" },
    authFile: file,
    runLogin: async ({ onViewerReady }) => { onViewerReady(); return login; },
  });
  try {
    assert.equal((await auth.getStatus("reauth-required")).state, "reauth-required");
    assert.equal((await auth.start()).state, "connecting");
    await writeFile(file, "refreshed mock storage state, replacing expired data", { mode: 0o600 });
    finishLogin();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal((await auth.getStatus()).state, "session-saved");
    assert.equal((await auth.getStatus("connected")).state, "connected");
  } finally {
    await auth.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("authentication launch is rejected outside Codespaces", async () => {
  const auth = createLearnAuthController({ env: {}, authFile: "unused", runLogin: async () => assert.fail("must not launch") });
  await assert.rejects(auth.start(), /available only in GitHub Codespaces/);
});
