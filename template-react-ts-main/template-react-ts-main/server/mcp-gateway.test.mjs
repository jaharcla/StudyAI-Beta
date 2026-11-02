import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createMcpHandler } from "./mcp-gateway.mjs";
import { createMcpStore } from "./mcp-store.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function serve(token) {
  const handler = createMcpHandler({
    listCourses: () => ({ courses: [{ id: "123", title: "Demo" }], status: { state: "connected" } }),
    getModules: async id => [{ id, title: "Module" }],
    getMaterial: async () => ({ pages: [{ page: 1, text: "test" }] })
  }, { token });
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = "http://127.0.0.1:" + server.address().port + "/mcp";
  return { server, url };
}
test("MCP rejects missing bearer token, invalid origin, and missing configuration", async () => {
  const {server, url} = await serve("secret-token");
  try {
    const unauthorized = await fetch(url, { method: "POST" });
    assert.equal(unauthorized.status, 401);
    const forbidden = await fetch(url, { method: "POST", headers: { Authorization: "Bearer secret-token", Origin: "https://malicious.example" } });
    assert.equal(forbidden.status, 403);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  const absent = await serve("");
  try { assert.equal((await fetch(absent.url, { method: "POST" })).status, 503); }
  finally { absent.server.closeAllConnections(); await new Promise(resolve => absent.server.close(resolve)); }
});
test("MCP initializes and lists read-only tools", async () => {
  const { server, url } = await serve("secret-token");
  const headers = { Authorization: "Bearer secret-token", "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  try {
    const init = await fetch(url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: {name:"test",version:"1"} } }) });
    assert.equal(init.status, 200);
    const tools = await fetch(url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) });
    assert.equal(tools.status, 200);
    const body = await tools.text();
    assert.match(body, /studyai_list_courses/);
    assert.doesNotMatch(body, /studyai_save_note/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test("backend note and attempt stores persist separately from browser progress", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studyai-mcp-"));
  try {
    const store = createMcpStore(dir);
    await store.saveNote({ courseId: "123", title: "Note", content: "Hello" });
    assert.equal((await createMcpStore(dir).listNotes("123"))[0].title, "Note");
    await store.recordResult({ courseId: "123", objectiveId: "ions", correct: true });
    const progress = await createMcpStore(dir).getProgress("123");
    assert.equal(progress.totalAttempts, 1);
    assert.equal(progress.objectives[0].correct, 1);
    assert.equal(progress.syncedWithBrowser, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
