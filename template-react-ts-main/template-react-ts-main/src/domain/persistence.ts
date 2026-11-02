import type {
  AnswerResult,
  MasteryState,
  StudyProgressPersistence,
  SubmittedAnswer,
} from "./contracts";

const MASTERY_PREFIX = "studyai-demo:v1:mastery:";
const ATTEMPTS_PREFIX = "studyai-demo:v1:attempts:";
const MAX_ATTEMPTS_PER_OBJECTIVE = 500;

export interface SavedAttempt {
  answer: SubmittedAnswer;
  result: AnswerResult;
}

type StorageAdapter = Pick<Storage, "getItem" | "setItem">;

/**
 * Browser-local progress storage. Preserves the original mastery key format
 * while also retaining answer history for later misconception analysis.
 */
export class LocalStorageProgress implements StudyProgressPersistence {
  constructor(
    private readonly storage: StorageAdapter | null =
      typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage,
  ) {}

  async loadMastery(objectiveId: string): Promise<MasteryState | null> {
    try {
      const raw = this.storage?.getItem(MASTERY_PREFIX + objectiveId);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !("objectiveId" in parsed) ||
        parsed.objectiveId !== objectiveId ||
        !("normalizedScore" in parsed) ||
        typeof parsed.normalizedScore !== "number" ||
        !Number.isFinite(parsed.normalizedScore)
      ) return null;
      return parsed as MasteryState;
    } catch {
      return null;
    }
  }

  async loadAnswerHistory(objectiveId: string): Promise<SavedAttempt[]> {
    try {
      const raw = this.storage?.getItem(ATTEMPTS_PREFIX + objectiveId);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is SavedAttempt =>
        Boolean(
          item &&
          typeof item === "object" &&
          "answer" in item &&
          item.answer &&
          typeof item.answer === "object" &&
          "questionId" in item.answer &&
          typeof item.answer.questionId === "string" &&
          "result" in item &&
          item.result &&
          typeof item.result === "object" &&
          "objectiveId" in item.result &&
          item.result.objectiveId === objectiveId,
        ),
      );
    } catch {
      return [];
    }
  }

  async saveAnswer(
    answer: SubmittedAnswer,
    result: AnswerResult,
    mastery: MasteryState,
  ): Promise<void> {
    if (
      answer.questionId !== result.questionId ||
      mastery.objectiveId !== result.objectiveId
    ) {
      throw new Error("Cannot save a mismatched study answer and mastery record.");
    }
    if (!this.storage) return;
    const previous = await this.loadAnswerHistory(mastery.objectiveId);
    const attempts = [...previous, { answer, result }].slice(-MAX_ATTEMPTS_PER_OBJECTIVE);
    this.storage.setItem(ATTEMPTS_PREFIX + mastery.objectiveId, JSON.stringify(attempts));
    this.storage.setItem(MASTERY_PREFIX + mastery.objectiveId, JSON.stringify(mastery));
  }
}
