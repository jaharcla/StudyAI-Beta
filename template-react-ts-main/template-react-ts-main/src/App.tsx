import { useEffect, useMemo, useRef, useState } from "react";
import { PhaserGame, type IRefPhaserGame } from "./PhaserGame";
import { getConnectorStatus, getCourses, syncCourses } from "./domain/connector";
import { LocalStorageProgress } from "./domain/persistence";
import { readLastSession, saveLastSession } from "./domain/session";
import { DEMO_MATERIAL, evaluateAnswer, identifyObjectives, makeQuestion, rankRecommendations, updateMastery } from "./domain/study";
import { flattenTopics, generatePractice, loadCourseModules, loadLecture } from "./domain/live";
import type { LearnModule, LearnTopic, LectureMaterial, PracticeResponse } from "./domain/live";
import type { ConnectorSyncStatus, CourseSummary, MasteryState, MultipleChoiceQuestion } from "./domain/contracts";

type Encounter = Phaser.Scene & { resolve?: (correct: boolean, totalQuestions?: number) => void; reset?: () => void };
type Question = MultipleChoiceQuestion & { objective?: string; sourcePage?: number; sourceQuote?: string };
type Loading = "courses" | "modules" | "lecture" | "questions" | null;
const demoObjectives = identifyObjectives(DEMO_MATERIAL);

