import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function entryPath(root) {
  const configured = process.env.WATERLOO_LEARN_MCP_ENTRY;
  const fallback = resolve(root, "../../waterloo_learn_mcp-main/waterloo_learn_mcp-main/dist/index.js");
  return configured ? (isAbsolute(configured) ? configured : resolve(root, configured)) : fallback;
}
function safeEnvironment() {
  const names = ["PATH", "PATHEXT", "SystemRoot", "SYSTEMROOT", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP"];
  return Object.fromEntries(names.filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
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
        env: safeEnvironment(),
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
  async call(name, args = {}) {
    const client = await this.ensureConnected();
    const result = await client.callTool({ name, arguments: args });
    if (result?.isError) throw new Error(extractError(result));
    return result;
  }
  async listCourses() { return this.call("list_courses"); }
  async getContent(courseId) { return structuredResult(await this.call("get_content", { courseId }), "modules"); }
  async getTopicFile(courseId, topicId, pages = "1-8") {
    const response = await this.call("get_topic_file", { courseId, topicId, pages });
    if (response?.structuredContent?.pages) return response.structuredContent;
    throw new Error("Waterloo MCP did not return readable page text.");
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
