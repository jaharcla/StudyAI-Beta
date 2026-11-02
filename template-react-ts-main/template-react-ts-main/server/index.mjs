import http from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cacheDirectory, diffCourses, fingerprintCourse, readCache, writeCache } from "./cache.mjs";
import { isReauthError, McpConnector } from "./mcp-client.mjs";
import { availableGroqModels, generateQuestions, normalizePages, DEFAULT_MODEL } from "./practice.mjs";
import { createMcpHandler } from "./mcp-gateway.mjs";
import { buildCourseOverview } from "./course-intelligence.mjs";
import { createLearnAuthController, learnAuthFile } from "./learn-auth.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.STUDYAI_API_PORT || 4174);
const connector = new McpConnector(root);
const learnAuth = createLearnAuthController({ authFile: learnAuthFile() });
let cache = await readCache();
let status = { state: "not-configured", updatedAt: new Date().toISOString(), lastSuccessAt: cache.lastSuccessAt };
let syncChain = Promise.resolve();
const materialCache = new Map();
async function localModels() {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error("Ollama responded with HTTP " + response.status);
    const data = await response.json();
    const models = Array.isArray(data.models) ? data.models.filter(item => typeof item.name === "string").map(item => item.name) : [];
    return { available: true, models, preferred: models.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : models[0] || DEFAULT_MODEL };
  } catch {
    return { available: false, models: [], preferred: DEFAULT_MODEL, message: "Ollama is unavailable on this computer. Start Ollama to generate real questions." };
  }
}
async function availableModels() {
  if (process.env.STUDYAI_LLM_PROVIDER !== "groq") return localModels();
  return availableGroqModels(process.env.GROQ_API_KEY);
}

const execFileAsync = promisify(execFile);
const SOFFICE_CANDIDATES = [
  'soffice',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
];
async function checkLibreOffice() {
  for (const bin of SOFFICE_CANDIDATES) {
    try {
      await execFileAsync(bin, ['--version'], { timeout: 15_000 });
      return { available: true, binary: bin };
    } catch {
      // try next candidate
    }
  }
  return { available: false, binary: null };
}

