# StudyAI-Beta — course-wide, open-source-first architecture
Date: 2026-11-02
Status: researched implementation proposal, NOT executed/tested or permission to scrape private publisher systems.

## Product pivot
Stop treating a manually selected single lecture as the central unit of study. Course is the primary entity. On first sync, gather and organize:
- Course and term
- Outline/syllabus, assessments and expected learning outcomes
- Nested module and topic manifest
- Instructor announcements, due dates, grades and feedback
- Source-backed lecture and document passages
- Objective/concept graph and provenance (courseId, topicId, file fingerprint, page, quote)
- Performance events, retrieval strength, next review, assessment relevance

Select a *goal* (upcoming exam, due review, low-confidence objective, self-chosen topic), then have StudyAI select evidence and a practice modality. Preserve drill-down to exact lecture/source.

## IMPORTANT: existing Waterloo MCP already has much of this
The locally checked MCP registers 12 tools:
list_courses, get_exam_context, get_announcements, search_course_materials, get_content, get_topic_file, get_grades, get_assignments, get_upcoming, get_course_outline, search_drive_files, get_drive_file.

- get_exam_context already assembles exam signals, outline, full content map, recommended lecture file calls, potentially past assessment references and partial-source warnings.
- search_course_materials already locally indexes up to 40-60 course files, with a private 24-hour cache and page-cited passages.
- Current StudyAI app only exposes a subset of that functionality; wire these existing MCP calls before implementing custom RAG/indexing.

## Proposed data architecture
Data adapters: Waterloo MCP, user-provided local files, optional Achieve-accessible LMS assignment/grade links
   ↓
Local sync + manifest (SQLite with schema migration, content fingerprints, tombstones; metadata first, bounded lazy extraction)
   ↓
Normalized entities:
  Course {id, term, source}
  Module {id, parentId, courseId, title, ordinal}
  Material {id, moduleId, format, sourceUri, updatedAt, fingerprint, processingState}
  Passage {id, materialId, page, text, extractionConfidence}
  Objective {id, courseId, normalizedStatement, sourceLinks[], prerequisiteIds[]}
  Assessment {id, courseId, dueAt?, weight?, source}
  Attempt {id, questionId, objectiveId, correct, at, response, activityType}
  ReviewCard {objectiveId, schedulerState, dueAt}
  Activity {id, objectiveIds[], type, sourceEvidence[], provider, validatedState}
   ↓
Evidence-based planner:
  prioritization = review due + assessment urgency/coverage + difficulty + prerequisite dependencies + confidence, explicitly show missing input
  Separate estimated *retention scheduling* from *grade mastery* and user-entered confidence
   ↓
Activity engine adapters (each should use typed questions, validation, provenance):
  retrieval, flashcards, equation construction, numeric application, diagram interaction, H5P activity, RPG wrapper
   ↓
UI: dashboard → goals & topics → recommended activity → feedback/source/retry → progress. Source explorer becomes secondary.

## Open-source candidates, prioritized
1) ts-fsrs — https://github.com/open-spaced-repetition/ts-fsrs
   Review scheduling, retrievability estimates. New v6 requires Node >=24; check installed runtime before installing and consider compatible previous release only after verifying. Do not call its outputs validated course mastery.
2) MathLive + Compute Engine — https://github.com/arnog/mathlive and https://mathlive.io/mathlive/
   Equation entry, structure-aware math practice, mobile keyboard and expression comparison. Needs explicit units, significant figures and valid symbolic equivalence tests.
3) JSXGraph — https://github.com/jsxgraph/jsxgraph
   Oblique triangle / vectors / graphing; MIT/LGPL dual license. Build one KIN120 Law of Sines/Cosines draggable exercise.
4) Numbas — https://github.com/numbas/Numbas ; embed docs https://docs.numbas.org.uk/en/latest/embedding.html
   Browser-based math assessment engine (Apache-2.0). Can be embedded as a custom element, but needs authored/imported .exam content, event/result adapter and question generation constraints. More integration effort than MathLive.
