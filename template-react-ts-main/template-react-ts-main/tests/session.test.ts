import test from "node:test";
import assert from "node:assert/strict";
import { readLastSession, saveLastSession } from "../src/domain/session";

test("restores the last locally saved study question set", () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const map = new Map<string, string>();
  const fake = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: fake });
  try {
    const session = {
      courseId: "12345",
      topic: null,
      source: "live" as const,
      modelInfo: null,
      questions: [{
        id: "q1", objectiveId: "o1", prompt: "Which statement is correct?",
        choices: [{ id: "a", label: "Option A" }, { id: "b", label: "Option B" }],
        correctChoiceId: "a", explanation: "Example.",
      }],
    };
    saveLastSession(session);
    assert.deepEqual(readLastSession(), session);
    saveLastSession({ ...session, questions: [] });
    assert.equal(readLastSession(), null);
  } finally {
    if (before) Object.defineProperty(globalThis, "localStorage", before);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
