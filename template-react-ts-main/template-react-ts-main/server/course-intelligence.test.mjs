import test from "node:test";
import assert from "node:assert/strict";
import { buildCourseOverview, normalizeOverview } from "./course-intelligence.mjs";

const snapshot = "2026-11-02T12:00:00.000Z";
function ok(value) { return { status: "fulfilled", value }; }
function unavailable(message) { return { status: "rejected", reason: new Error(message) }; }

test("partial LMS responses do not erase genuine upcoming dates", () => {
  const result = normalizeOverview("123", {
    upcoming: ok([{title: "Midterm 2", start: "2026-11-10T14:00:00Z", description: "In class"}]),
    assignments: unavailable("Assignments permission denied"),
    announcements: ok([]),
    grades: unavailable("Grades unavailable"),
    outline: ok({title: "Course syllabus", text: "Week 5: vectors", url: "https://outline.uwaterloo.ca"}),
  }, snapshot);
  assert.equal(result.due.length, 1);
  assert.equal(result.due[0].origin, "LEARN calendar");
  assert.equal(result.due[0].title, "Midterm 2");
  assert.equal(result.warnings.length, 2);
  assert.equal(result.sources.assignments.state, "unavailable");
  assert.equal(result.sources.outline.state, "available");
  assert.equal(result.complete, false);
});

test("does not fabricate dates or treat submitted work as outstanding", () => {
  const result = normalizeOverview("123", {
    upcoming: ok([{title: "Undated task", start: null}, {title: "Past quiz", start: "2026-10-10T12:00:00Z"}]),
    assignments: ok([
      {name: "Problem Set", dueDate: "2026-11-07T12:00:00Z", submissionStatus: "submitted"},
      {name: "Lab report", dueDate: "2026-11-09T12:00:00Z", submissionStatus: "unsubmitted"},
      {name: "Unknown date", dueDate: null, submissionStatus: "unsubmitted"},
    ]),
    announcements: ok([]),
    grades: ok([]),
    outline: ok({title: "Outline"}),
  }, snapshot);
  assert.deepEqual(result.due.map(item => item.title), ["Lab report"]);
});

test("overview uses existing Waterloo tools and caches results", async () => {
  const calls = [];
  const connector = {
    getUpcoming: async () => { calls.push("upcoming"); return [{ title: "Quiz", start: "2099-01-01T12:00:00Z" }]; },
    getAssignments: async () => { calls.push("assignments"); return []; },
    getAnnouncements: async () => { calls.push("announcements"); return []; },
    getGrades: async () => { calls.push("grades"); return []; },
    getOutline: async () => { calls.push("outline"); return { title: "Outline" }; },
  };
  const first = await buildCourseOverview(connector, "99123001", { full: true });
  const second = await buildCourseOverview(connector, "99123001", { full: true });
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(calls.length, 5);
  assert.equal(second.sources.upcoming.state, "available");
});

test("quick overview only loads calendar and announcements", async () => {
  const calls = [];
  const connector = {
    getUpcoming: async () => { calls.push("upcoming"); return []; },
    getAnnouncements: async () => { calls.push("announcements"); return []; },
    getAssignments: async () => { throw new Error("Should not load assignments"); },
    getGrades: async () => { throw new Error("Should not load grades"); },
    getOutline: async () => { throw new Error("Should not load outline"); },
  };
  const result = await buildCourseOverview(connector, "99123002");
  assert.equal(calls.length, 2);
  assert.equal(result.sources.outline.state, "not-checked");
  assert.equal(result.sources.upcoming.state, "available");
  assert.equal(result.warnings.length, 0);
  assert.equal(result.complete, false);
});

test("failed sources are labeled unavailable and no empty-source claims are made", () => {
  const overview = normalizeOverview("1", {
    upcoming: unavailable("session expired"),
    assignments: unavailable("session expired"),
    announcements: unavailable("session expired"),
    grades: unavailable("session expired"),
    outline: unavailable("session expired"),
  }, snapshot);
  assert.equal(overview.complete, false);
  assert.equal(overview.warnings.length, 5);
  assert.equal(overview.due.length, 0);
  assert.equal(overview.sources.upcoming.count, null);
});
