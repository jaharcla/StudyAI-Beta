// Reuse Waterloo LEARN's existing course-wide tools. Every fact remains tied
// to a named LMS source; missing data must never become invented deadlines.
const TTL = 10 * 60 * 1000;
const cache = new Map();

function safeMessage(error) {
  const message = String(error?.message || error || "Unknown error");
  return message.replace(/([?&](?:token|session|code|key)=)[^\s&]+/gi, "$1[redacted]").slice(0, 300);
}
function bounded(value, limit = 100) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}
export function normalizeOverview(courseId, sourceResults, checkedAt = new Date().toISOString()) {
  const sources = {};
  const warnings = [];
  const keys = ["upcoming", "assignments", "announcements", "grades", "outline"];
  for (const key of keys) {
    const result = sourceResults[key];
    if (result?.status === "skipped" || !result) {
      sources[key] = { state: "not-checked", count: null, items: [] };
      continue;
    }
    if (result.status !== "fulfilled") {
      sources[key] = { state: "unavailable", count: null, items: [] };
      warnings.push({ source: key, message: safeMessage(result?.reason ?? "Not checked") });
      continue;
    }
    if (key === "outline") {
      const item = result.value || {};
      sources.outline = { state: "available", title: typeof item.title === "string" ? item.title : "",
        url: typeof item.url === "string" ? item.url : null,
        excerpt: typeof item.text === "string" ? item.text.slice(0, 1500) : "" };
    } else {
      const items = bounded(result.value).map(item => ({ ...item }));
      if (key === "announcements") {
        for (const item of items) if (typeof item.body === "string") item.body = item.body.slice(0, 500);
      }
      if (key === "assignments") {
        for (const item of items) if (typeof item.instructions === "string") item.instructions = item.instructions.slice(0, 500);
      }
      if (key === "grades") {
        for (const item of items) if (typeof item.feedback === "string") item.feedback = item.feedback.slice(0, 300);
      }
      sources[key] = { state: "available", count: items.length, items };
    }
  }
  const seen = new Set();
  const due = [];
  const now = Date.parse(checkedAt);
  const append = (title, iso, origin, description = "") => {
    const time = Date.parse(iso);
    if (!title || !Number.isFinite(time) || time < now) return;
    const key = title.trim().toLowerCase() + ":" + new Date(time).toISOString().slice(0, 10);
    if (seen.has(key)) return;
    seen.add(key);
    due.push({ title, dueAt: new Date(time).toISOString(), origin, description: String(description || "").slice(0, 200) });
  };
  if (sources.upcoming.state === "available") for (const e of sources.upcoming.items)
    append(e.title, e.start, "LEARN calendar", e.description);
  if (sources.assignments.state === "available") for (const a of sources.assignments.items)
    if (a.submissionStatus !== "submitted") append(a.name, a.dueDate, "LEARN assignments", a.instructions);
  due.sort((a,b)=>a.dueAt.localeCompare(b.dueAt));
  return { courseId: String(courseId), checkedAt, sources, due: due.slice(0, 30), warnings,
    complete: warnings.length === 0 && keys.every(key => sources[key].state === "available"), provenance: "Waterloo LEARN via local MCP" };
}

export async function buildCourseOverview(connector, courseId, options = {}) {
  const id = String(courseId);
  const cacheKey = id + (options.full ? ":full" : ":quick");
  if (!options.refresh) {
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < TTL) return { ...cached.overview, cached: true };
  }
  // Each provider fails independently, ensuring a timeout or permission error
  // doesn't erase a successfully retrieved calendar or grade list.
  const calls = {
    upcoming: () => connector.getUpcoming(Number(id), 30),
    assignments: () => connector.getAssignments(Number(id)),
    announcements: () => connector.getAnnouncements(Number(id)),
    grades: () => connector.getGrades(Number(id)),
    outline: () => connector.getOutline(Number(id)),
  };
  const results = {};
  // Do not start five heavyweight Playwright/LMS calls at the same instant.
  const groups = options.full ? [["upcoming","announcements"],["assignments","grades"],["outline"]] : [["upcoming","announcements"]];
  for (const group of groups) {
    const settled = await Promise.allSettled(group.map(key => calls[key]()));
    group.forEach((key, i) => { results[key] = settled[i]; });
  }
  const overview = normalizeOverview(id, results);
  cache.set(cacheKey, { at: Date.now(), overview });
  return { ...overview, cached: false };
}
