import test from "node:test";
import assert from "node:assert/strict";
import { LocalStorageProgress } from "../src/domain/persistence";
import type { AnswerResult, MasteryState, SubmittedAnswer } from "../src/domain/contracts";

function createStore() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

const answer: SubmittedAnswer = {
  questionId: "q1",
  choiceId: "a",
  submittedAt: "2026-11-02T12:00:00Z",
};
const result: AnswerResult = {
  questionId: "q1",
  objectiveId: "o1",
  submittedChoiceId: "a",
  correctChoiceId: "a",
  isCorrect: true,
  explanation: "Correct reasoning",
  evaluatedAt: "2026-11-02T12:00:01Z",
};
const mastery: MasteryState = {
  objectiveId: "o1",
  normalizedScore: 0.5,
  attempts: 1,
  correctCount: 1,
  lastAttemptAt: result.evaluatedAt,
  nextReviewAt: "2026-11-04T12:00:00Z",
};

test("saves and reloads mastery and detailed answer history", async () => {
  const store = createStore();
  const first = new LocalStorageProgress(store);
  await first.saveAnswer(answer, result, mastery);
  const second = new LocalStorageProgress(store);
  assert.deepEqual(await second.loadMastery("o1"), mastery);
  assert.deepEqual(await second.loadAnswerHistory("o1"), [{ answer, result }]);
  assert.equal((await second.loadAnswerHistory("another")).length, 0);
});

test("rejects mismatched answer results without modifying progress", async () => {
  const store = createStore();
  const persistence = new LocalStorageProgress(store);
  await assert.rejects(
    persistence.saveAnswer({ ...answer, questionId: "different" }, result, mastery),
    /mismatched/,
  );
  assert.equal(await persistence.loadMastery("o1"), null);
  assert.deepEqual(await persistence.loadAnswerHistory("o1"), []);
});

test("corrupted saved data fails safely", async () => {
  const store = createStore();
  store.setItem("studyai-demo:v1:mastery:o1", "{not json");
  store.setItem("studyai-demo:v1:attempts:o1", "null");
  const persistence = new LocalStorageProgress(store);
  assert.equal(await persistence.loadMastery("o1"), null);
  assert.deepEqual(await persistence.loadAnswerHistory("o1"), []);
});
