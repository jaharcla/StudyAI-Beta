import test from "node:test";
import assert from "node:assert/strict";
import { getConnectorStatus, getCourses, syncCourses } from "../src/domain/connector";

const cached = {
  id: "course-120",
  code: "CHEM 120",
  title: "Chemistry",
  dataSource: { kind: "waterloo-mcp" as const, label: "Waterloo LEARN", lastSyncedAt: "2026-11-02T00:00:00Z" },
};

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("a 401 sync preserves cached courses and reports reauthentication", async () => {
  const prior = globalThis.fetch;
  const payload = {
    courses: [cached],
    status: { state: "reauth-required", updatedAt: "2026-11-02T00:00:00Z", lastSuccessAt: null },
  };
  globalThis.fetch = (async () => response(401, payload)) as typeof fetch;
  try {
    const result = await syncCourses();
    assert.equal(result.status.state, "reauth-required");
    assert.deepEqual(result.courses, [cached]);
  } finally {
    globalThis.fetch = prior;
  }
});

test("a 503 sync preserves stale course inventory", async () => {
  const prior = globalThis.fetch;
  globalThis.fetch = (async () => response(503, {
    courses: [cached],
    status: { state: "offline", updatedAt: "2026-11-02T00:00:00Z", lastSuccessAt: null },
  })) as typeof fetch;
  try {
    const result = await syncCourses();
    assert.equal(result.status.state, "offline");
    assert.equal(result.courses[0].id, "course-120");
  } finally {
    globalThis.fetch = prior;
  }
});

test("missing error response still distinguishes a 401 from offline", async () => {
  const prior = globalThis.fetch;
  globalThis.fetch = (async () => new Response("Unauthorized", { status: 401 })) as typeof fetch;
  try {
    const result = await getCourses();
    assert.equal(result.status.state, "reauth-required");
  } finally {
    globalThis.fetch = prior;
  }
});

test("health endpoint preserves its actual backend status", async () => {
  const prior = globalThis.fetch;
  globalThis.fetch = (async () => response(200, {
    state: "connected",
    updatedAt: "2026-11-02T00:00:00Z",
    lastSuccessAt: "2026-11-02T00:00:00Z",
  })) as typeof fetch;
  try {
    assert.equal((await getConnectorStatus()).state, "connected");
  } finally {
    globalThis.fetch = prior;
  }
});

test("unreachable backend yields offline demo without network calls leaking", async () => {
  const prior = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch;
  try {
    const result = await getCourses();
    assert.equal(result.status.state, "offline");
    assert.equal(result.courses[0].dataSource.kind, "synthetic");
  } finally {
    globalThis.fetch = prior;
  }
});
