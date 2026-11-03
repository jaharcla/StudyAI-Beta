import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { BASE_URL, LOGIN_HELP, OUTLINE_CACHE_DIR } from './config.js';
import { pdfToPng } from './pdf.js';
import { apiGet, apiGetBinary, apiVersion, AuthError, getContext, newPage } from './session.js';

const execFileAsync = promisify(execFile);

export interface Course {
  name: string;
  ou: number;
  url: string;
  /** Official course title from outline.uwaterloo.ca, e.g. "Matrices and Linear Systems". */
  title?: string | null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const OU_RE = /\/d2l\/home\/(\d+)/;

/**
 * Scrape the LEARN homepage for the My Courses widget. The course cards are
 * d2l web components (shadow DOM), but Playwright's CSS engine pierces shadow
 * roots, so `a[href*="/d2l/home/"]` finds the card links directly.
 */
async function scrapeCourses(): Promise<Course[]> {
  const page = await newPage();
  try {
    await page.goto(`${BASE_URL}/d2l/home`, { waitUntil: 'domcontentloaded' });

    if (!new URL(page.url()).pathname.startsWith('/d2l/home')) {
      throw new AuthError(`Redirected to ${page.url()} instead of the LEARN homepage. ${LOGIN_HELP}`);
    }

    // Best-effort: the My Courses widget tag varies by instance, so don't hard
    // fail if it's absent — just give the course-card links a chance to render.
    await page.waitForSelector('d2l-my-courses', { timeout: 8_000 }).catch(() => {});
    await page
      .waitForSelector('a[href*="/d2l/home/"]', { timeout: 8_000 })
      .catch(() => {});

    const links = await page.locator('a[href*="/d2l/home/"]').all();
    const byOu = new Map<number, Course>();
    for (const link of links) {
      const href = (await link.getAttribute('href')) ?? '';
      const match = href.match(OU_RE);
      if (!match) continue;
      const ou = Number(match[1]);

      let name = (
        await link.locator('.d2l-card-link-text').textContent({ timeout: 500 }).catch(() => null)
      )?.trim();
      name ||= (await link.getAttribute('title'))?.trim();
      name ||= (await link.getAttribute('aria-label'))?.trim();
      name ||= (await link.textContent())?.trim();
      if (!name || byOu.has(ou)) continue;

      byOu.set(ou, { name, ou, url: new URL(href, BASE_URL).href });
    }
    return [...byOu.values()];
  } finally {
    await page.close();
  }
}

interface Enrollment {
  OrgUnit: { Id: number; Name: string; Code: string | null; Type: { Code: string } };
  Access: { IsActive: boolean } | null;
}

interface PagedResultSet<T> {
  PagingInfo: { Bookmark: string; HasMoreItems: boolean };
  Items: T[];
}

/** Fallback when the homepage widget yields nothing: the enrollments API. */
async function coursesFromApi(): Promise<Course[]> {
  const lp = await apiVersion('lp');
  const courses: Course[] = [];
  let bookmark = '';
  for (let pageNum = 0; pageNum < 10; pageNum++) {
    const qs = `?orgUnitTypeId=3${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ''}`;
    const result = await apiGet<PagedResultSet<Enrollment>>(
      `/d2l/api/lp/${lp}/enrollments/myenrollments/${qs}`,
    );
    for (const item of result.Items) {
      if (item.Access && !item.Access.IsActive) continue;
      courses.push({
        name: item.OrgUnit.Name,
        ou: item.OrgUnit.Id,
        url: `${BASE_URL}/d2l/home/${item.OrgUnit.Id}`,
      });
    }
    if (!result.PagingInfo?.HasMoreItems) break;
    bookmark = result.PagingInfo.Bookmark;
  }
  return courses;
}

export async function listCourses(): Promise<Course[]> {
  // The enrollments API is fast and reliable across instances, so try it first.
  // Homepage scraping is the fallback (the My Courses widget markup varies).
  try {
    const courses = await coursesFromApi();
    if (courses.length > 0) return courses;
    console.error('Enrollments API returned no courses; falling back to homepage scrape.');
  } catch (err) {
    if (err instanceof AuthError) throw err;
    console.error(`Enrollments API failed (${err}); falling back to homepage scrape.`);
  }
  return scrapeCourses();
}

interface RawAnnouncement {
  Id: number;
  Title: string;
  Body: { Text: string; Html: string };
  StartDate: string | null;
  CreatedDate?: string | null;
  LastModifiedDate?: string | null;
  IsHidden?: boolean;
  Attachments?: { FileName: string }[];
}

export async function getAnnouncements(courseId: number) {
  const le = await apiVersion('le');
  const news = await apiGet<RawAnnouncement[]>(`/d2l/api/le/${le}/${courseId}/news/`);
  return news.map((item) => ({
    id: item.Id,
    title: item.Title,
    body: item.Body?.Text?.trim() || stripHtml(item.Body?.Html ?? ''),
    postedDate: item.StartDate ?? item.CreatedDate ?? null,
    lastModified: item.LastModifiedDate ?? null,
    attachments: item.Attachments?.map((a) => a.FileName) ?? [],
  }));
}

interface TocTopic {
  Identifier: string;
  Title: string;
  TypeIdentifier: string;
  Url: string | null;
  IsBroken?: boolean;
}

interface TocModule {
  ModuleId: number;
  Title: string;
  Modules: TocModule[];
  Topics: TocTopic[];
}

interface MarshalledModule {
  title: string;
  moduleId: number;
  topics: { title: string; type: string; url: string | null; id: string }[];
  modules: MarshalledModule[];
}

function marshalModule(mod: TocModule): MarshalledModule {
  return {
    title: mod.Title,
    moduleId: mod.ModuleId,
    topics: (mod.Topics ?? []).map((t) => ({
      title: t.Title,
      type: t.TypeIdentifier,
      url: t.Url ? new URL(t.Url, BASE_URL).href : null,
      id: t.Identifier,
    })),
    modules: (mod.Modules ?? []).map(marshalModule),
  };
}

export async function getContent(courseId: number) {
  const le = await apiVersion('le');
  const toc = await apiGet<{ Modules: TocModule[] }>(`/d2l/api/le/${le}/${courseId}/content/toc`);
  return (toc.Modules ?? []).map(marshalModule);
}

const OUTLINE_HOST = 'outline.uwaterloo.ca';
const OUTLINE_VIEWER_URL = `https://${OUTLINE_HOST}/viewer/`;
const TERM_RE = /\b(Winter|Spring|Fall)\s+(\d{4})\b/i;
const COURSE_CODE_RE = /\b[A-Z]{2,}\s*\d{2,4}[A-Z]?\b/g;

export interface CourseOutline {
  url: string;
  title: string;
  text: string;
}

interface CourseOutlineSnapshot extends CourseOutline {
  html: string;
  /** Revision date shown on the outline page ("May 12, 2026"); null if not found. */
  publishedAt: string | null;
}

interface CachedCourseOutline extends CourseOutlineSnapshot {
  schemaVersion: 2;
  courseId: number;
  courseName: string | null;
  fetchedAt: string;
}

export interface OutlineCacheRefreshResult {
  fetched: number;
  skipped: number;
  failed: number;
  results: {
    courseId: number;
    courseName: string;
    status: 'fetched' | 'skipped' | 'failed';
    message?: string;
  }[];
}

interface CourseOutlineLookup {
  codes: string[];
  term: string | null;
}

interface ViewerOutlineRow {
  term: string;
  course: string;
  title: string;
  sections: string;
  url: string;
}

function outlineCachePath(courseId: number): string {
  return path.join(OUTLINE_CACHE_DIR, `${courseId}.json`);
}

function cachedOutlineToResult(outline: CachedCourseOutline): CourseOutline {
  return { url: outline.url, title: outline.title, text: outline.text };
}

function isCachedCourseOutline(value: unknown, courseId: number): value is CachedCourseOutline {
  if (!value || typeof value !== 'object') return false;
  const outline = value as Partial<CachedCourseOutline>;
  return (
    outline.schemaVersion === 2 &&
    outline.courseId === courseId &&
    typeof outline.url === 'string' &&
    typeof outline.title === 'string' &&
    typeof outline.text === 'string' &&
    typeof outline.html === 'string' &&
    typeof outline.fetchedAt === 'string' &&
    (typeof outline.publishedAt === 'string' || outline.publishedAt === null)
  );
}

async function readCachedOutline(courseId: number): Promise<CachedCourseOutline | null> {
  try {
    const raw = await fs.readFile(outlineCachePath(courseId), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isCachedCourseOutline(parsed, courseId)) {
      console.warn(`Ignoring invalid cached outline for course ${courseId}.`);
      return null;
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`Could not read cached outline for course ${courseId}: ${err}`);
    }
    return null;
  }
}

