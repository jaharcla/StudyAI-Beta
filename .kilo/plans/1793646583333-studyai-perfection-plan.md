# StudyAI-Beta: Perfection Plan

## Goal
Make StudyAI-Beta a reliable, local-first course-study app: real Waterloo LEARN content → validated practice → adaptive mastery, with a green test/type/build baseline, no unresolved merge conflicts, and remediated security/advisory issues.

## Scope boundaries (in / out of scope)
- **In scope:** React/Phaser frontend, Node API, MCP Streamable HTTP gateway, Waterloo LEARN connector usage, local-first persistence, content ingestion hardening, course dashboard, test suite, security hygiene.
- **Out of scope:** Achieve/Macmillan LTI integration (no verified public student API; link-out only), cloud/multi-user sync, Chrome/Firefox browser extension, remote model calls (local Ollama only), committing changes (not requested).

## Repo layout
- `template-react-ts-main/template-react-ts-main/` — React 19 + TypeScript + Vite + Phaser 3 frontend; Node API (port 4174); MCP gateway (`/mcp`). Scripts: `test` (backend + frontend), `test-backend`, `test-frontend`, `build-nolog`, `dev-study`.
- `waterloo_learn_mcp-main/waterloo_learn_mcp-main/` — Waterloo LEARN MCP connector (12 tools), requires WatIAM/Duo login; must be `tsc` built to `dist/index.js` (referenced by `.kilo/kilo.json`).
- `playwright-mcp-main/playwright-mcp-main/` — third-party Microsoft Playwright MCP; not part of StudyAI, leave untouched.

## Audit findings (problems to fix)
1. **Unresolved merge conflicts block compilation.** `<<<<<<< HEAD` / `=======` / `>>>>>>> origin/main` markers in `src/App.tsx`, `src/PhaserGame.tsx`, `src/domain/live.ts`, `server/index.mjs`, `server/practice.mjs`, `tests/session.test.ts`. Orphan artifacts: `src/domain/contracts.ts.orig`, `src/domain/study.ts.orig`, `src/domain/study.ts.rej`, `docs/merge-rescue-2026-11-02/`.
2. **Two divergent implementations never reconciled.** HEAD = vertical slice (model selection, cancel generation, MCP gateway, course-library UI, keyboard nav, answer history). origin/main = older, simpler UI. Docs (vertical-slice/ux-review) confirm HEAD was implemented 2026-11-02 but never compiled/run on Windows.
3. **Fragile content ingestion.** Server hardcodes `get_topic_file(..., "1-8")`; no topic-kind routing; no `get_topic_text`; no ready/partial/open-original/reauth-required/unsupported statuses; MCP -32001 timeout risk vs 120s LibreOffice conversion; no LibreOffice health check; fixed 8-page ceiling presented as complete.
4. **Quality gaps.** No E2E/Playwright tests in frontend; npm audit advisories (4 moderate, 4 high, 1 critical) unremediated; no LICENSE in connector repo; mastery is an uncalibrated heuristic; localStorage-only persistence (no cloud sync — by design for now).
5. **Doc drift.** Architecture doc (course-wide, FSRS, MathLive, JSXGraph) and reliability spec are researched/unimplemented and not verified end-to-end.

## Decisions (recommended)
| Decision | Recommendation |
|---|---|
| Merge winner | **HEAD** — newer, feature-complete vertical slice per docs. origin/main UI is a strict subset regression; cherry-pick nothing unique. |
| Orphan artifacts | Delete `.orig`/`.rej` files and `docs/merge-rescue-2026-11-02/`. |
| Baseline first | `npx tsc --noEmit` green + `npm test` green (backend + frontend) before any feature work. |
| Local persistence | Keep browser localStorage for mastery/answer history; keep JSON course cache. Defer SQLite/cloud sync to a later phase. |
| Scheduler | Add `ts-fsrs` (Milestone C) only after confirming Node >= 24 (v6 requirement); outputs are estimates, not validated mastery. |
| Math mode | MathLive + Compute Engine + JSXGraph KIN120 exercise as a later phase (Milestone D), gated on symbolic-equivalence validation. |
| Achieve / LTI | Out of scope — link-out only; no verified public student read API. |

## Open questions (confirm before implementation)
1. Approve HEAD as merge winner and deletion of orphan conflict artifacts?
2. Approve scope: implement Milestone A (course index/dashboard) fully now; defer Milestones B–E to a follow-up plan?
3. Approve adding `ts-fsrs` conditional on a Node >= 24 check?

## Phase task list (implementation order)

### Phase 0 — Stabilize (green baseline)
1. Resolve all merge conflicts: keep HEAD versions of `src/App.tsx`, `src/PhaserGame.tsx`, `src/domain/live.ts`, `server/index.mjs`, `server/practice.mjs`; strip all conflict markers.
2. Reconcile `live.ts` exports: `ModelStatus`/`getLocalModels` (HEAD) must remain since HEAD `App.tsx` imports them.
3. Delete `src/domain/contracts.ts.orig`, `src/domain/study.ts.orig`, `src/domain/study.ts.rej`, `docs/merge-rescue-2026-11-02/`.
4. Run `npx tsc --noEmit` (frontend) and `tsc` (connector); fix type errors.
5. Run `npm test` (backend + frontend); fix failures. `tests/session.test.ts` must resolve to HEAD's expectations (courseId retained across saves).

