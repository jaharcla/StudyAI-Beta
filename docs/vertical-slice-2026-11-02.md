# StudyAI-Beta: real-course-to-battle vertical slice

Implemented directly in the existing frontend/backend on 2026-11-02. The code is saved but HAS NOT been run or compiled on Windows by ChatGPT. Do not report these features as verified until acceptance tests pass.

## What was added
- server/mcp-client.mjs: generalized MCP calls; reads get_content modules and get_topic_file page text using local Waterloo LEARN MCP.
- server/index.mjs: localhost routes GET /api/courses/:id/modules, GET /api/courses/:id/material?topicId=... and POST /api/practice/generate with a course ID and topic ID. Restricts access to course IDs present in a successful course sync. Maintains a small in-memory material cache.
- server/practice.mjs: local-only Ollama question generation (default qwen3:8b), with learning objectives, 4-option questions, explanations, and page-specific verbatim evidence. Checks exact quote/page presence and option consistency, rejecting invalid output rather than inventing replacement content. This does NOT validate scientific correctness.
- src/domain/live.ts: typed API client and recursive module flattening.
- src/App.tsx: course -> lecture -> preview -> generate -> battle -> feedback and source quote -> mastery tracking. Synthetic demo remains distinct.
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
- Only first eight pages are read; diagrams and some PowerPoint/Word/link topics may be unavailable.
- No calibrated mastery or assessment-weighted priority algorithm yet.
- Local model generated questions may still be scientifically wrong despite exact-quote matching.
- Ollama must be reachable locally. No silent fake questions used as fallback for real lectures.
- Browser-local answer history/mastery and last question set are saved; there is no multi-session question bank or cross-device sync yet.
- No interactive equation-specific game mode yet.
- Runtime tests on user's Windows PC still required.

## Agent coordination
Inspect the actual files, run tests, and resolve errors before marking the milestone verified. This document supersedes the earlier review for the newly implemented vertical slice. Do not overwrite code without reviewing existing changes.
