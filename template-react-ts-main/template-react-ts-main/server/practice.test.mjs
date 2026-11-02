import test from "node:test";
import assert from "node:assert/strict";
import { availableGroqModels, normalizePages, validateGenerated, generateQuestions } from "./practice.mjs";

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

test("Groq mode sends source text to its API and validates exact-source JSON", async () => {
  let calledUrl;
  let request;
  const result = await generateQuestions(pages, "course-1:topic-5", {
    provider: "groq",
    apiKey: "mock-key",
    model: "openai/gpt-oss-20b",
    fetch: async (url, options) => {
      calledUrl = url;
      request = options;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ questions: [correct] }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(calledUrl, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(request.headers.authorization, "Bearer mock-key");
  assert.equal(JSON.parse(request.body).model, "openai/gpt-oss-20b");
  assert.equal(result.model, "openai/gpt-oss-20b");
  assert.equal(result.questions[0].sourceQuote, correct.sourceQuote);
});

test("Groq mode refuses to send course text without a server-side API key", async () => {
  let called = false;
  await assert.rejects(generateQuestions(pages, "topic", {
    provider: "groq",
    fetch: async () => { called = true; },
  }), /GROQ_API_KEY/);
  assert.equal(called, false);
});

test("Groq model status checks the configured free-tier model without exposing the key", async () => {
  const status = await availableGroqModels("mock-key", {
    fetch: async (url, options) => {
      assert.equal(url, "https://api.groq.com/openai/v1/models");
      assert.equal(options.headers.authorization, "Bearer mock-key");
      return new Response(JSON.stringify({ data: [{ id: "openai/gpt-oss-20b", active: true }] }), { status: 200 });
    },
  });
  assert.deepEqual(status, { available: true, models: ["openai/gpt-oss-20b"], preferred: "openai/gpt-oss-20b", provider: "groq" });
});

test("Groq model status is unavailable without a configured secret", async () => {
  let called = false;
  const status = await availableGroqModels(undefined, { fetch: async () => { called = true; } });
  assert.equal(status.available, false);
  assert.equal(status.provider, "groq");
  assert.equal(called, false);
});