async function writeCachedOutline(
  courseId: number,
  courseName: string | null,
  outline: CourseOutlineSnapshot,
): Promise<void> {
  await fs.mkdir(OUTLINE_CACHE_DIR, { recursive: true });
  const cache: CachedCourseOutline = {
    schemaVersion: 2,
    courseId,
    courseName,
    url: outline.url,
    title: outline.title,
    text: outline.text,
    html: outline.html,
    publishedAt: outline.publishedAt,
    fetchedAt: new Date().toISOString(),
  };
  const file = outlineCachePath(courseId);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600).catch(() => {});
}

function normalizeCourseCode(code: string): string {
  return code.toUpperCase().replace(/\s+/g, '');
}

function parseCourseOutlineLookup(courseName: string): CourseOutlineLookup {
  const termMatch = courseName.match(TERM_RE);
  const codeMatches = courseName.toUpperCase().match(COURSE_CODE_RE) ?? [];
  return {
    codes: [...new Set(codeMatches.map(normalizeCourseCode))],
    term: termMatch ? `${termMatch[1][0].toUpperCase()}${termMatch[1].slice(1).toLowerCase()} ${termMatch[2]}` : null,
  };
}

/** Depth-first search of the TOC for the first link into outline.uwaterloo.ca. */
function findOutlineUrl(modules: MarshalledModule[]): string | null {
  for (const mod of modules) {
    for (const topic of mod.topics) {
      if (!topic.url) continue;
      try {
        if (new URL(topic.url).host === OUTLINE_HOST) return topic.url;
      } catch {
        // unparseable URL — skip
      }
    }
    const nested = findOutlineUrl(mod.modules);
    if (nested) return nested;
  }
  return null;
}

async function findCourse(courseId: number): Promise<Course | null> {
  const courses = await listCourses();
  return courses.find((course) => course.ou === courseId) ?? null;
}

