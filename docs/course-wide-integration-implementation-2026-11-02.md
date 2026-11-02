# StudyAI-Beta course-wide integration — implementation handoff (2026-11-02)

## Scope / status
This is real source code added to the user's existing Windows workspace through the live Filesystem MCP. **It has NOT been compiled, tested, or exercised against live LEARN in the current session.** The assistant has no direct shell on the user's Windows PC.

## Emergency repair performed
Eight project source files had unresolved Git merge-conflict markers (HEAD vs origin/main):
- server/index.mjs
- server/practice.mjs
- src/App.tsx
- src/domain/live.ts
- src/domain/session.ts
- src/PhaserGame.tsx
- public/style.css
- index.html

The assistant resolved each in favor of the newer HEAD implementation (UX redesign, model status/cancel, MCP gateway), rather than old origin/main sections. Re-read the final files and have Kilo run git status; Git may still require staging and completing the merge locally. No Git staging or commit was performed by ChatGPT. The docs/merge-rescue-2026-11-02 directory was created but no backups were actually placed there.

## Changes implemented in this integration
1. server/mcp-client.mjs: API wrappers for existing Waterloo LEARN tools get_upcoming, get_announcements, get_assignments, get_grades, get_course_outline, get_exam_context, search_course_materials. Also retains the previous get_content and get_topic_file wrappers.
2. server/course-intelligence.mjs: source-aware course overview assembler. Quick view requests upcoming events and announcements; optional full profile adds assignments, grades and outline. Partial source failures are reported as unavailable, while unrequested sources are explicitly not-checked. Deduplicates valid future deadlines, without fabricating missing dates or weights; 10-minute memory cache by course/mode.
3. server/index.mjs: localhost-only HTTP routes:
  GET /api/courses/:id/overview
  GET /api/courses/:id/overview?full=1
  GET /api/courses/:id/overview?refresh=1&full=1
  GET /api/courses/:id/exam-context?assessment=final%20exam
  GET /api/courses/:id/search?q=oblique%20triangles
  The routes require that the course ID appear in the successfully synced LEARN cache. Full exam-context and cross-file search are explicitly user-initiated due to cost. Search currently indexes up to 12 files per request to minimize load.
4. src/domain/course-hub.ts: typed fetch wrappers and interfaces.
5. src/CourseHub.tsx: new course-wide dashboard showing actual material count, next calendar and available assignment deadlines, source coverage/warnings, optional full profile, recent announcements, grades, official outline link, exam-context findings and cross-file passage search. Supports opening matching lecture topics where an ID can be mapped to the selected course's module tree.
6. src/App.tsx: renders CourseHub above the single-lecture preview whenever a course is selected. Existing demo, lecture workflow, game and progress retained.
7. public/style.css: styles for the source-aware dashboard.
8. server/course-intelligence.test.mjs: pure unit tests for partial source failures, deadline integrity, no fabricated dates, caching, quick-vs-full source loading.

## Required Windows verification
From app root C:\Users\Owner\Downloads\StudyAI-Beta\template-react-ts-main\template-react-ts-main:
  git status
  npm test
  npx tsc --noEmit
  npm run build-nolog
  npm run dev-study

Open http://localhost:5173 (restart Node backend after edits). Choose KIN 120. The course dashboard should retrieve quick overview (two sources); click Load full profile for five sources. Trigger Prepare exam study context and cross-file search on demand. Verify source warnings, expired LEARN session behavior, pagination, source URLs and dates. The full profile can be slow; timeouts in the external MCP must be investigated, not treated as no assignments.

## Dependencies NOT installed / tasks still pending
- ts-fsrs spaced repetition library: not installed and not wired into the persistence algorithm. Check Node version and library compatibility, add dependency locally, run tests.
- MathLive, JSXGraph, Numbas, H5P: not yet installed. Require typed activity adapter / grading contracts and non-LLM answer validation.
- Achieve (Macmillan): no direct authenticated read API has been demonstrated. Official LMS linking and grade sync are not permission to scrape publisher content.
- StudyAI is not yet a course-wide objective graph, spaced-repetition planner, or validated educational game engine. The new dashboard and existing MCP search are foundations for those milestones.

## Important care points
- Do not overwrite the resolved UX branch with origin/main.
- No private course content, LEARN cookies or tokens are included in this handoff.
- Avoid confusing 'not checked', 'unavailable' and 'available but empty' LMS source states.
- Preserve partial results when source queries fail.
