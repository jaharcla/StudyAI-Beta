import type { MultipleChoiceQuestion } from "./contracts";

export interface LearnTopic {
  id: string;
  title: string;
  type: string;
  moduleTitle: string;
  url: string | null;
}

export interface LearnModule {
  title: string;
  moduleId: number;
  topics: Array<{ id: string; title: string; type: string; url: string | null }>;
  modules: LearnModule[];
}

export interface LectureMaterial {
  courseId: string;
  topicId: string;
  title: string;
  totalPages: number;
  source: string;
  note?: string;
  sourceUrl?: string;
  pages: Array<{ page: number; text: string }>;
  status?: "ready" | "partial" | "unsupported" | "open-original" | "reauth-required" | "retryable-error";
  fetchedPageCount?: number;
  emptyPages?: number[];
  coverage?: number;
  kind?: string;
}

export interface LiveQuestion extends MultipleChoiceQuestion {
  objective: string;
  sourcePage: number;
  sourceQuote: string;
}

export interface ModelStatus {
  available: boolean;
  models: string[];
  preferred: string;
  provider?: "ollama" | "groq";
  message?: string;
}

export async function getLocalModels(): Promise<ModelStatus> {
  return getJson<ModelStatus>("/api/models");
}

export interface LearnAuthStatus {
  enabled: boolean;
  state: "connected" | "session-saved" | "login-required" | "reauth-required" | "offline" | "connecting";
  viewerUrl: string | null;
  message?: string;
}

export async function getLearnAuthStatus(): Promise<LearnAuthStatus> {
  return getJson<LearnAuthStatus>("/api/learn/status");
}

export async function startLearnLogin(reconnect = false): Promise<LearnAuthStatus> {
  return getJson<LearnAuthStatus>(reconnect ? "/api/learn/reconnect" : "/api/learn/connect", { method: "POST" });
}

export async function cancelLearnLogin(): Promise<LearnAuthStatus> {
  return getJson<LearnAuthStatus>("/api/learn/cancel", { method: "POST" });
}

export interface PracticeResponse {
  courseId: string;
  topicId: string;
  materialTitle: string;
  model: string;
  source: string;
  validation: string;
  questions: LiveQuestion[];
}

export function flattenTopics(modules: LearnModule[]): LearnTopic[] {
  const result: LearnTopic[] = [];
  const walk = (items: LearnModule[], ancestors: string[]) => {
    for (const mod of items) {
      const names = [...ancestors, mod.title];
      for (const topic of mod.topics ?? []) {
        result.push({ id: topic.id, title: topic.title, type: topic.type, url: topic.url, moduleTitle: names.join(" / ") });
      }
      walk(mod.modules ?? [], names);
    }
  };
  walk(modules, []);
  return result;
}

export function topicExtension(topic: Pick<LearnTopic, "title" | "url">): string {
  const known = new Set(["pdf", "ppt", "pptx", "doc", "docx", "xls", "xlsx", "ods", "odt", "odp", "rtf", "csv", "tsv", "txt", "md", "html", "htm", "srt", "vtt", "mp3", "wav", "m4a", "mp4", "webm", "mov", "png", "jpg", "jpeg", "tif", "tiff", "gif", "webp", "bmp", "svg", "zip"]);
  for (const source of [topic.title, topic.url]) {
    if (!source) continue;
    try {
      const pathname = new URL(source, "https://learn.uwaterloo.ca").pathname;
      const ext = pathname.split("/").pop()?.split(".").pop()?.toLowerCase() || "";
      if (known.has(ext)) return ext;
    } catch { /* try the next available source */ }
  }
  return "";
}

export function isReadableTopic(topic: LearnTopic): boolean {
  return ["pdf", "ppt", "pptx", "doc", "docx"].includes(topicExtension(topic));
}

export function topicKind(topic: LearnTopic): string {
  const type = topic.type.toLowerCase();
  const ext = topicExtension(topic);
  if (["pdf", "ppt", "pptx", "doc", "docx", "xls", "xlsx", "ods", "odt", "odp", "csv", "tsv", "txt", "md", "rtf", "zip"].includes(ext) || /file|document|pdf|powerpoint|presentation|spreadsheet|word/.test(type)) return "file";
  if (["htm", "html"].includes(ext) || /html|page|content/.test(type)) return "LEARN page";
  if (/quiz|test|exam/.test(type)) return "quiz";
  if (/assignment|dropbox/.test(type)) return "assignment";
  if (/discussion|forum/.test(type)) return "discussion";
  if (/audio|video|media/.test(type) || ["mp3", "wav", "m4a", "mp4", "webm"].includes(ext)) return "media";
  if (["png", "jpg", "jpeg", "tif", "tiff", "gif", "webp", "bmp", "svg"].includes(ext) || /image/.test(type)) return "image";
  if (/external|link|url|quicklink|lti|scorm|etext/.test(type)) return "external activity";
  return "LEARN activity";
}

