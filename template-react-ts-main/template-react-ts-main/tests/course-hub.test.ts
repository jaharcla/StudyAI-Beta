import test from "node:test";
import assert from "node:assert/strict";
import { getCourseOverview } from "../src/domain/course-hub";

test("quick and full overview send distinct requests, retaining refresh", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return new Response(JSON.stringify({
      courseId: "1298417", checkedAt: "2026-11-02T12:00:00Z",
      sources: {}, warnings: [], due: [], complete: false,
      provenance: "Waterloo LEARN via local MCP",
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await getCourseOverview("1298417");
    await getCourseOverview("1298417", false, true);
    await getCourseOverview("1298417", true, true);
    assert.equal(urls[0], "/api/courses/1298417/overview");
    assert.equal(urls[1], "/api/courses/1298417/overview?full=1");
    assert.equal(urls[2], "/api/courses/1298417/overview?refresh=1&full=1");
  } finally {
    globalThis.fetch = original;
  }
});
