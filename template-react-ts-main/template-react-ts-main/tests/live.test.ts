import test from "node:test";
import assert from "node:assert/strict";
import { flattenTopics, type LearnModule } from "../src/domain/live";

test("flattens nested LEARN content with module provenance", () => {
  const modules: LearnModule[] = [{
    title: "Module A", moduleId: 1, topics: [{ id: "a", title: "Intro.pdf", type: "File", url: null }],
    modules: [{
      title: "Submodule", moduleId: 2, topics: [{ id: "b", title: "Lecture 2", type: "File", url: null }],
      modules: [],
    }],
  }];
  assert.deepEqual(flattenTopics(modules).map(item => item.moduleTitle), ["Module A", "Module A / Submodule"]);
  assert.deepEqual(flattenTopics(modules).map(item => item.id), ["a", "b"]);
});