### Phase 1 — Harden content ingestion (course-content-reliability.md)
6. Add topic-kind router: classify topic type (file / LEARN native HTML / external URL / eText-LTI / SCORM / quiz / assignment / discussion / media / unknown). Classify files by MIME + magic bytes + extension, not filename alone.
7. Add `get_topic_text` MCP tool (text-only, ALL pages, one conversion) to the Waterloo connector; call it from StudyAI; remove hardcoded `pages="1-8"` from text ingestion. Keep `get_topic_file` for requested visual pages only.
8. Return discriminated typed statuses: `ready` / `partial` / `open-original` / `reauth-required` / `retryable-error` / `unsupported`, with coverage (`totalPages`, `fetchedPageCount`, `emptyPages`) and warnings.
9. Auth handling: 401/403/redirect → `reauth-required`; preserve last-good cache labeled "Last synced"; manual "Reconnect LEARN" only (WatIAM/Duo cannot be automated); never leak `auth.json`/cookies/tokens to UI, logs, or git.
10. Timeouts: 180–240s ceiling for extraction; faster budgets for lists/metadata; capped exponential backoff (1–2 retries); never retry auth failures or unsupported formats indefinitely.
11. LibreOffice health check at startup (`soffice.exe` in PATH + standard Windows install paths); cache availability; graceful "Office preview unavailable" + open-original fallback when missing.
12. Format readers: PDF (text layer; scanned → optional local OCR), PPTX/DOCX (cached LibreOffice conversion), TXT/MD/HTML (decode + sanitize), XLSX/CSV (bounded, sheet/cell provenance, no fake page numbers), images (sanitized preview; OCR optional), audio/video (playback/open link; transcription optional), ZIP/unknown/corrupt/password-protected (safe metadata, zip-bomb and path-traversal guards), quiz/assignment/discussion/survey (metadata + deep link only, never treat as lecture PDF).
13. UI: per-topic nonfatal statuses; a failed topic never blanks the screen or clears practice; cancel-able loading stages (Downloading/Converting/Extracting/Indexing); readable mobile errors; no raw stack traces or absolute paths in UI; detailed sanitized diagnostics in dev logs only.
14. Tests: unit tests for router/error classifier/timeout; integration tests with fake MCP + fixture files; Playwright desktop + mobile E2E; guarded real-course smoke test after user authenticates (never log course content or IDs).

### Phase 2 — Course-wide dashboard (architecture Milestone A)
15. Wire existing MCP calls before any custom indexing: `get_course_outline`, `get_upcoming`, `get_announcements`, `get_grades`, `get_assignments`, `search_course_materials`.
16. Persist normalized entities locally (course/module/material/objective/assessment/attempt) with content fingerprints + tombstones; metadata-first, bounded lazy extraction.
17. Dashboard: current unit, next exam/due date, what needs review; each item links to primary source; full-course search.
18. Tests: never invent deadline/weight; distinguish missing permission from no work.

### Phase 3 — Adaptive practice (architecture Milestones B–C, scoped)
19. Link material pages → objectives → questions/activities with stable IDs, citations, audit trail; search-first, fetch relevant pages only; stale-cache warnings.
20. Integrate `ts-fsrs` scheduler (Node >= 24 gate); persist review cards/revlogs; map attempt results to scheduler; never inflate retention via repeated identical MCQ.
21. Tests: due-review selection, time/grade weighting honored, unsupported concepts flagged.

### Phase 4 — Interactive application (Milestone D, later phase)
22. MathLive + Compute Engine equation entry with units/significant figures and a symbolic-equivalence validator separate from LLM grading.
23. JSXGraph KIN120 Law of Sines/Cosines draggable exercise.
24. Tests: known math answers incl. units/sig-figs; accessible answer entry; multiple equivalent forms accepted.

### Phase 5 — Quality & security
25. Remediate npm audit advisories (4 moderate, 4 high, 1 critical) or document justified exceptions.
26. Add LICENSE to connector repo (declared ISC).
27. Playwright E2E suite + accessibility checks; no remote font downloads; input sanitization.
28. Gateway: execute `server/mcp-gateway.test.mjs` and store tests; confirm 127.0.0.1-only binding, bearer-token fail-closed, Host/Origin checks.
29. Final gate: `npm test`, `npx tsc --noEmit`, `npm run build-nolog` all green on the user's Windows machine.

## Validation plan
- Gate: no phase is complete until `npm test` (backend + frontend), `npx tsc --noEmit`, and `npm run build-nolog` pass on the user's Windows machine.
- E2E: Playwright desktop + mobile covering the ux-review smoke test (course list available after refresh, search/filter KIN 120 by Slides+PDF, generate/cancel generation, mid-encounter refresh restores progress, mobile-width no horizontal overflow, keyboard nav 1–4 + Enter, no remote font requests).
- No real course content, course IDs, or credentials committed or logged.

## Risks
- Conflict resolution is manual; choosing the wrong branch loses features. Mitigation: HEAD is documented as the implemented vertical slice; origin/main changes are a subset.
- Ollama + `qwen3:8b` must be installed locally for real-question generation; no silent synthetic fallback for real lectures (by design).
- WatIAM/Duo reauth is manual and cannot be automated; sync pauses on auth expiry.
- `ts-fsrs` v6 requires Node >= 24; verify runtime before installing.
- Shell restrictions in this session prevented executing validation commands; baseline must be verified by the implementation agent.
