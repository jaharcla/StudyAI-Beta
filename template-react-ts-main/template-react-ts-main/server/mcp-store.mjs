import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheDirectory } from "./cache.mjs";

// Separate server-side records. The existing browser localStorage mastery is not automatically mirrored here.
const queues = new Map();
function serialized(file, action) {
  const previous = queues.get(file) || Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  queues.set(file, next);
  next.finally(() => { if (queues.get(file) === next) queues.delete(file); }).catch(() => {});
  return next;
}
async function load(file) {
  try {
    const data = JSON.parse(await readFile(file, "utf8"));
    if (!Array.isArray(data)) throw new Error("Invalid StudyAI records.");
    return data;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}
async function replace(file, records) {
  await mkdir(cacheDirectory(), { recursive: true });
  const temporary = file + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(records, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}
export function createMcpStore(directory = cacheDirectory()) {
  const notesPath = join(directory, "mcp-notes.json");
  const attemptsPath = join(directory, "mcp-attempts.json");
  return {
    async listNotes(courseId) {
      const rows = await serialized(notesPath, () => load(notesPath));
      return rows.filter(item => !courseId || item.courseId === courseId).map(({ id, courseId, title, content, createdAt }) => ({ id, courseId, title, content, createdAt }));
    },
    async saveNote({ courseId, title, content }) {
      return serialized(notesPath, async () => {
        const rows = await load(notesPath);
        if (rows.length >= 500) throw new Error("Note limit reached (500).");
        const note = { id: randomUUID(), courseId, title, content, createdAt: new Date().toISOString() };
        await mkdir(directory, { recursive: true });
        const tmp = notesPath + "." + randomUUID() + ".tmp";
        await writeFile(tmp, JSON.stringify([...rows, note], null, 2), { encoding: "utf8", mode: 0o600 });
        await rename(tmp, notesPath);
        return note;
      });
    },
    async getProgress(courseId) {
      const rows = await serialized(attemptsPath, () => load(attemptsPath));
      const selected = rows.filter(item => !courseId || item.courseId === courseId);
      const byObjective = new Map();
      for (const record of selected) {
        const key = record.courseId + ":" + record.objectiveId;
        const item = byObjective.get(key) || { courseId: record.courseId, objectiveId: record.objectiveId, attempts: 0, correct: 0, lastAttemptAt: null };
        item.attempts++;
        item.correct += Number(record.correct);
        item.lastAttemptAt = record.recordedAt;
        byObjective.set(key, item);
      }
      return { source: "mcp-backend-only", syncedWithBrowser: false, totalAttempts: selected.length, objectives: [...byObjective.values()] };
    },
    async recordResult({ courseId, objectiveId, correct }) {
      return serialized(attemptsPath, async () => {
        const rows = await load(attemptsPath);
        if (rows.length >= 10000) throw new Error("Attempt limit reached (10,000).");
        const record = { id: randomUUID(), courseId, objectiveId, correct, recordedAt: new Date().toISOString() };
        await mkdir(directory, { recursive: true });
        const tmp = attemptsPath + "." + randomUUID() + ".tmp";
        await writeFile(tmp, JSON.stringify([...rows, record], null, 2), { encoding: "utf8", mode: 0o600 });
        await rename(tmp, attemptsPath);
        return record;
      });
    }
  };
}