function setStatus(state, message, lastSuccessAt = status.lastSuccessAt) {
  status = { state, updatedAt: new Date().toISOString(), lastSuccessAt, ...(message ? { message } : {}) };
  return status;
}
function json(response, value, code = 200) {
  response.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(value));
}
function publicCourse(course) { const { fingerprint, ...metadata } = course; return metadata; }
function normalizedCourse(item) {
  if (!item || typeof item !== "object") return null;
  const id = item.id ?? item.ou ?? item.courseId ?? item.orgUnitId;
  const title = item.title ?? item.name ?? item.courseName;
  if (id === undefined || !title) return null;
  const course = { id: String(id), title: String(title), dataSource: { kind: "waterloo-mcp", label: "Waterloo LEARN", lastSyncedAt: new Date().toISOString() } };
  if (item.code || item.name) course.code = String(item.code ?? item.name);
  if (item.term) course.term = String(item.term);
  return { ...course, fingerprint: fingerprintCourse(course) };
}
function parseCourses(result) {
  const structured = result?.structuredContent;
  let value = structured?.courses ?? result?.courses;
  if (!value && Array.isArray(result?.content)) {
    const text = result.content.find((part) => part?.type === "text")?.text;
    if (text) { try { const parsed = JSON.parse(text); value = parsed?.courses ?? parsed; } catch {} }
  }
  if (!Array.isArray(value)) throw new Error("MCP returned an invalid course list");
  const courses = value.map(normalizedCourse).filter(Boolean);
  if (courses.length !== value.length) throw new Error("MCP returned an invalid course list");
  return courses;
}
async function doSync() {
  setStatus("checking");
  try {
    const courses = parseCourses(await connector.listCourses());
    const changes = diffCourses(cache.courses, courses);
    const now = new Date().toISOString();
    const nextCache = { courses, tombstones: [...(cache.tombstones || []), ...changes.removed.map((id) => ({ id, removedAt: now }))].slice(-500), lastSuccessAt: now };
    await writeCache(nextCache);
    cache = nextCache;
    setStatus("connected", undefined, now);
    return { courses: courses.map(publicCourse), status, changes };
  } catch (error) {
    const reauth = isReauthError(error);
    setStatus(reauth ? "reauth-required" : "offline", reauth ? "Waterloo LEARN authentication is required." : "Waterloo LEARN is currently unavailable.");
    throw Object.assign(new Error(status.message), { statusCode: reauth ? 401 : 503 });
  }
}
function sync() {
  const next = syncChain.then(doSync, doSync);
  syncChain = next.catch(() => {});
  return next;
}
function requireCourse(courseId) {
  if (!/^\d{1,15}$/.test(courseId) || !cache.courses.some((course) => course.id === courseId)) {
    throw Object.assign(new Error("Sync your courses first, then select an accessible course."), { statusCode: 404 });
  }
  return Number(courseId);
}
function requireTopic(topicId) {
  if (typeof topicId !== "string" || !topicId || topicId.length > 128 || /[\r\n<>]/.test(topicId)) {
    throw Object.assign(new Error("Invalid lecture topic ID."), { statusCode: 400 });
  }
  return topicId;
}
function errorResponse(response, error) {
  const auth = isReauthError(error);
  const status = error?.status || (auth ? "reauth-required" : "error");
  const code = error?.statusCode || (auth ? 401 : 502);
  const message = error instanceof Error ? error.message : "Request failed.";
  if (auth) setStatus("reauth-required", "Waterloo LEARN login required.");
  json(response, { error: message, status }, code);
}
async function readJsonBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk.toString("utf8");
    if (raw.length > 8192) throw Object.assign(new Error("Request too large."), { statusCode: 413 });
  }
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error("Invalid JSON payload."), { statusCode: 400 }); }
}
async function fetchMaterial(courseId, topicId) {
  const key = courseId + ":" + topicId;
  const cached = materialCache.get(key);
  if (cached && Date.now() - cached.cachedAt < 20 * 60 * 1000) return cached.material;
  let result;
  try {
    result = await connector.getTopicText(Number(courseId), topicId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not a (PDF|PowerPoint|Word|document)/i.test(message) || /only those can be rendered/i.test(message)) {
      throw Object.assign(new Error("This topic type is not directly readable in StudyAI. Open the original in LEARN."), { statusCode: 422, status: "unsupported" });
    }
    throw error;
  }
  const pages = normalizePages(result.pages);
  const emptyPages = Array.isArray(result.emptyPages) ? result.emptyPages : [];
  const totalPages = Number.isInteger(result.totalPages) ? result.totalPages : pages.length;
  const fetchedPageCount = Number.isInteger(result.fetchedPageCount) ? result.fetchedPageCount : pages.length;
  const readablePageCount = pages.length;
  const incomplete = emptyPages.length > 0 || readablePageCount < totalPages;
  const material = {
    courseId,
    topicId,
    title: result.filename || "Lecture",
    totalPages,
    pages,
    source: "Waterloo LEARN via local MCP",
    note: result.note || undefined,
    fetchedPageCount,
    emptyPages,
    // "coverage" measures usable text, not simply downloaded slides.
    coverage: totalPages > 0 ? Math.round(readablePageCount / totalPages * 100) : 0,
    status: incomplete ? "partial" : "ready",
  };
  if (materialCache.size >= 8) materialCache.delete(materialCache.keys().next().value);
  materialCache.set(key, { material, cachedAt: Date.now() });
  return material;
}