5) H5P Standalone — https://www.npmjs.com/package/h5p-standalone ; Node authoring https://github.com/Lumieducation/H5P-Nodejs-library
   Rich prebuilt learning activity player; existing H5P packages are usable but constructing arbitrary H5P content requires valid manifests/libraries and license review; Node editing/server project is GPL-3.0.
6) Docling — https://docling.ai/
   Optional offline fallback/advanced document parsing for tables/formulas/diagrams. Python and ML overhead; keep existing MCP+LibreOffice pipeline rather than adding heavyweight parsing as first dependency.
7) Mammoth — https://github.com/mwilliamson/mammoth.js
   Lightweight .docx structured content extraction (BSD-2-Clause). Use only when needed; HTML must be sanitized before display.

## Achieve (Macmillan Learning) feasibility
Macmillan officially supports LMS integration and D2L/Brightspace LTI Advantage 1.3, deep linking and grade sync in some deployments:
https://www.macmillanlearning.com/college/us/solutions/lms-integration
https://mhe.my.site.com/macmillanlearning/s/article/Achieve-LMS-Integration

These are institution/instructor-configured integration pathways, NOT evidence that a student or a private local app has general Achieve API access. No verified public student read API was found in this research. Grade/assignment links *might* flow to LEARN for specific connected courses. Verify actual LEARN entries and what Achieve can officially export. Never collect passwords, intercept SSO tokens, bypass authorization or bulk-extract publisher-owned questions without permission. Fallback: a read-only official link-out and locally imported user-licensed exports, if supported.

## Sequence: prioritize proof over dependencies
Milestone A — Course index and dashboard:
  Select course → get_content + get_course_outline + get_upcoming + get_announcements + get_grades + get_assignments.
  Persist normalized entities locally. Show current unit, next exam, what needs review; each item links to primary sources. Search entire course via existing search_course_materials.
  Tests: never invent deadline/weight; distinguish missing permission from no work.

Milestone B — Study orchestration:
  Link material pages → objectives → question/activity with stable IDs, citations and audit trail. Do not pre-process 50 large slide decks into LLM context. Search first, fetch relevant pages only. Use explicit provenance and stale-cache warnings.
  Tests: exam preparation based on exact exam scope and relevant multi-file evidence rather than first eight pages.

Milestone C — Adaptation:
  Integrate compatible FSRS scheduler; persist cards/revlogs and attempt events. Use question difficulty/answer history to recommend next activity. Never inflate retention merely through repeated identical MCQ.
  Tests: due reviews correctly selected, time/grade weighting honored, unsupported concepts flagged.

Milestone D — Interactive application:
  MathLive + JSXGraph KIN120 triangle / vector application problem; use a numeric/symbolic validator separate from LLM grading. Numbas as optional later engine. Phaser rewards are a *presentation* layer over the assessment engine.
  Tests: known math answers including units/significant figures; accessible answer entry; multiple equivalent forms accepted.

Milestone E — Achieve:
  Inspect actual connected LEARN course content and gradebook links; verify institutional LTI/official export support. Implement only documented supported read-only adapters; otherwise avoid overclaiming completeness.

## Engineering guardrails
Keep course content and model requests local unless user explicitly approves remote models; keep source text out of shared project memory; do not leak LEARN auth.json or third-party session cookies. Respect source licenses. Node version/Windows compatibility and dependency sizes must be checked. Build tests for index idempotence, dedupe, partial failures, per-source permission boundaries, stale data, question-validation, activity result-to-scheduler mapping and frontend accessibility. The original Kilo+ChatGPT parallel editing warning still applies: coordinate file writes, inspect latest code, keep rollback points.

## Verification status
This file is a researched roadmap, not a claim that any new dependency is installed or integrated. App had already demonstrated listing a real KIN120 module and extracting first 8/15 pages of a PowerPoint. Other operations have not yet been verified end-to-end inside the app.
