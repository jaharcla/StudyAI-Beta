# ChatGPT independent review — 2026-11-02

## Scope
Direct filesystem changes to the existing React/Phaser study application. The Waterloo MCP implementation and credentials were left untouched. Kilo may be modifying other application files concurrently, so coordinate before changing these files again.

## Changes made
1. `vite/config.dev.mjs`: switched development port from 8080 to 5173 with `strictPort: true` to avoid the tunnel health endpoint on port 8080.
2. `src/domain/connector.ts`: preserves the backend's cached course list and explicit `reauth-required` status when `/api/courses/sync` returns a 401/403, rather than throwing away the response as generic offline state. Added payload checking and offline fallback.
3. `src/domain/persistence.ts`: stores full answer attempts under a separate browser-local key while preserving the existing mastery key format. Added `loadAnswerHistory(objectiveId)`, bounded per-objective history, and consistency checks for writes.
4. `tests/connector.test.ts`: regression coverage for 401, 503, invalid body, unavailable server, and health status.
5. `tests/persistence.test.ts`: regression coverage for round-trip attempt history, rejection of mismatched records, and corrupted storage.
6. `package.json`: configured `npm test` to run backend and frontend tests and preserved `test-frontend` and `test-study` aliases.

## Validation still required
No shell/Node commands can be run via this Filesystem MCP. These edits were confirmed by filesystem reads, NOT by executing the tests, build, or browser.
From `template-react-ts-main/template-react-ts-main`, run:
```powershell
npm test
npx tsc --noEmit
npm run build-nolog
npm run dev-study
```
Open the development frontend at http://localhost:5173 while `dev-study` runs. Validate the 401/403 reauthentication path and local answer history in a browser.

## Important remaining gaps
- Runtime frontend still uses synthetic lesson material; actual lecture retrieval, objective extraction, and question generation are not integrated.
- Mastery remains a simple score heuristic, not a calibrated retention estimate.
- The game lacks a complete multi-question encounter loop.
- LocalStorage is not an appropriate scalable multi-user or large-course-content datastore.
- There are separate third-party dependency audit advisories requiring evaluation.
