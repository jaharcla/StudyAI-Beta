# StudyAI-Beta: real-course-to-battle vertical slice

Implemented in the existing frontend/backend and verified on Windows on 2026-11-02. The app synced 17 LEARN courses, loaded 82 CHEM 120 topics, extracted all 49 pages of a real PDF, generated local Ollama questions, saved answers and FSRS-7 review state, and restored the completed encounter after reload. Course overview, full profile, exam context, and cross-file search were exercised. Search returned 4 cited passages from 10 indexed files; 2 files failed independently.

## What was added
- server/mcp-client.mjs: generalized MCP calls; reads get_content modules and get_topic_text page text using local Waterloo LEARN MCP. Long-running course search now has a bounded 240-second SDK timeout.
- server/index.mjs: localhost routes GET /api/courses/:id/modules, GET /api/courses/:id/material?topicId=... and POST /api/practice/generate with a course ID and topic ID. Restricts access to course IDs present in a successful course sync. Maintains a small in-memory material cache.
- server/practice.mjs: local-only Ollama question generation (default qwen3:8b), with learning objectives, 4-option questions, explanations, and page-specific verbatim evidence. Checks exact quote/page presence and option consistency, rejecting invalid output rather than inventing replacement content. This does NOT validate scientific correctness.
- src/domain/live.ts: typed API client and recursive module flattening with original LEARN URLs. Unsupported HTML, link, and media topics are labeled and linked to LEARN instead of sent to the document converter.
- src/App.tsx: course -> lecture -> preview -> generate -> battle -> feedback and source quote -> mastery tracking. FSRS-7 schedules local reviews; the synthetic demo remains distinct.
- src/game/scenes/Game.ts: generic encounter text and health bars.
- public/style.css: styles for the new workflow.
- src/domain/session.ts and tests/session.test.ts: browser-local saved question-set restoration across page refreshes.
- server/practice.test.mjs and tests/live.test.ts: additional regression tests.

## Run on Windows
Stop old dev server. In PowerShell:
  cd "C:\Users\Owner\Downloads\StudyAI-Beta\template-react-ts-main\template-react-ts-main"
  npm test
  npx tsc --noEmit
  npm run build-nolog
  ollama list
  npm run dev-study

Open http://localhost:5173. Start Ollama if its background service is not running. If qwen3:8b is missing, ask user before downloading it. Another installed model can be selected using:
  $env:STUDYAI_OLLAMA_MODEL="MODEL_NAME"
before launching the dev server.

## Acceptance walkthrough
1. Sync my courses -> actual course list.
2. Choose CHEM 120 or another real course -> modules and topics appear.
3. Select a readable lecture PDF -> preview contains actual source text.
4. Generate lecture-based challenge -> local model returns questions with source quotations.
5. Submit answers -> health bars and detailed feedback update.
6. Finish encounter -> result summary; refresh and replay to verify mastery persistence.
7. Play demo encounter -> clearly marked synthetic mode.

## Known limitations
- The activity engine currently offers source-grounded multiple-choice battles; equation entry and graphing activities are not implemented.
- Diagrams and scanned pages may lack text evidence. Unsupported LEARN-native pages, eText, LTI, and media open in LEARN.
- FSRS controls review scheduling; the displayed familiarity score remains an experimental heuristic.
- Local model generated questions may still be scientifically wrong despite exact-quote matching.
- Ollama must be reachable locally. No silent fake questions used as fallback for real lectures.
- Browser-local answer history/mastery and last question set are saved; there is no multi-session question bank or cross-device sync yet.
- Progress is browser-local and does not sync across devices or browsers.

## Agent coordination
This verification update supersedes the earlier unverified handoff for the current source tree. Re-run the commands above after future backend or frontend changes.
