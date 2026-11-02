# StudyAI-Beta — resilient universal LEARN content ingestion
Status: IMPLEMENTATION SPECIFICATION; not verified or implemented.
Updated: 2026-11-02.

## Goal and non-goal

Selecting **any** topic exposed by LEARN must never crash the whole study app, destroy working cached coursework, or imply that content was read when it was not. Provide a usable text/image/media preview when supported; otherwise show safe metadata and a direct, user-initiated “Open original in LEARN” action, with an explicit reason. Auth expiry and remote outages cannot be prevented, only detected, handled and recovered from.

The current app is NOT universal: its server/index.mjs always sends the selected topic to get_topic_file with pages="1-8", its Waterloo MCP get_topic_file calls downloadTopicPdf, which supports PDF/PPT(X)/DOC(X) only. It renders PNG images in addition to extracting text. Default MCP request timeout may be less than LibreOffice's 120-second conversion budget, producing -32001. LEARN protected resources can redirect on session expiry, even after a successful course sync. External provider content may not be available through LEARN.

## Required topology

1. Course TOC is the inventory. Preserve topic id, title, type, module ancestry, and original URL for each topic; do not assume every topic is a downloadable file. The app must show every available topic even when not locally processable.
2. A content-kind router classifies **topic type** first (file, LEARN native/HTML, external URL or eText/LTI, SCORM, quiz, assignment, discussion, media, unknown). For file topics, classify downloaded MIME + magic bytes + extension; do not trust the filename alone.
3. Separate operations:
   - Metadata/availability: fast, no document rendering.
   - Download: bounded size, safe redirect/SSO handling, authenticated and restricted to trusted LEARN routes.
   - Extract: text first, then optional rendered slide/page image, OCR, or transcript only if available.
   - Study generation: only from clearly usable provenance-bearing content; NEVER hallucinate missing text.
   - Open-original: fallback for all unsupported/externally gated topics.
4. Return discriminated typed results:
   `{status:"ready",kind, title, sourceUrl?,totalPages?,pages:[{page,text}],coverage, warnings:[]}`
   `{status:"partial",kind,...,coverage,warnings:[...]}`
   `{status:"open-original",kind,title,sourceUrl,reason}`
   `{status:"reauth-required",reason}`
   `{status:"retryable-error",reason,retryAfter?}`
   `{status:"unsupported",kind,title,sourceUrl?,reason}`
   State can be independent per topic; other course materials stay usable.
5. Never return a 500/502 as ordinary navigation for an expected unsupported type, and never show raw stack traces/absolute auth.json paths to students. HTTP 401 for login expiry, 503/504 for actual upstream outage, 422/200 typed status for unsupported content as appropriate. Use stable machine-readable error codes.

## Format/feature routing matrix

| Topic/resource | Primary path | Graceful fallback |
|---|---|---|
| PDF with text | PDF text-layer extraction for entire document, cache pages, render requested pages separately | partial page coverage and original link |
| Scanned/image-only PDF | render + local OCR only if installed, mark OCR reliability; maintain source page mapping | view page images / original; do not generate questions from empty text |
| PowerPoint .ppt/.pptx/.odp | LibreOffice conversion to PDF once, cached; text and optional slide images | direct slide text extraction if available, or open original |
| Word .doc/.docx/.odt/.rtf | reliable text extraction; optional LibreOffice for page mapping | open original; no faux page numbers |
| Excel .xls/.xlsx/.ods/.csv/.tsv | bounded workbook/sheet/table parser; sheet/row/cell provenance (not fake page numbers) | downloadable original and table preview |
| Plain text / Markdown / HTML | decode safely; strip/sanitize untrusted HTML; preserve headings | original link |
| Image PNG/JPEG/WebP/GIF/SVG | preview sanitized image; optional local OCR/vision with honest labels | open original; no fake question evidence |
| MP3/WAV/M4A/audio, MP4/WebM/video | playback/open link; local transcription only if installed and user initiates; timed transcript provenance | original media link and unavailable-transcript notice |
| Embedded HTML page | authenticated LEARN-native content reader for permitted in-course HTML; sanitize scripts | view original LEARN page |
| External web link, Pearson eText, LTI, SCORM, interactive lesson | classify as external/interactive, show link and provider name, never hit file-download API | open original (no bypassing licenses or authentication) |
| Quiz, assignment, discussion, survey | use relevant metadata/API and deep link; never treat as lecture PDF | open original; no automatic submission or private peer data ingestion |
| ZIP/unknown/binary/corrupt/password-protected | safe metadata; optionally inspect bounded archives with zip-bomb and path-traversal safeguards; do not run files | open original/download or request alternative |

For native HTML / external links: validate targets; allow only http(s) with a safe explicit click; prevent SSRF, credential leakage and automatic arbitrary external fetching. Course content is untrusted input; never execute embedded instructions/macros/scripts. Respect source permissions and copyright.

## Fix screenshot failures specifically

### Missing LibreOffice
- On startup check for soffice.exe in PATH and the standard Windows installations; cache availability.
- For office documents, prefer text-only processing and avoid image conversion when just generating quiz text. If slide-level visual information is needed, use LibreOffice conversion. If not installed or broken, show "Office preview unavailable" with original LEARN link rather than a red app-level failure.
- LibreOffice can be installed with `winget install --id TheDocumentFoundation.LibreOffice -e` on Windows; verify by running the full soffice.exe path with `--version`. Restart the Node server after installation if binary visibility changed.
- Give LibreOffice a unique user profile per conversion job, limit concurrency, clean temporary files, cache converted PDF keyed by source revision/hash; protect against overlapping conversions and malicious filenames.

