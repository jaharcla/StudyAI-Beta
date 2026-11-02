import test from "node:test";
import assert from "node:assert/strict";
import { normalizePages, validateGenerated, generateQuestions } from "./practice.mjs";

const pages = [
  { page: 1, text: "The sodium potassium pump uses ATP to move ions across the cell membrane. This transport mechanism establishes an electrochemical gradient." },
  { page: 2, text: "Diffusion moves particles down their concentration gradient without requiring an input of ATP." },
];

const correct = {
  objective: "Differentiate active transport from passive transport",
  prompt: "Why is the sodium potassium pump considered active transport?",
  choices: [
    { id: "a", label: "It uses ATP to move ions" },
    { id: "b", label: "It acts only in the nucleus" },
    { id: "c", label: "It stops all molecular movement" },
    { id: "d", label: "It removes the cell membrane" },
  ],
  correctChoiceId: "a",
  explanation: "ATP powers the ion movement.",
  sourcePage: 1,
  sourceQuote: "The sodium potassium pump uses ATP to move ions across the cell membrane.",
};

test("accepts questions citing an exact source quote", () => {
  const result = validateGenerated({ questions: [correct] }, pages, "course-1:topic-5");
  assert.equal(result.length, 1);
  assert.equal(result[0].sourcePage, 1);
  assert.match(result[0].id, /^practice-/);
});

test("rejects hallucinated quotes or fabricated page references", () => {
  assert.throws(() => validateGenerated({ questions: [{ ...correct, sourceQuote: "Made up reference to a nonexistent mechanism." }] }, pages, "source"), /matching source quote/);
  assert.throws(() => validateGenerated({ questions: [{ ...correct, sourcePage: 9 }] }, pages, "source"), /matching source quote/);
});

test("rejects duplicate options and missing answer IDs", () => {
  assert.throws(() => validateGenerated({ questions: [{ ...correct, choices: correct.choices.map(c => ({ ...c, id: "a" })) }] }, pages, "source"), /matching source quote/);
  assert.throws(() => validateGenerated({ questions: [{ ...correct, correctChoiceId: "e" }] }, pages, "source"), /matching source quote/);
});

test("normalizes extracted whitespace while retaining page numbers", () => {
  assert.deepEqual(normalizePages([{ page: 2, text: "  Alpha  \n  beta " }, { page: 3, text: "" }]), [{ page: 2, text: "Alpha beta" }]);
});

test("rejects empty lecture without calling a model", async () => {
  await assert.rejects(generateQuestions([], "topic"), /no readable page text/);
});
