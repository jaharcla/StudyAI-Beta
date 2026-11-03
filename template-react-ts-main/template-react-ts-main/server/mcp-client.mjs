import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function entryPath(root) {
  const configured = process.env.WATERLOO_LEARN_MCP_ENTRY;
  const fallback = resolve(root, "../../waterloo_learn_mcp-main/waterloo_learn_mcp-main/dist/index.js");
  return configured ? (isAbsolute(configured) ? configured : resolve(root, configured)) : fallback;
}
function safeEnvironment(root) {
  const names = ["PATH", "PATHEXT", "SystemRoot", "SYSTEMROOT", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP"];
  const env = Object.fromEntries(names.filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
  if (process.env.CODESPACES === "true") {
    env.CODESPACES = "true";
    env.LEARN_AUTH_FILE = process.env.LEARN_AUTH_FILE || resolve(root, "../../.studyai-private/learn-auth-state.json");
  }
  return env;
}
function extractError(result) {
  return Array.isArray(result?.content)
    ? result.content.filter((item) => item?.type === "text").map((item) => item.text).join(" ")
    : "MCP request failed";
}

export function structuredResult(result, key) {
  if (result?.isError) throw new Error(extractError(result));
  if (result?.structuredContent && Object.prototype.hasOwnProperty.call(result.structuredContent, key)) {
    return result.structuredContent[key];
  }
  const text = result?.content?.find((item) => item?.type === "text")?.text;
  if (!text) throw new Error("Waterloo MCP returned no structured data.");
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Waterloo MCP returned invalid JSON."); }
  return data?.[key] ?? data;
}

export class McpConnector {
  constructor(root = process.cwd()) {
    this.root = root;
    this.client = null;
    this.transport = null;
    this.connecting = null;
  }
  async ensureConnected() {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const entry = entryPath(this.root);
      if (!existsSync(entry)) throw new Error("MCP connector is not configured (dist/index.js missing).");
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [entry],
        cwd: dirname(entry),
        env: safeEnvironment(this.root),
        stderr: "ignore",
      });
      const client = new Client({ name: "studyai-local-bridge", version: "1.0.0" });
      try {
        await client.connect(transport);
        this.transport = transport;
        this.client = client;
        return client;
      } catch (error) {
        await transport.close().catch(() => {});
        throw error;
      }
    })();
    try { return await this.connecting; } finally { this.connecting = null; }
  }
  async call(name, args = {}, timeoutMs = 0) {
    const client = await this.ensureConnected();
    const result = await client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: timeoutMs > 0 ? timeoutMs : 60000, resetTimeoutOnProgress: true, maxTotalTimeout: timeoutMs > 0 ? timeoutMs : 60000 },
    );
    if (result?.isError) throw new Error(extractError(result));
    return result;
  }
  async listCourses() { return this.call("list_courses", {}, 30000); }
  async getContent(courseId) { return structuredResult(await this.call("get_content", { courseId }, 60000), "modules"); }
  async getUpcoming(courseId, daysAhead = 30) {
    return structuredResult(await this.call("get_upcoming", { courseId, daysAhead }, 60000), "events");
  }
  async getAnnouncements(courseId) {
    return structuredResult(await this.call("get_announcements", { courseId }, 60000), "announcements");
  }
  async getAssignments(courseId) {
    return structuredResult(await this.call("get_assignments", { courseId }, 60000), "assignments");
  }
  async getGrades(courseId) {
    return structuredResult(await this.call("get_grades", { courseId }, 60000), "grades");
  }
  async getOutline(courseId) {
    const response = await this.call("get_course_outline", { courseId }, 60000);
    return response.structuredContent ?? structuredResult(response, "outline");
  }
  async getExamContext(courseId, assessment = "final exam") {
    return structuredResult(await this.call("get_exam_context", { course: courseId, assessment }, 120000), "context");
  }
  async searchCourseMaterials(courseId, query, maxFiles = 12, maxResults = 12) {
    return structuredResult(await this.call("search_course_materials",
      { course: courseId, query, maxFiles, maxResults }, 240000), "search");
  }
  async getTopicFile(courseId, topicId, pages = "1-8") {
    const response = await this.call("get_topic_file", { courseId, topicId, pages }, 240000);
    if (response?.structuredContent?.pages) return response.structuredContent;
    throw new Error("Waterloo MCP did not return readable page text.");
  }
  async getTopicText(courseId, topicId) {
    const response = await this.call("get_topic_text", { courseId, topicId }, 600000);
    if (response?.structuredContent?.pages) return response.structuredContent;
    throw new Error("Waterloo MCP did not return readable topic text.");
  }
  async close() {
    const transport = this.transport;
    this.transport = null;
    this.client = null;
    if (transport) await transport.close().catch(() => {});
  }
}

export function isReauthError(error) {
  const text = String(error?.message || error).toLowerCase();
  return /401|403|unauthori[sz]|forbidden|redirect|login|auth|session|cookie|credential|expired/.test(text);
}