export function learnOriginalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "learn.uwaterloo.ca" ? parsed.toString() : null;
  } catch { return null; }
}

export function topicOriginalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch { return null; }
}

async function getJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error : "Request failed (HTTP " + response.status + ")";
    throw new Error(response.status === 401 || response.status === 403
      ? "LEARN session expired. Reauthenticate your Waterloo connector, then retry. " + message
      : message);
  }
  return body as T;
}

export async function loadCourseModules(courseId: string): Promise<LearnModule[]> {
  const result = await getJson<{ modules: LearnModule[] }>("/api/courses/" + encodeURIComponent(courseId) + "/modules");
  if (!Array.isArray(result.modules)) throw new Error("The course content list was invalid.");
  return result.modules;
}

export async function loadLecture(courseId: string, topicId: string): Promise<LectureMaterial> {
  const result = await getJson<LectureMaterial>("/api/courses/" + encodeURIComponent(courseId) + "/material?topicId=" + encodeURIComponent(topicId));
  if (!Array.isArray(result.pages)) throw new Error("The lecture did not return readable pages.");
  return result;
}

export interface CourseOverviewSource {
  state: "available" | "unavailable" | "not-checked";
  count: number | null;
  items: any[];
  title?: string;
  url?: string | null;
  excerpt?: string;
}

export interface CourseOverviewWarning {
  source: string;
  message: string;
}

export interface CourseOverview {
  courseId: string;
  checkedAt: string;
  sources: Record<string, CourseOverviewSource>;
  due: Array<{ title: string; dueAt: string; origin: string; description: string }>;
  warnings: CourseOverviewWarning[];
  complete: boolean;
  provenance: string;
  cached?: boolean;
}

export interface ExamContextShape {
  studyMaterials?: any[];
  warnings?: any[];
  assessment?: string;
  [key: string]: any;
}

export interface ExamContextResult {
  courseId: string;
  context: ExamContextShape;
  source: string;
}

export interface CourseSearchShape {
  results?: any[];
  indexedFiles?: number;
  failedFiles?: number;
  [key: string]: any;
}

export interface CourseSearchResult {
  courseId: string;
  query: string;
  search: CourseSearchShape;
  source: string;
}

export async function loadCourseOverview(courseId: string, refresh = false, full = false): Promise<CourseOverview> {
  const params = new URLSearchParams();
  if (refresh) params.set("refresh", "1");
  if (full) params.set("full", "1");
  const suffix = params.toString() ? "?" + params.toString() : "";
  return getJson<CourseOverview>("/api/courses/" + encodeURIComponent(courseId) + "/overview" + suffix);
}

export async function loadExamContext(courseId: string, assessment = "final exam"): Promise<ExamContextResult> {
  const url = "/api/courses/" + encodeURIComponent(courseId) + "/exam-context?assessment=" + encodeURIComponent(assessment);
  return getJson<ExamContextResult>(url);
}

export async function searchCourseMaterials(courseId: string, query: string): Promise<CourseSearchResult> {
  const url = "/api/courses/" + encodeURIComponent(courseId) + "/search?q=" + encodeURIComponent(query);
  return getJson<CourseSearchResult>(url);
}

export interface LibreOfficeHealth {
  available: boolean;
  binary: string | null;
}

export async function checkLibreOfficeHealth(): Promise<LibreOfficeHealth> {
  return getJson<LibreOfficeHealth>("/api/health/libreoffice");
}
export async function generatePractice(courseId: string, topicId: string, model?: string, signal?: AbortSignal): Promise<PracticeResponse> {
  const result = await getJson<PracticeResponse>("/api/practice/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ courseId, topicId, model }),
    signal,
  });
  if (!Array.isArray(result.questions) || result.questions.length === 0) throw new Error("The model generated no usable questions.");
  return result;
}

