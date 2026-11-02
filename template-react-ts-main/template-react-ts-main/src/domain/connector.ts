import type { ConnectorSyncStatus, CourseSummary } from "./contracts";

export type CourseResponse = {
  courses: CourseSummary[];
  status: ConnectorSyncStatus;
  changes?: unknown;
};

const fallback: CourseSummary[] = [
  {
    id: "local-demo",
    code: "DEMO",
    title: "Synthetic study lab",
    dataSource: { kind: "synthetic", label: "Local synthetic demo", lastSyncedAt: null },
  },
];

function statusFromFailure(code?: number): ConnectorSyncStatus {
  const needsLogin = code === 401 || code === 403;
  return {
    state: needsLogin ? "reauth-required" : "offline",
    updatedAt: new Date().toISOString(),
    lastSuccessAt: null,
    message: needsLogin
      ? "Your Waterloo LEARN session needs to be authenticated again. Cached courses remain available."
      : "The local StudyAI connector is unavailable. You can continue using cached or demo content.",
  };
}

function isStatus(value: unknown): value is ConnectorSyncStatus {
  return Boolean(
    value &&
    typeof value === "object" &&
    "state" in value &&
    typeof value.state === "string" &&
    ["not-configured", "checking", "connected", "reauth-required", "offline"].includes(value.state),
  );
}

function isCourseResponse(value: unknown): value is CourseResponse {
  return Boolean(
    value &&
    typeof value === "object" &&
    "courses" in value &&
    Array.isArray(value.courses) &&
    "status" in value &&
    isStatus(value.status),
  );
}

async function fetchJson(url: string, options?: RequestInit): Promise<{ code: number; body: unknown }> {
  const response = await fetch(url, options);
  const body: unknown = await response.json().catch(() => null);
  return { code: response.status, body };
}

export async function getConnectorStatus(): Promise<ConnectorSyncStatus> {
  try {
    const { code, body } = await fetchJson("/api/health");
    if (body && typeof body === "object" && "state" in body && isStatus(body)) {
      return body;
    }
    return statusFromFailure(code);
  } catch {
    return statusFromFailure();
  }
}

async function getCourseResponse(url: string, options?: RequestInit): Promise<CourseResponse> {
  try {
    const { code, body } = await fetchJson(url, options);
    // The backend deliberately returns stale cached courses with a 401 or 503.
    // Preserve both the data and its precise authentication/offline status.
    if (isCourseResponse(body)) return body;
    return { courses: fallback, status: statusFromFailure(code) };
  } catch {
    return { courses: fallback, status: statusFromFailure() };
  }
}

export async function syncCourses(): Promise<CourseResponse> {
  return getCourseResponse("/api/courses/sync", { method: "POST" });
}

export async function getCourses(): Promise<CourseResponse> {
  return getCourseResponse("/api/courses");
}
