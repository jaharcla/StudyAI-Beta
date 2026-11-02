import test from "node:test";
import assert from "node:assert/strict";
import { flattenTopics, isReadableTopic, learnOriginalUrl, topicExtension, type LearnModule } from "../src/domain/live";

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

test("routes topic formats from their LEARN URLs and only trusts Waterloo originals", () => {
  const modules: LearnModule[] = [{
    title: "Course", moduleId: 1, modules: [], topics: [
      { id: "pdf", title: "Lecture", type: "File", url: "https://learn.uwaterloo.ca/content/lecture.pdf?download=1" },
      { id: "page", title: "Module page", type: "File", url: "https://learn.uwaterloo.ca/content/module.html" },
      { id: "link", title: "Publisher", type: "Link", url: "https://example.com/book" },
      { id: "bad", title: "External", type: "Link", url: "javascript:alert(1)" },
    ],
  }];
  const topics = flattenTopics(modules);
  assert.equal(topicExtension(topics[0]), "pdf");
  assert.equal(isReadableTopic(topics[0]), true);
  assert.equal(isReadableTopic(topics[1]), false);
  assert.equal(learnOriginalUrl(topics[1].url), "https://learn.uwaterloo.ca/content/module.html");
  assert.equal(learnOriginalUrl(topics[2].url), null);
  assert.equal(learnOriginalUrl(topics[3].url), null);
});
