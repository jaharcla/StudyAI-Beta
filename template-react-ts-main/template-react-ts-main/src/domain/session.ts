import type { LearnTopic, PracticeResponse } from "./live";
import type { MultipleChoiceQuestion } from "./contracts";

export interface SessionQuestion extends MultipleChoiceQuestion {
  objective?: string;
  sourcePage?: number;
  sourceQuote?: string;
}

export interface SavedSession {
  questions: SessionQuestion[];
  source: "live" | "demo";
  courseId: string;
  topic: LearnTopic | null;
  modelInfo: PracticeResponse | null;
}

const KEY = "studyai-beta:v0.1:last-session";

export function readLastSession(): SavedSession | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || !("questions" in value) || !Array.isArray(value.questions) ||
        !("source" in value) || (value.source !== "demo" && value.source !== "live") ||
        !("courseId" in value) || typeof value.courseId !== "string") return null;
    const session = value as SavedSession;
    if (session.questions.some(question => !question || typeof question.id !== "string" || typeof question.prompt !== "string" ||
        typeof question.correctChoiceId !== "string" || !Array.isArray(question.choices))) return null;
    return session;
  } catch { return null; }
}

export function saveLastSession(session: SavedSession): void {
  try {
    if (!session.questions.length) {
      globalThis.localStorage?.removeItem(KEY);
      return;
    }
    globalThis.localStorage?.setItem(KEY, JSON.stringify(session));
  } catch {
    // Private browsing may disable storage; studying still works in memory.
  }
}