async function scrapeViewerOutlines(): Promise<ViewerOutlineRow[]> {
  const page = await newPage();
  try {
    await page.goto(OUTLINE_VIEWER_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (new URL(page.url()).host !== OUTLINE_HOST) {
      throw new AuthError(
        `Redirected to ${page.url()} — the outline.uwaterloo.ca session is missing or expired. ${LOGIN_HELP}`,
      );
    }

    await page
      .waitForSelector('a[href*="/viewer/view/"]', { timeout: 15_000 })
      .catch(() => {});

    return await page.evaluate(() => {
      const rows: ViewerOutlineRow[] = [];
      for (const heading of document.querySelectorAll('h3')) {
        const term = heading.textContent?.trim() ?? '';
        const section = heading.closest('div');
        if (!term || !section) continue;

        for (const row of section.querySelectorAll('tbody tr')) {
          const cells = [...row.querySelectorAll('td')].map((cell) => cell.textContent?.trim() ?? '');
          const link = row.querySelector<HTMLAnchorElement>('a[href*="/viewer/view/"]');
          if (!cells[0] || !link?.href) continue;
          rows.push({
            term,
            course: cells[0],
            title: cells[1] ?? '',
            sections: cells[2] ?? '',
            url: link.href,
          });
        }
      }
      return rows;
    });
  } finally {
    await page.close();
  }
}

let viewerOutlineCache: { rows: ViewerOutlineRow[]; at: number } | null = null;
let viewerOutlineFailureAt = 0;
const VIEWER_CACHE_TTL_MS = 30 * 60 * 1000;

/** Viewer rows, cached so list_courses and get_course_outline share one scrape. */
async function getViewerOutlines(): Promise<ViewerOutlineRow[]> {
  if (viewerOutlineCache && Date.now() - viewerOutlineCache.at < VIEWER_CACHE_TTL_MS) {
    return viewerOutlineCache.rows;
  }
  const rows = await scrapeViewerOutlines();
  viewerOutlineCache = { rows, at: Date.now() };
  viewerOutlineFailureAt = 0;
  return rows;
}

async function findOutlineUrlFromViewer(course: Course): Promise<string | null> {
  const lookup = parseCourseOutlineLookup(course.name);
  if (lookup.codes.length === 0 || !lookup.term) return null;

  const rows = await getViewerOutlines();
  const match = rows.find(
    (row) =>
      row.term.toLowerCase() === lookup.term?.toLowerCase() &&
      lookup.codes.includes(normalizeCourseCode(row.course)),
  );
  return match?.url ?? null;
}

function findViewerRow(rows: ViewerOutlineRow[], lookup: CourseOutlineLookup): ViewerOutlineRow | undefined {
  const byCode = rows.filter((row) => lookup.codes.includes(normalizeCourseCode(row.course)));
  // Titles are stable across terms, so any term's row will do when the LEARN
  // name's term is absent or doesn't match a viewer section.
  return byCode.find((row) => row.term.toLowerCase() === lookup.term?.toLowerCase()) ?? byCode[0];
}

/**
 * Courses enriched with their official titles from the outline.uwaterloo.ca
 * viewer (LEARN names are just code + term, e.g. "SYDE 114 - Spring 2026").
 * If the outline session isn't configured or the scrape fails, courses are
 * returned with title: null rather than erroring.
 */
export async function listCoursesWithTitles(): Promise<Course[]> {
  const courses = await listCourses();
  let rows: ViewerOutlineRow[] = [];
  // Remember a failed scrape for the cache TTL so a missing outline session
  // doesn't add a doomed page load to every list_courses call.
  if (Date.now() - viewerOutlineFailureAt >= VIEWER_CACHE_TTL_MS) {
    try {
      rows = await getViewerOutlines();
    } catch (err) {
      viewerOutlineFailureAt = Date.now();
      console.error(`Outline viewer titles unavailable (${err}); returning LEARN names only.`);
    }
  }
  return courses.map((course) => {
    const row = findViewerRow(rows, parseCourseOutlineLookup(course.name));
    return { ...course, title: row?.title.trim() || null };
  });
}

/**
 * Revision date from the outline page, e.g. 'Published May 12, 2026 (latest)'
 * → "May 12, 2026". Single-revision outlines omit the "(latest)" suffix, so
 * match the date shape itself.
 */
function parsePublishedDate(html: string): string | null {
  const m = html.match(/revision-current[^>]*>\s*Published\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

/**
 * The outline page is server-rendered, so a plain GET with the session cookies
 * is enough to read the current revision date — no browser render needed.
 * Returns null when the check is impossible (expired session redirects to SSO,
 * network error), so callers fall back to the cached copy.
 */
async function fetchPublishedDate(outlineUrl: string): Promise<string | null> {
  try {
    const ctx = await getContext();
    const resp = await ctx.request.get(outlineUrl, { maxRedirects: 0 });
    if (resp.status() !== 200) return null;
    return parsePublishedDate(await resp.text());
  } catch {
    return null;
  }
}

async function fetchOutlinePageSnapshot(outlineUrl: string): Promise<CourseOutlineSnapshot> {
  const page = await newPage();
  try {
    await page.goto(outlineUrl, { waitUntil: 'networkidle', timeout: 60_000 });
    if (new URL(page.url()).host !== OUTLINE_HOST) {
      throw new AuthError(
        `Redirected to ${page.url()} — the outline.uwaterloo.ca session is missing or expired. ${LOGIN_HELP}`,
      );
    }
    const title = await page.title();
    const raw = await page.evaluate(() => document.body.innerText);
    const html = await page.content();
    return {
      url: page.url(),
      title,
      text: raw.replace(/\n{3,}/g, '\n\n').trim(),
      html,
      publishedAt: parsePublishedDate(html),
    };
  } finally {
    await page.close();
  }
}

async function fetchLiveCourseOutline(courseId: number, course: Course | null): Promise<CourseOutlineSnapshot> {
  let viewerError: unknown = null;
  if (course) {
    try {
      const viewerOutlineUrl = await findOutlineUrlFromViewer(course);
      if (viewerOutlineUrl) return fetchOutlinePageSnapshot(viewerOutlineUrl);
    } catch (err) {
      if (err instanceof AuthError) throw err;
      viewerError = err;
      console.error(`Outline viewer lookup failed for ${course.name} (${courseId}): ${err}`);
    }
  }

  const modules = await getContent(courseId);
  const outlineUrl = findOutlineUrl(modules);
  if (outlineUrl) return fetchOutlinePageSnapshot(outlineUrl);

  const viewerNote =
    viewerError instanceof Error ? ` Outline viewer lookup also failed: ${viewerError.message}` : '';
  throw new Error(
    `No outline.uwaterloo.ca outline found for course ${course?.name ?? courseId}. ` +
      'The course may not use Outline.uwaterloo.ca, or it may upload the outline as a PDF instead. ' +
      `Use get_content to look for an outline/syllabus file.${viewerNote}`,
  );
}

// Cached outlines never expire on their own; instead each read is allowed one
// cheap revision-date probe per interval, and a full refetch only happens when
// the outline page reports a new published revision.
const REVISION_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const revisionCheckedAt = new Map<number, number>();

/**
 * Fetch the official course outline from outline.uwaterloo.ca. The outline
 * site is SSO-gated separately from LEARN; its session cookie is captured by
 * `npm run login`, so a redirect off-host means that session has expired.
 */
export async function getCourseOutline(courseId: number): Promise<CourseOutline> {
  const cached = await readCachedOutline(courseId);
  if (cached) {
    const lastChecked = revisionCheckedAt.get(courseId) ?? 0;
    if (Date.now() - lastChecked < REVISION_CHECK_INTERVAL_MS) {
      return cachedOutlineToResult(cached);
    }
    const published = await fetchPublishedDate(cached.url);
    revisionCheckedAt.set(courseId, Date.now());
    if (published === null || published === cached.publishedAt) {
      return cachedOutlineToResult(cached);
    }
    console.error(
      `Outline for course ${courseId} has a new revision (published ${published}); refetching.`,
    );
  }

  const course = await findCourse(courseId);
  let outline: CourseOutlineSnapshot;
  try {
    outline = await fetchLiveCourseOutline(courseId, course);
  } catch (err) {
    if (cached) {
      console.warn(`Refetch of updated outline for course ${courseId} failed (${err}); serving cached copy.`);
      return cachedOutlineToResult(cached);
    }
    throw err;
  }
  await writeCachedOutline(courseId, course?.name ?? null, outline).catch((err) => {
    console.warn(`Could not cache outline for course ${courseId}: ${err}`);
  });
  return { url: outline.url, title: outline.title, text: outline.text };
}

export async function refreshOutlineCache(): Promise<OutlineCacheRefreshResult> {
  const courses = await listCourses();
  const results: OutlineCacheRefreshResult['results'] = [];

  for (const course of courses) {
    try {
      const outline = await fetchLiveCourseOutline(course.ou, course);
      await writeCachedOutline(course.ou, course.name, outline);
      results.push({ courseId: course.ou, courseName: course.name, status: 'fetched' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('No outline.uwaterloo.ca outline found') ? 'skipped' : 'failed';
      results.push({ courseId: course.ou, courseName: course.name, status, message });
    }
  }

  return {
    fetched: results.filter((result) => result.status === 'fetched').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    failed: results.filter((result) => result.status === 'failed').length,
    results,
  };
}

// Image tokens scale with pixel area, so the render targets a fixed output
// size instead of a fixed multiplier (intrinsic PDF page sizes vary wildly).
// ~800px on the long edge ≈ scale 1.0 for letter pages: ~650 tokens/page,
// still legible for handwritten lecture notes.
const TARGET_LONG_EDGE_PX = 800;
// 30 pages ≈ 20k tokens, fitting Claude Code's stock 25k MAX_MCP_OUTPUT_TOKENS
// with headroom — past the cap, the failure mode is the explicit continuation
// note below, not the client silently dropping trailing pages.
const MAX_PAGES = 30;

export interface TopicFileResult {
  filename: string;
  totalPages: number;
  /** Pages actually rendered (1-based numbers matching slide numbers). */
  pages: { page: number; png: Buffer; text: string }[];
  /** Set when more pages exist than were rendered. */
  note?: string;
}

export interface TopicTextResult {
  filename: string;
  totalPages: number;
  pages: { page: number; text: string }[];
  status?: 'ready' | 'partial' | 'open-original';
  kind?: string;
  sourceUrl?: string;
  reason?: string;
  note?: string;
}

async function ocrImage(input: Buffer, extension = '.png'): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learn-ocr-'));
  const imagePath = path.join(dir, `source${['.jpg', '.jpeg', '.tif', '.tiff', '.png'].includes(extension) ? extension : '.png'}`);
  try {
    await fs.writeFile(imagePath, input);
    const result = await execFileAsync('tesseract', [imagePath, 'stdout'], { timeout: 30_000, maxBuffer: 2_000_000 });
    return result.stdout.trim();
  } catch { return ''; }
  finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

async function transcribeMedia(input: Buffer, filename: string): Promise<string> {
  if (input.length > 500_000_000) throw new Error('This media file exceeds the 500 MB transcription limit.');
  const packageDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
  const python = process.env.STUDYAI_TRANSCRIBE_PYTHON || path.join(packageDir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const script = fileURLToPath(new URL('../scripts/transcribe.py', import.meta.url));
  await fs.access(python);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learn-transcribe-'));
  const ext = path.extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, '');
  const inputPath = path.join(dir, `media${ext || '.bin'}`);
  try {
    await fs.writeFile(inputPath, input);
    const { stdout } = await execFileAsync(python, [script, inputPath], { timeout: 600_000, maxBuffer: 8_000_000 });
    const result = JSON.parse(stdout) as { language?: string; segments?: Array<{ start: number; end: number; text: string }> };
    const transcript = (result.segments ?? []).map((segment) => {
      const timestamp = (seconds: number) => new Date(seconds * 1000).toISOString().slice(11, 23);
      return `[${timestamp(segment.start)}–${timestamp(segment.end)}] ${segment.text}`;
    }).join('\n').slice(0, 500_000);
    if (!/\.(mp4|webm|mov|mkv|avi|mpeg|mpg)$/i.test(ext)) return transcript;
    const framesDir = path.join(dir, 'frames');
    await fs.mkdir(framesDir);
    await execFileAsync('ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', inputPath, '-vf', 'fps=1/30,scale=1280:-2', '-frames:v', '120', path.join(framesDir, 'frame-%03d.png')], { timeout: 180_000, maxBuffer: 1_000_000 }).catch(() => null);
    const frameFiles = (await fs.readdir(framesDir)).filter((name) => /^frame-\d+\.png$/.test(name)).sort().slice(0, 120);
    const visuals: string[] = [];
    for (let i = 0; i < frameFiles.length; i++) {
      const text = await ocrImage(await fs.readFile(path.join(framesDir, frameFiles[i])));
      if (text) visuals.push(`[On-screen text at ${new Date(i * 30_000).toISOString().slice(11, 19)}] ${text}`);
    }
    return [transcript, ...visuals].filter(Boolean).join('\n').slice(0, 800_000);
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

/** Parse "4", "1-5", or "2,4,7-9" into a sorted list of unique 1-based page numbers. */
function parsePages(spec: string): number[] {
  const pages = new Set<number>();
  for (const part of spec.split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new Error(`Invalid pages value "${spec}" — use forms like "4", "1-5", or "2,4,7-9".`);
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : start;
    if (start < 1 || end < start) throw new Error(`Invalid page range "${part.trim()}" in "${spec}".`);
    for (let p = start; p <= end && pages.size <= MAX_PAGES; p++) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}

/** Find a LibreOffice binary for Office→PDF conversion, or null if not installed. */
async function findSoffice(): Promise<string | null> {
  const candidates = [
    'soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/usr/bin/soffice',
    '/usr/local/bin/soffice',
    '/opt/homebrew/bin/soffice',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ];
  for (const bin of candidates) {
    try {
      await execFileAsync(bin, ['--version'], { timeout: 15_000 });
      return bin;
    } catch {
      // not found / not executable — try the next candidate
    }
  }
  return null;
}

async function officeToPdf(input: Buffer, filename: string): Promise<Buffer> {
  const soffice = await findSoffice();
  if (!soffice) {
    throw new Error(
      'This topic is a PowerPoint or Word file, and rendering it needs LibreOffice. ' +
        'Install it with `winget install TheDocumentFoundation.LibreOffice` (Windows) ' +
        'or `brew install --cask libreoffice` (macOS), then retry.',
    );
  }
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'learn-mcp-'));
  try {
    const inputPath = path.join(tmpDir, filename.replace(/[/\\]/g, '_') || 'slides.pptx');
    await fs.writeFile(inputPath, input);
    await execFileAsync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', tmpDir, inputPath], {
      timeout: 120_000,
    });
    const pdfPath = inputPath.replace(/\.[^.]+$/, '') + '.pdf';
    return await fs.readFile(pdfPath);
  } catch (err) {
    throw new Error(`LibreOffice failed to convert ${filename} to PDF: ${err instanceof Error ? err.message : err}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function downloadTopicPdf(courseId: number, topicId: string): Promise<{ filename: string; pdf: Buffer }> {
  const le = await apiVersion('le');
  let file;
  try {
    file = await apiGetBinary(`/d2l/api/le/${le}/${courseId}/content/topics/${topicId}/file`);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    // Some topic types 404 on the API route; the legacy direct-download route
    // covers them with the same session cookies.
    file = await apiGetBinary(`/d2l/le/content/${courseId}/topics/files/download/${topicId}/DirectFileTopicDownload`);
  }

  let filename = file.filename ?? 'file';
  const ext = path.extname(filename).toLowerCase();
  const isPdf = ext === '.pdf' || file.contentType.includes('application/pdf') || file.body.subarray(0, 4).toString() === '%PDF';
  const zipEntries = file.body.subarray(0, Math.min(file.body.length, 2_000_000)).toString('latin1');
  const archiveFormat = /word\/document\.xml/i.test(zipEntries) ? 'docx' : /xl\/workbook\.xml/i.test(zipEntries) ? 'xlsx' : /ppt\/presentation\.xml/i.test(zipEntries) ? 'pptx' : /\/content\.xml/i.test(zipEntries) ? 'odt' : '';
  const isOffice = /\.(pptx?|docx?|xlsx?|od[pts]|rtf|csv|tsv)$/i.test(filename) ||
    /presentation|wordprocessingml|spreadsheetml|ms-excel|msword/.test(file.contentType) || Boolean(archiveFormat);
  if (ext === '' && archiveFormat) filename += `.${archiveFormat}`;

  let pdf: Buffer;
  if (isPdf) {
    pdf = file.body;
  } else if (isOffice) {
    pdf = await officeToPdf(file.body, filename);
  } else {
    throw new Error(
      `Topic file "${filename}" (${file.contentType || 'unknown type'}) needs a text or native-content reader.`,
    );
  }
  return { filename, pdf };
}

/** Extract every page's text without rendering images (used by bulk indexing). */
export async function getTopicText(courseId: number, topicId: string): Promise<TopicTextResult> {
  const modules = await getContent(courseId);
  const find = (items: MarshalledModule[]): MarshalledModule['topics'][number] | undefined => {
    for (const mod of items) {
      const topic = mod.topics.find((item) => item.id === topicId);
      if (topic) return topic;
      const nested = find(mod.modules);
      if (nested) return nested;
    }
  };
  const topic = find(modules);
  const type = topic?.type ?? 'unknown';
  const sourceUrl = topic?.url ?? undefined;
  const ext = path.extname(topic?.title ?? '').toLowerCase() || path.extname(sourceUrl ?? '').toLowerCase();
  const externalType = /external|quick.?link|lti|scorm|etext/i.test(type);
  let externalUrl = false;
  try { externalUrl = Boolean(sourceUrl) && new URL(sourceUrl!).origin !== new URL(BASE_URL).origin; } catch { externalUrl = false; }
  const kind = /quiz|test/i.test(type) ? 'quiz' : /assignment|dropbox/i.test(type) ? 'assignment' : /discussion|forum/i.test(type) ? 'discussion' : /audio|video|media/i.test(type) || /\.(mp3|wav|m4a|aac|ogg|flac|wma|mp4|webm|mov|mkv|avi|mpeg|mpg)$/i.test(ext) ? 'media' : externalType && externalUrl ? 'external' : /html|page/i.test(type) || ['.html', '.htm'].includes(ext) ? 'html' : /\.(png|jpe?g|tiff?|gif|webp|bmp|svg)$/i.test(ext) ? 'image' : /file|document/i.test(type) || /\.(pdf|pptx?|docx?|xlsx?|od[pts]|rtf|csv|tsv|txt|md|xml|json|srt|vtt)$/i.test(ext) ? 'file' : 'learn-activity';
  const textExts = ['.txt', '.md', '.csv', '.tsv', '.srt', '.vtt', '.xml', '.json'];
  try {
    if (kind === 'external') return { filename: topic?.title ?? 'LEARN activity', totalPages: 0, pages: [], status: 'open-original', kind, sourceUrl, reason: 'This item launches an external or licensed provider. StudyAI preserves its link and does not bypass provider access.' };
    if (kind === 'media' && !['.srt', '.vtt'].includes(ext)) {
      const file = await apiGetBinary(`/d2l/api/le/${await apiVersion('le')}/${courseId}/content/topics/${topicId}/file`);
      const transcript = await transcribeMedia(file.body, file.filename ?? topic?.title ?? 'media');
      if (!transcript) throw new Error('No speech was detected in this media.');
      return { filename: file.filename ?? topic?.title ?? 'LEARN media', totalPages: 1, pages: [{ page: 1, text: transcript }], status: 'ready', kind: 'media', sourceUrl, note: 'Audio was transcribed locally and sampled video frames were checked for on-screen text. Speech transcription and OCR can misread content; verify against the original.' };
    }
    if (kind === 'quiz' || kind === 'assignment' || kind === 'discussion' || kind === 'learn-activity') throw new Error('Use the LEARN activity reader.');
    if (ext === '.svg') {
      const file = await apiGetBinary(`/d2l/api/le/${await apiVersion('le')}/${courseId}/content/topics/${topicId}/file`);
      if (file.body.length > 20_000_000) throw new Error('This image exceeds the 20 MB processing limit.');
      const svg = file.body.toString('utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
      const labels = svg.replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|#160);/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
      if (labels) return { filename: file.filename ?? topic?.title ?? 'LEARN image', totalPages: 1, pages: [{ page: 1, text: labels.slice(0, 200_000) }], status: 'ready', kind: 'image', sourceUrl, note: 'Text labels were read from the SVG source without rendering or running scripts.' };
    }
    if (/^\.(png|jpe?g|tiff?|gif|webp|bmp)$/i.test(ext)) {
      const file = await apiGetBinary(`/d2l/api/le/${await apiVersion('le')}/${courseId}/content/topics/${topicId}/file`);
      if (file.body.length > 20_000_000) throw new Error('This image exceeds the 20 MB processing limit.');
      const text = await ocrImage(file.body, ext);
      if (text) return { filename: file.filename ?? topic?.title ?? 'LEARN image', totalPages: 1, pages: [{ page: 1, text }], status: 'ready', kind: 'image', sourceUrl, note: 'Text was extracted with local OCR; verify uncertain characters against the original image.' };
    }
    if (textExts.includes(ext)) {
      const file = await apiGetBinary(`/d2l/api/le/${await apiVersion('le')}/${courseId}/content/topics/${topicId}/file`);
      if (file.body.length > 20_000_000) throw new Error('This LEARN text file exceeds the 20 MB processing limit.');
      const raw = file.body.toString('utf8').replace(/^\uFEFF/, '');
      const text = ext === '.json' ? JSON.stringify(JSON.parse(raw), null, 2) : ext === '.xml' ? raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : raw;
      return { filename: file.filename ?? topic?.title ?? 'LEARN material', totalPages: 1, pages: [{ page: 1, text: text.slice(0, 200_000) }], status: 'ready', kind, sourceUrl };
    }
    const { filename, pdf } = await downloadTopicPdf(courseId, topicId);
    const pages = await pdfToPng(pdf, { returnMetadataOnly: true, extractText: true });
    let pageTexts = pages.map((page) => ({ page: page.pageNumber, text: page.text ?? '' }));
    let note: string | undefined;
    const empty = pageTexts.filter((page) => !page.text).map((page) => page.page);
    if (empty.length && empty.length <= 20) {
      const images = await pdfToPng(pdf, { pagesToProcess: empty });
      for (const image of images) {
        const text = await ocrImage(image.content);
        if (text) pageTexts = pageTexts.map((page) => page.page === image.pageNumber ? { ...page, text } : page);
      }
      if (pageTexts.some((page) => empty.includes(page.page) && page.text)) note = 'Scanned pages were read with local OCR; verify uncertain characters against the original.';
    }
    return { filename, totalPages: pages.length, pages: pageTexts, status: 'ready', kind, sourceUrl, note };
  } catch (error) {
    if (error instanceof AuthError && !(['html', 'media'].includes(kind) && /Expected a file from/.test(error.message))) throw error;
    if (sourceUrl) {
      const parsed = new URL(sourceUrl);
      if (parsed.origin === new URL(BASE_URL).origin && parsed.pathname.startsWith('/d2l/')) {
        const page = await newPage();
        try {
          await page.route('**/*', (route) => {
            try {
              if (new URL(route.request().url()).origin === new URL(BASE_URL).origin) return route.continue();
            } catch { /* block malformed or non-HTTP targets */ }
            return route.abort();
          });
          await page.goto(parsed.href, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
          const landed = new URL(page.url());
          if (landed.hostname !== new URL(BASE_URL).hostname) throw new AuthError(`LEARN redirected this topic outside the authenticated course. ${LOGIN_HELP}`);
          if (/login|signin|sso/i.test(landed.pathname)) throw new AuthError(`LEARN sign-in is required to read this activity. ${LOGIN_HELP}`);
          const text = await page.locator('main').innerText({ timeout: 3_000 }).catch(() => page.locator('body').innerText({ timeout: 3_000 }).catch(() => ''));
          let captions = '';
          if (kind === 'media') {
            const tracks = await page.locator('audio track[src], video track[src]').evaluateAll((nodes) => nodes.map((node) => (node as HTMLTrackElement).src));
            for (const track of tracks) {
              try {
                const parsedTrack = new URL(track);
                if (parsedTrack.origin !== landed.origin) continue;
                captions += '\n' + await page.evaluate(async (href) => {
                  const response = await fetch(href, { credentials: 'same-origin' });
                  return response.ok ? (await response.text()).slice(0, 500_000) : '';
                }, parsedTrack.href);
              } catch { /* inaccessible captions are reported by the fallback */ }
            }
          }
          const captionText = captions.replace(/^WEBVTT[^\n]*|\d{2}:\d{2}:\d{2}\.\d{3} -->[^\n]*/gm, '').replace(/<[^>]+>/g, ' ').trim();
          const combined = [text, captionText && `Available captions:\n${captionText}`].filter(Boolean).join('\n\n');
          const cleaned = combined.replace(/\n{3,}/g, '\n\n').trim().slice(0, 200_000);
          if (cleaned) return { filename: topic?.title ?? 'LEARN activity', totalPages: 1, pages: [{ page: 1, text: cleaned }], status: 'ready', kind, sourceUrl, note: captionText ? 'Transcript extracted from LEARN captions.' : undefined };
        } finally { await page.close(); }
      }
    }
    const reason = kind === 'media' ? 'This media item is identified, but no transcript or caption track is available to the connector.' : kind === 'external' ? 'This activity is hosted by an external provider and requires opening it in LEARN.' : 'LEARN exposes this activity, but its contents are not available through the authenticated read-only view.';
    return { filename: topic?.title ?? 'LEARN activity', totalPages: 0, pages: [], status: 'open-original', kind, sourceUrl, reason };
  }
}

/** Return page text and images; PowerPoint/Word files first go through LibreOffice. */
export async function getTopicFile(
  courseId: number,
  topicId: string,
  pagesSpec?: string,
): Promise<TopicFileResult> {
  const { filename, pdf } = await downloadTopicPdf(courseId, topicId);

  const meta = await pdfToPng(pdf, { returnMetadataOnly: true, viewportScale: 1 });
  const totalPages = meta.length;
  const longEdgePts = Math.max(meta[0]?.width ?? 0, meta[0]?.height ?? 0);
  const viewportScale = longEdgePts > 0 ? Math.min(2, TARGET_LONG_EDGE_PX / longEdgePts) : 1;

  let pagesToProcess = pagesSpec ? parsePages(pagesSpec) : Array.from({ length: totalPages }, (_, i) => i + 1);
  pagesToProcess = pagesToProcess.filter((p) => p <= totalPages);
  if (pagesToProcess.length === 0) {
    throw new Error(`No pages to render: "${pagesSpec}" is outside this document's range (1-${totalPages}).`);
  }
  let note: string | undefined;
  if (pagesToProcess.length > MAX_PAGES) {
    pagesToProcess = pagesToProcess.slice(0, MAX_PAGES);
    note =
      `Rendered the first ${MAX_PAGES} of ${totalPages} pages. ` +
      `Call again with pages="${pagesToProcess[MAX_PAGES - 1] + 1}-${totalPages}" for the rest.`;
  }
  const rendered = await pdfToPng(pdf, { viewportScale, pagesToProcess, extractText: true });
  return {
    filename,
    totalPages,
    pages: rendered
      .filter((p) => p.content)
      .map((p) => ({ page: p.pageNumber, png: p.content as Buffer, text: p.text ?? '' })),
    note,
  };
}

interface RawGradeValue {
  GradeObjectName: string;
  GradeObjectTypeName?: string;
  DisplayedGrade: string | null;
  PointsNumerator: number | null;
  PointsDenominator: number | null;
  WeightedNumerator?: number | null;
  WeightedDenominator?: number | null;
  Comments?: { Text: string; Html: string } | null;
}

/** Fallback: scrape the My Grades page table when the grades API is restricted. */
async function scrapeGrades(courseId: number) {
  const page = await newPage();
  try {
    await page.goto(`${BASE_URL}/d2l/lms/grades/my_grades/main.d2l?ou=${courseId}`, {
      waitUntil: 'domcontentloaded',
    });
    if (page.url().includes('login') || page.url().includes('error')) {
      throw new AuthError(`Could not open My Grades for course ${courseId}. ${LOGIN_HELP}`);
    }
    await page.waitForSelector('table.d2l-table', { timeout: 15_000 });
    const rows = await page.locator('table.d2l-table tr').all();
    const grades: { item: string; grade: string }[] = [];
    for (const row of rows) {
      const cells = (await row.locator('th, td').allTextContents()).map((c) =>
        c.replace(/\s+/g, ' ').trim(),
      );
      const [item, ...rest] = cells;
      const grade = rest.filter(Boolean).join(' | ');
      if (item && grade) grades.push({ item, grade });
    }
    return grades;
  } finally {
    await page.close();
  }
}

export async function getGrades(courseId: number) {
  const le = await apiVersion('le');
  try {
    const values = await apiGet<RawGradeValue[]>(
      `/d2l/api/le/${le}/${courseId}/grades/values/myGradeValues/`,
    );
    return values.map((g) => ({
      item: g.GradeObjectName,
      type: g.GradeObjectTypeName ?? null,
      grade: g.DisplayedGrade,
      points:
        g.PointsNumerator != null && g.PointsDenominator != null
          ? `${g.PointsNumerator}/${g.PointsDenominator}`
          : null,
      weight:
        g.WeightedNumerator != null && g.WeightedDenominator != null
          ? `${g.WeightedNumerator}/${g.WeightedDenominator}`
          : null,
      feedback: g.Comments?.Text?.trim() || (g.Comments?.Html ? stripHtml(g.Comments.Html) : null) || null,
    }));
  } catch (err) {
    if (err instanceof AuthError) throw err;
    console.error(`Grades API failed (${err}); scraping the My Grades page instead.`);
    return scrapeGrades(courseId);
  }
}

interface RawDropboxFolder {
  Id: number;
  Name: string;
  CustomInstructions: { Text: string; Html: string } | null;
  Attachments: { FileId: number; FileName: string; Size: number }[];
  Availability: { StartDate: string | null; EndDate: string | null } | null;
  DueDate: string | null;
  IsHidden: boolean;
  Assessment: { ScoreDenominator: number | null } | null;
  GradeItemId: number | null;
}

interface RawEntityDropbox {
  Entity: { EntityId: number; EntityType: string };
  Status: number;
  Feedback: {
    Score: number | null;
    Feedback: { Text: string; Html: string } | null;
    Files?: { FileName: string }[];
  } | null;
  Submissions: {
    Id: number;
    SubmissionDate: string;
    Comment: { Text: string; Html: string } | null;
    Files: { FileName: string; Size: number }[];
  }[];
  CompletionDate: string | null;
}

const DROPBOX_STATUS: Record<number, string> = { 0: 'unsubmitted', 1: 'submitted', 2: 'draft' };

/**
 * Assignments (dropbox folders) with the caller's own submission status and
 * any released feedback. Called as a student, the submissions endpoint returns
 * only your own entity; a folder whose submissions can't be read still appears
 * with submissionStatus "unknown".
 */
export async function getAssignments(courseId: number) {
  const le = await apiVersion('le');
  const folders = await apiGet<RawDropboxFolder[]>(`/d2l/api/le/${le}/${courseId}/dropbox/folders/`);

  return Promise.all(
    folders
      .filter((f) => !f.IsHidden)
      .map(async (f) => {
        // An empty array means no submission record yet (unsubmitted); only a
        // failed call leaves the status truly unknown.
        let entity: RawEntityDropbox | undefined;
        let status = 'unknown';
        try {
          const entities = await apiGet<RawEntityDropbox[]>(
            `/d2l/api/le/${le}/${courseId}/dropbox/folders/${f.Id}/submissions/`,
          );
          entity = entities[0];
          status = entity ? (DROPBOX_STATUS[entity.Status] ?? `status ${entity.Status}`) : 'unsubmitted';
        } catch (err) {
          if (err instanceof AuthError) throw err;
          console.error(`Submissions unavailable for dropbox ${f.Id} (${err}).`);
        }

        const feedback = entity?.Feedback;
        return {
          id: f.Id,
          name: f.Name.trim(),
          dueDate: f.DueDate,
          availableUntil: f.Availability?.EndDate ?? null,
          instructions:
            f.CustomInstructions?.Text?.trim() ||
            (f.CustomInstructions?.Html ? stripHtml(f.CustomInstructions.Html) : null) ||
            null,
          attachments: f.Attachments?.map((a) => a.FileName) ?? [],
          outOf: f.Assessment?.ScoreDenominator ?? null,
          submissionStatus: status,
          submittedAt: entity?.CompletionDate ?? null,
          submissions:
            entity?.Submissions.map((s) => ({
              date: s.SubmissionDate,
              files: s.Files.map((file) => file.FileName),
              comment: s.Comment?.Text?.trim() || null,
            })) ?? [],
          feedback: feedback
            ? {
                score: feedback.Score,
                comment:
                  feedback.Feedback?.Text?.trim() ||
                  (feedback.Feedback?.Html ? stripHtml(feedback.Feedback.Html) : null) ||
                  null,
                files: feedback.Files?.map((file) => file.FileName) ?? [],
              }
            : null,
        };
      }),
  );
}

interface RawCalendarEvent {
  EventId: number;
  OrgUnitId: number;
  Title: string;
  Description: string | null;
  StartDateTime: string;
  EndDateTime: string | null;
  IsAllDayEvent: boolean;
  HasVisited?: boolean;
}

export async function getUpcoming(courseId: number, daysAhead = 30) {
  const le = await apiVersion('le');
  const start = new Date();
  const end = new Date(start.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const qs = new URLSearchParams({
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
  });
  const data = await apiGet<RawCalendarEvent[] | { Objects: RawCalendarEvent[] }>(
    `/d2l/api/le/${le}/${courseId}/calendar/events/myEvents/?${qs}`,
  );
  const events = Array.isArray(data) ? data : (data.Objects ?? []);
  return events
    .map((e) => ({
      title: e.Title,
      start: e.StartDateTime,
      end: e.EndDateTime,
      allDay: e.IsAllDayEvent,
      description: e.Description ? stripHtml(e.Description) : null,
    }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