const handleMcp = createMcpHandler({
  listCourses: () => ({ courses: cache.courses.map(publicCourse), status }),
  getModules: async (courseId) => connector.getContent(requireCourse(courseId)),
  getMaterial: async (courseId, topicId) => fetchMaterial(String(requireCourse(courseId)), requireTopic(topicId)),
});
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const path = url.pathname;
  if (path === "/mcp") return handleMcp(request, response);
  if (request.method === "GET" && path === "/api/health") return json(response, { ...status, localModel: DEFAULT_MODEL, modelProvider: process.env.STUDYAI_LLM_PROVIDER === "groq" ? "groq" : "ollama" });
  if (request.method === "GET" && path === "/api/learn/status") return json(response, await learnAuth.getStatus(status.state));
  if (request.method === "POST" && ["/api/learn/connect", "/api/learn/reconnect"].includes(path)) {
    try { return json(response, await learnAuth.start(), 202); }
    catch (error) { return json(response, { error: error instanceof Error ? error.message : "LEARN sign-in could not start." }, 503); }
  }
  if (request.method === "POST" && path === "/api/learn/cancel") return json(response, await learnAuth.stop(status.state));
  if (request.method === "GET" && path === "/api/models") return json(response, await availableModels());
  if (request.method === "GET" && path === "/api/health/libreoffice") return json(response, await checkLibreOffice());
  if (request.method === "GET" && path === "/api/courses") return json(response, { courses: cache.courses.map(publicCourse), status });
  if (request.method === "POST" && path === "/api/courses/sync") {
    try { return json(response, await sync()); }
    catch (error) { return json(response, { courses: cache.courses.map(publicCourse), status }, error.statusCode || 503); }
  }
  // Course-wide data sources; expensive indexing only runs when the student requests it.
  const intelligence = /^\/api\/courses\/(\d+)\/(overview|exam-context|search)$/.exec(path);
  if (intelligence && request.method === "GET") {
    try {
      const courseId = intelligence[1];
      const id = requireCourse(courseId);
      if (intelligence[2] === "overview") {
        return json(response, await buildCourseOverview(connector, id, {
          refresh: url.searchParams.get("refresh") === "1",
          full: url.searchParams.get("full") === "1",
        }));
      }
      if (intelligence[2] === "exam-context") {
        const assessment = (url.searchParams.get("assessment") || "final exam").slice(0, 100);
        return json(response, { courseId, context: await connector.getExamContext(id, assessment),
          source: "Waterloo LEARN exam context" });
      }
      const query = (url.searchParams.get("q") || "").trim();
      if (query.length < 2 || query.length > 200) {
        throw Object.assign(new Error("Enter a search topic (2–200 characters)."), { statusCode: 400 });
      }
      return json(response, { courseId, query,
        search: await connector.searchCourseMaterials(id, query, 12, 12),
        source: "Waterloo LEARN course-material search" });
    } catch (error) { return errorResponse(response, error); }
  }
  const route = /^\/api\/courses\/(\d+)\/(modules|material)$/.exec(path);
  if (route && request.method === "GET") {
    try {
      const courseId = route[1];
      const id = requireCourse(courseId);
      if (route[2] === "modules") {
        const modules = await connector.getContent(id);
        if (!Array.isArray(modules)) throw new Error("The course content tree was not returned.");
        return json(response, { courseId, modules });
      }
      const topicId = requireTopic(url.searchParams.get("topicId"));
      return json(response, await fetchMaterial(courseId, topicId));
    } catch (error) { return errorResponse(response, error); }
  }
  if (path === "/api/practice/generate" && request.method === "POST") {
    try {
      const body = await readJsonBody(request);
      const courseId = String(body?.courseId ?? "");
      const id = requireCourse(courseId);
      const topicId = requireTopic(body?.topicId);
      const requestedModel = typeof body.model === "string" ? body.model : undefined;
      if (requestedModel && (requestedModel.length > 100 || /[^a-zA-Z0-9._:\/-]/.test(requestedModel))) {
        throw Object.assign(new Error("Invalid local model name."), { statusCode: 400 });
      }
      const model = requestedModel || DEFAULT_MODEL;
      const provider = process.env.STUDYAI_LLM_PROVIDER === "groq" ? "groq" : "ollama";
      const installed = await availableModels();
      if (!installed.available) throw Object.assign(new Error(installed.message), { statusCode: 503 });
      if (!installed.models.includes(model)) throw Object.assign(new Error(provider === "groq" ? "Choose an available Groq model." : "Model " + model + " is not installed in local Ollama. Choose an available model."), { statusCode: 400 });
      const cancelled = new AbortController();
      const onDisconnect = () => { if (!response.writableEnded) cancelled.abort(); };
      response.once("close", onDisconnect);
      try {
        const material = await fetchMaterial(String(id), topicId);
        if (cancelled.signal.aborted) return;
        const generated = await generateQuestions(material.pages, courseId + ":" + topicId, {
          model, signal: cancelled.signal, provider,
          ...(provider === "groq" ? { apiKey: process.env.GROQ_API_KEY } : {}),
        });
        if (!cancelled.signal.aborted) return json(response, { ...generated, courseId, topicId, materialTitle: material.title, source: material.source });
      } finally {
        response.off("close", onDisconnect);
      }
      return;
    } catch (error) { return errorResponse(response, error); }
  }
  return json(response, { error: "Not found" }, 404);
});
server.on("error", (error) => { console.error("[StudyAI] API startup failed:", error.message); process.exitCode = 1; });
server.listen(port, "127.0.0.1", () => console.error("StudyAI API listening on 127.0.0.1:" + port));
async function shutdown() { await learnAuth.stop(); await connector.close(); server.close(() => process.exit(0)); }
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
export { normalizedCourse, parseCourses, setStatus, doSync, cacheDirectory };
