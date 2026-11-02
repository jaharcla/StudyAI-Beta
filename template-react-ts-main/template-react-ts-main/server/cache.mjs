import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function cacheDirectory() {
  if (process.env.STUDYAI_CACHE_DIR) return process.env.STUDYAI_CACHE_DIR;
  const base = process.env.LOCALAPPDATA || (process.platform === 'win32' ? join(homedir(), 'AppData', 'Local') : join(homedir(), '.local', 'share'));
  return join(base, 'StudyAI-Beta', 'cache');
}
export function fingerprintCourse(course) {
  return createHash('sha256').update(JSON.stringify({ id: course.id, code: course.code, title: course.title, term: course.term })).digest('hex');
}
export function diffCourses(previous, next) {
  const oldById = new Map(previous.map((item) => [item.id, item]));
  const newById = new Map(next.map((item) => [item.id, item]));
  return {
    added: next.filter((item) => !oldById.has(item.id)).map((item) => item.id),
    updated: next.filter((item) => oldById.has(item.id) && oldById.get(item.id).fingerprint !== item.fingerprint).map((item) => item.id),
    removed: previous.filter((item) => !newById.has(item.id)).map((item) => item.id),
  };
}
export async function readCache(directory = cacheDirectory()) {
  try {
    const parsed = JSON.parse(await readFile(join(directory, 'courses.json'), 'utf8'));
    return { courses: Array.isArray(parsed.courses) ? parsed.courses : [], tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [], lastSuccessAt: typeof parsed.lastSuccessAt === 'string' ? parsed.lastSuccessAt : null };
  } catch (error) {
    if (error?.code === 'ENOENT') return { courses: [], tombstones: [], lastSuccessAt: null };
    throw new Error('Cache unavailable');
  }
}
export async function writeCache(cache, directory = cacheDirectory()) {
  await mkdir(directory, { recursive: true });
  const target = join(directory, 'courses.json');
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(cache), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
}