export default function App() {
  const game = useRef<IRefPhaserGame | null>(null);
  const progress = useMemo(() => new LocalStorageProgress(), []);
  const [savedSession] = useState(readLastSession);
  const [status, setStatus] = useState<ConnectorSyncStatus>({ state: "checking", updatedAt: new Date().toISOString(), lastSuccessAt: null });
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [courseId, setCourseId] = useState(savedSession?.courseId ?? "");
  const [modules, setModules] = useState<LearnModule[]>([]);
  const [topic, setTopic] = useState<LearnTopic | null>(savedSession?.topic ?? null);
  const [material, setMaterial] = useState<LectureMaterial | null>(null);
  const [search, setSearch] = useState("");
  const [questions, setQuestions] = useState<Question[]>(savedSession?.questions ?? []);
  const [source, setSource] = useState<"live" | "demo">(savedSession?.source ?? "live");
  const [modelInfo, setModelInfo] = useState<PracticeResponse | null>(savedSession?.modelInfo ?? null);
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<"correct" | "incorrect" | null>(null);
  const [done, setDone] = useState(false);
  const [answered, setAnswered] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [mastery, setMastery] = useState<Record<string, MasteryState>>({});
  const [battleKey, setBattleKey] = useState(0);
  const [loading, setLoading] = useState<Loading>(null);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");

  const topics = useMemo(() => flattenTopics(modules), [modules]);
  const visibleTopics = useMemo(() => topics.filter(t =>
    (t.title + " " + t.moduleTitle).toLowerCase().includes(search.toLowerCase())).slice(0, 80), [topics, search]);
  const active = questions[index] ?? null;
  const currentCourse = courses.find(c => c.id === courseId);
  const isBusy = loading !== null;
  const recommendations = useMemo(() => rankRecommendations(
    questions.map(q => ({
      id: q.objectiveId, courseId: courseId || "local-demo", materialId: topic?.id || DEMO_MATERIAL.id,
      statement: q.objective || q.prompt, confidence: 0.5,
    })), mastery), [questions, mastery, courseId, topic]);
  const nextFocus = recommendations[0];

  useEffect(() => {
    let active = true;
    Promise.all([getConnectorStatus(), getCourses()]).then(([connection, response]) => {
      if (!active) return;
      setStatus(connection.state === "not-configured" ? response.status : connection);
      setCourses(response.courses);
    }).catch(() => { if (active) setError("Could not check the connector."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    saveLastSession({ questions, source, courseId, topic, modelInfo });
  }, [questions, source, courseId, topic, modelInfo]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(questions.map(async q => [q.objectiveId, await progress.loadMastery(q.objectiveId)] as const))
      .then(entries => {
        if (cancelled) return;
        const loaded = Object.fromEntries(entries.filter((e): e is [string, MasteryState] => e[1] !== null));
        setMastery(current => ({ ...current, ...loaded }));
      });
    return () => { cancelled = true; };
  }, [questions, progress]);

  function resetSession(nextQuestions: Question[], nextSource: "live" | "demo") {
    setQuestions(nextQuestions);
    setSource(nextSource);
    setIndex(0);
    setChoice(null);
    setFeedback(null);
    setDone(false);
    setAnswered(0);
    setCorrect(0);
    setSaveError("");
    setBattleKey(n => n + 1);
  }

  async function sync() {
    setLoading("courses"); setError("");
    try {
      const result = await syncCourses();
      setCourses(result.courses);
      setStatus(result.status);
      if (result.status.state === "reauth-required") setError("LEARN authentication expired. Reauthenticate the Waterloo connector first.");
      else if (result.status.state !== "connected") setError(result.status.message || "Course sync failed.");
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(null); }
  }

  async function selectCourse(id: string) {
    setCourseId(id);
    setTopic(null); setModules([]); setMaterial(null); setQuestions([]); setModelInfo(null); setSearch("");
    setError("");
    if (!id) return;
    setLoading("modules");
    try {
      setModules(await loadCourseModules(id));
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(null); }
  }

  async function selectTopic(item: LearnTopic) {
    if (!courseId) return;
    setTopic(item); setMaterial(null); setQuestions([]); setModelInfo(null); setError(""); setLoading("lecture");
    try {
      setMaterial(await loadLecture(courseId, item.id));
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(null); }
  }

  async function generate() {
    if (!courseId || !topic) return;
    setLoading("questions"); setError(""); setModelInfo(null);
    try {
      const result = await generatePractice(courseId, topic.id);
      setModelInfo(result);
      resetSession(result.questions, "live");
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(null); }
  }

  function openDemo() {
    setError(""); setModelInfo(null);
    resetSession(demoObjectives.map(makeQuestion), "demo");
  }

  async function submit() {
    if (!active || !choice || feedback || done) return;
    const answer = { questionId: active.id, choiceId: choice, submittedAt: new Date().toISOString() };
    const result = evaluateAnswer(active, answer);
    const next = updateMastery(mastery[active.objectiveId] ?? null, result);
    try {
      await progress.saveAnswer(answer, result, next);
    } catch (err) {
      setSaveError("Answer recorded for this session, but local persistence failed: " + (err as Error).message);
    }
    setMastery(current => ({ ...current, [active.objectiveId]: next }));
    setFeedback(result.isCorrect ? "correct" : "incorrect");
    setAnswered(n => n + 1);
    if (result.isCorrect) setCorrect(n => n + 1);
    (game.current?.scene as Encounter | null)?.resolve?.(result.isCorrect, questions.length);
  }

  function nextQuestion() {
    if (index + 1 >= questions.length) { setDone(true); return; }
    setIndex(n => n + 1); setChoice(null); setFeedback(null);
  }

  const progressPct = questions.length ? Math.round(answered / questions.length * 100) : 0;

  return (
    <main className="shell">
      <header className="topbar">
        <div><p className="eyebrow">STUDYAI / LOCAL FIRST</p><h1>Learn it. Prove it. Level up.</h1><p className="muted">Turn a real lecture into practice and a playable encounter.</p></div>
        <div className="status-pill"><span className={"status-dot " + status.state}/>{status.state === "connected" ? "LEARN connected" : status.state === "reauth-required" ? "Sign-in required" : "Connector: " + status.state}</div>
      </header>

      <section className="notice" role="note"><strong>Private by default</strong><span>Lecture text goes to your local Ollama model only when you click Generate. Source quotes are checked against page text; answer correctness still needs review. No cloud AI is called.</span></section>
      {error && <div className="error-alert" role="alert">{error}</div>}

      <div className="layout">
        <aside className="sidebar card">
          <div className="section-label">01 / Waterloo LEARN</div>
          <p className="muted">{status.message || "Sync courses, then choose a lecture. You can also run the synthetic demo."}</p>
          <button className="secondary" disabled={isBusy} onClick={sync}>{loading === "courses" ? "Syncing…" : "Sync my courses"}</button>
          <label className="field-label" htmlFor="course-select">Course</label>
          <select id="course-select" className="select-input" disabled={isBusy} value={courseId} onChange={e => void selectCourse(e.target.value)}>
            <option value="">Choose a Waterloo course</option>
            {courses.filter(c => c.dataSource.kind === "waterloo-mcp").map(c => <option key={c.id} value={c.id}>{c.code || c.title}{c.code && c.code !== c.title ? " — " + c.title : ""}</option>)}
          </select>
          {currentCourse && <p className="muted course-meta">Selected: {currentCourse.title}</p>}
          <div className="section-label objectives-label">02 / Lecture explorer</div>
          {courseId ? (
            <>
              <input className="search-input" aria-label="Search lectures" placeholder="Search lecture titles…" value={search} onChange={e => setSearch(e.target.value)} />
              <p className="muted">{loading === "modules" ? "Loading modules…" : topics.length + " materials found"}</p>
              <div className="topic-scroll">{visibleTopics.map(item => <button key={item.id} className={"topic-button " + (item.id === topic?.id ? "active" : "")} disabled={isBusy} onClick={() => void selectTopic(item)}><span>{item.title}</span><small>{item.moduleTitle}</small></button>)}</div>
              {!isBusy && topics.length === 0 && <p className="muted">No materials available, or module loading failed.</p>}
            </>
          ) : <p className="muted">Choose a course above to browse its posted modules.</p>}
          <div className="demo-box"><div className="section-label">Offline sample</div><p className="muted">Test the game with synthetic chemistry content. This is not your LEARN coursework.</p><button className="secondary" onClick={openDemo}>Play demo encounter</button></div>
        </aside>

        <section className="workspace">
          <article className="lesson-card card">
            <div className="lesson-meta"><span className="tag">{material ? "REAL LEARN MATERIAL" : "COURSE TO GAME"}</span><span>{material ? "Pages 1–" + Math.min(8, material.totalPages) + " of " + material.totalPages : "v0.1 integration"}</span></div>
            <h2>{material ? (topic?.title || material.title) : "Choose a lecture to begin"}</h2>
            {material ? <>
              <p className="muted">{material.source} · {material.title}</p>
              <div className="lecture-preview">{material.pages.length ? material.pages.slice(0, 2).map(page => <p key={page.page}><strong>Page {page.page}: </strong>{page.text.slice(0, 650) || "No readable text on this page."}</p>) : <p>No readable text. Try another document.</p>}</div>
              <p className="muted">{material.note}</p>
              <button className="primary" disabled={isBusy || !material.pages.some(page => page.text.trim().length)} onClick={() => void generate()}>{loading === "questions" ? "Generating locally (can take a while)…" : "Generate lecture-based challenge"}</button>
            </> : <p className="muted">Sync LEARN, pick a course, and select a PDF or lecture file. The first eight pages will be read locally to generate practice questions. Or try the demo.</p>}
          </article>

          {questions.length > 0 ? <section className="encounter card">
            <div className="encounter-header"><div><div className="section-label">03 / Study encounter</div><h2>{source === "live" ? "Lecture challenge" : "Synthetic demo battle"}</h2></div><span className="counter">{answered}/{questions.length} answered</span></div>
            {modelInfo && source === "live" && <p className="model-caption">Generated by local {modelInfo.model}. Source-page quotations validated; check explanations against the lecture.</p>}
            <div className="progress-track"><div style={{ width: progressPct + "%" }} /></div>
            <PhaserGame key={battleKey} ref={game} />
            {done ? <div className="question"><h2>Encounter complete</h2><p>You answered {correct} of {questions.length} correctly. Your recorded mastery estimates have been updated.</p>{nextFocus && <p className="muted">Suggested next review: {nextFocus.rationale.toLowerCase()} — {questions.find(q => q.objectiveId === nextFocus.objectiveId)?.objective || "current learning objective"}</p>}<button className="primary" onClick={() => resetSession(questions, source)}>Replay encounter</button>{source === "live" && <button className="secondary action-gap" disabled={isBusy} onClick={() => void generate()}>Generate new questions</button>}</div>
            : active && <div className="question">
              <div className="question-number">Question {index + 1} / {questions.length}</div>
              {active.objective && <p className="muted">Learning objective: {active.objective}</p>}
              <h2>{active.prompt}</h2>
              <div className="choices">{active.choices.map(option => <button key={option.id} className={"choice " + (choice === option.id ? "selected" : "")} disabled={Boolean(feedback)} onClick={() => setChoice(option.id)}><span className="choice-key">{option.id.toUpperCase()}</span>{option.label}</button>)}</div>
              {feedback ? <><div className={"feedback " + feedback} role="status"><strong>{feedback === "correct" ? "Correct." : "Not quite."}</strong> {active.explanation}{typeof active.sourcePage === "number" && <p className="source-evidence">Page {active.sourcePage}: “{active.sourceQuote}”</p>}</div><button className="primary" onClick={nextQuestion}>{index + 1 < questions.length ? "Next challenge" : "Finish encounter"}</button></> : <button className="primary" disabled={!choice} onClick={() => void submit()}>Cast answer</button>}
              {saveError && <p className="muted" role="alert">{saveError}</p>}
              <p className="mastery-caption">Stored mastery estimate: {Math.round((mastery[active.objectiveId]?.normalizedScore ?? .2) * 100)}% · Heuristic, not a validated learning score.</p>
            </div>}
          </section> : <article className="card empty-stage"><div className="section-label">03 / Game arena</div><h2>Your next encounter starts here</h2><p className="muted">The game will appear after your local model generates questions from a lecture, or when you start the demo.</p></article>}
        </section>
      </div>
      <footer>StudyAI-Beta development build · Educational questions should be checked against source lectures before high-stakes use.</footer>
    </main>
  );
}
