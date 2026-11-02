import type { MultipleChoiceQuestion } from "./contracts";

export interface LearnTopic {
  id: string;
  title: string;
  type: string;
  moduleTitle: string;
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
  pages: Array<{ page: number; text: string }>;
  status?: "ready" | "partial" | "unsupported" | "open-original" | "reauth-required" | "retryable-error";
  fetchedPageCount?: number;
  emptyPages?: number[];
  coverage?: number;
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
  message?: string;
}

export async function getLocalModels(): Promise<ModelStatus> {
  return getJson<ModelStatus>("/api/models");
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
        result.push({ id: topic.id, title: topic.title, type: topic.type, moduleTitle: names.join(" / ") });
      }
      walk(mod.modules ?? [], names);
    }
  };
  walk(modules, []);
  return result;
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