### MCP -32001 timeout
- The API should use an MCP request timeout longer than its actual allowed conversion pipeline; current LibreOffice conversion can take up to 120s while default MCP calls may time out sooner. Verify precise SDK request-options signature from installed version before editing.
- Use a 180–240s ceiling for large file extraction rather than global infinite timeout. Set faster budgets for course lists and metadata. Cancel/stale-detect per request; retry transient fetches with capped exponential backoff (1–2 retries) but NEVER retry auth failures or unsupported format forever.
- Prefer dedicated `get_topic_text` MCP tool built on existing exported `getTopicText()`: avoids returning PNG payloads and extracts ALL pages, in one conversion. Keep `get_topic_file` strictly for requested visual pages.
- Enqueue expensive conversions and show ongoing stage ('Downloading', 'Converting', 'Extracting', 'Indexing'), rather than blocking UI with an indefinite spinner.

### Expired session
- Treat redirects to login/WatIAM, 401 and 403 as auth-required and stop retrying. Keep last-good local cache readable but clearly labeled with "Last synced" timestamp.
- UI: "LEARN sign-in expired" with actions "Reconnect LEARN" and "Use cached notes". Reconnect launches the existing `npm run login` flow ONLY on explicit user action; WatIAM/Duo approval cannot be silently bypassed. Restart/reload auth in the connector after login and retry just the failed topic once.
- Never return personal auth tokens/cookies or auth.json contents to browser, logs or git.

### Missing pages and diagrams
- Remove the fixed 1–8-page ceiling from text indexing; track actual totalPages, fetchedPageCount, emptyPages and full/partial coverage.
- For image-heavy content, do not claim fully understood without OCR/vision. Offer "Inspect original slide", and annotate any quiz with whether its source only includes text.
- Do not use exactly quoted text as proof that an answer is scientifically correct; retain question validation.

## UX acceptance criteria

- Click every topic in each available course: always see a ready/partial/open-original/auth-required/retryable/unsupported state; selecting a bad topic does NOT blank the screen or clear previously completed practice.
- For a supported document, students can see percentage/page coverage and which portions could not be read. Never present eight out of fifteen pages as a complete lecture.
- Model generation disabled when source evidence is insufficient, or explicitly marked as limited scope with student approval. Do not silently substitute synthetic demo questions for real course content.
- "Retry" and "Open original" are user actions when applicable; loading actions can be cancelled and do not lock all courses.
- A failed topic cannot poison other topic ingestion, cache, or progress. Cached material survives LEARN downtime.
- No raw MCP/LibreOffice/Node errors in visible UI; detailed sanitized diagnostics available in developer logs.
- On a small mobile screen, errors are readable, accessible and actionable.

## Test matrix (fixture-based / no real credentials in CI)

- File types: text PDF; scanned PDF; PPTX; DOCX; TXT; HTML; XLSX; CSV; PNG; audio/video; unsupported binary; corrupt and password-protected docs; huge pages; nested ZIP; zero-byte files.
- Topic types: real file; HTML/native text; external web/eText/LTI; quiz, assignment, discussion, unknown.
- Faults: expired session (HTTP 302 to login, 401, 403); 429; network disconnected; 60s and 120s slow conversion; missing soffice; conversion crash; PDF renderer crash; timeout; client cancellation; malformed MCP response; duplicate concurrent requests; stale cache.
- Tests must assert exact expected status, no fabricated content, retained last-good cached data, no unhandled rejection, single retry where appropriate, and other topics remain functional.
- Separate unit tests for content router/error classifier/MCP timeouts; integration tests with fake MCP and fixture files; Playwright desktop/mobile E2E; optional guarded real-course smoke test after the user authenticates, without logging course content or IDs.
- Commands: run `npm test`, `npx tsc --noEmit`, `npm run build-nolog` in frontend folder and `npm test` / `npm run build` in Waterloo MCP folder; inspect actual package.json scripts. Do not mark success unless tests were actually run and passed.

## Implementation order

1. Add typed topic-kind routing and UI nonfatal statuses/open-original links using get_content metadata. No more get_topic_file for links.
2. Add text-only get_topic_text to Waterloo MCP and call it in StudyAI; use a long-but-bounded per-file timeout. Remove hardcoded pages 1–8 from text ingestion.
3. Stabilize auth-required state and cache preservation; add explicit manual reconnect.
4. Add cached office conversion, LibreOffice health check and safe conversion concurrency.
5. Add HTML/TXT/CSV/XLSX/image/media readers with honest capability statuses and provenance; OCR/transcription optional, not assumed.
6. Add regression fixtures and browser tests, then run a guarded live smoke test across all six course inventories.

## Agent execution instruction

Implement these requirements **against current local files**, which are ahead of the GitHub copy; inspect recent edits before touching source. Make one small change and run focused tests per phase. Never overwrite concurrent changes, and never commit auth.json, cookies, lecture content or private cache. If an implementation needs a paid service, stop and use a free/local or open-original fallback. Report completed, tested, remaining unsupported and blockers separately.