# StudyAI-Beta course-wide integration — implementation handoff (2026-11-02)

## Scope / status
This integration is implemented in the existing Windows workspace. It was compiled, tested, and exercised against authenticated LEARN on 2026-11-02. Current verification results appear below; earlier notes in this handoff describe the original implementation history.

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

## Windows verification completed
- `npm test`: 32/32 backend and frontend tests passed.
- `npx tsc --noEmit`: passed.
- `npm run build-nolog`: passed.
- `npm run dev-study`: app ran at `http://localhost:5173` with API on `127.0.0.1:4174`.
- Browser: real LEARN sync and topic tree, full 5/5-source course profile, exam context, cross-file search, 49-page source extraction, local `qwen3:8b` question generation, correct answer feedback, FSRS persistence, reload restoration, typed HTML fallback, and desktop/mobile viewport overflow checks passed.
- Search indexed 10 files, returned 4 cited passages, and reported 2 failed files without failing the whole search.
- The initial search hit the MCP SDK 60-second default. The client now sets a bounded 240-second timeout for this operation; a retry completed successfully.

## Dependencies NOT installed / tasks still pending
- `ts-fsrs` v6 / FSRS-7 is installed and connected to browser-local answer persistence; Node 24.13.0 satisfies its runtime requirement.
- MathLive, JSXGraph, Numbas, H5P: not yet installed. Require typed activity adapter / grading contracts and non-LLM answer validation.
- Achieve (Macmillan): no direct authenticated read API has been demonstrated. Official LMS linking and grade sync are not permission to scrape publisher content.
- The current practice activity is multiple-choice combat. MathLive/JSXGraph equation and graphing activities, a full objective graph, and scientifically validated AI grading remain future work.

## Important care points
- Do not overwrite the resolved UX branch with origin/main.
- No private course content, LEARN cookies or tokens are included in this handoff.
- Avoid confusing 'not checked', 'unavailable' and 'available but empty' LMS source states.
- Preserve partial results when source queries fail.
