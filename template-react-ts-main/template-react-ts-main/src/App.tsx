<<<<<<< HEAD
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
=======
import { useEffect, useMemo, useRef, useState } from "react";
>>>>>>> origin/main
import { PhaserGame, type IRefPhaserGame } from "./PhaserGame";
import { getConnectorStatus, getCourses, syncCourses } from "./domain/connector";
import { LocalStorageProgress } from "./domain/persistence";
import { readLastSession, saveLastSession } from "./domain/session";
import { DEMO_MATERIAL, evaluateAnswer, identifyObjectives, makeQuestion, rankRecommendations, updateMastery } from "./domain/study";
<<<<<<< HEAD
import { flattenTopics, generatePractice, getLocalModels, loadCourseModules, loadLecture } from "./domain/live";
import type { LearnModule, LearnTopic, LectureMaterial, ModelStatus, PracticeResponse } from "./domain/live";
=======
import { flattenTopics, generatePractice, loadCourseModules, loadLecture } from "./domain/live";
import type { LearnModule, LearnTopic, LectureMaterial, PracticeResponse } from "./domain/live";
>>>>>>> origin/main
import type { ConnectorSyncStatus, CourseSummary, MasteryState, MultipleChoiceQuestion } from "./domain/contracts";

type Encounter = Phaser.Scene & { resolve?: (correct: boolean, totalQuestions?: number) => void; reset?: () => void };
type Question = MultipleChoiceQuestion & { objective?: string; sourcePage?: number; sourceQuote?: string };
type Loading = "courses" | "modules" | "lecture" | "questions" | null;
<<<<<<< HEAD
type Filter = "all" | "slides" | "pdf" | "docs";
const demoObjectives = identifyObjectives(DEMO_MATERIAL);
const initialStatus: ConnectorSyncStatus = { state: "checking", updatedAt: new Date().toISOString(), lastSuccessAt: null };
function kind(name: string): Filter {
  if (/\.(ppt|pptx)$/i.test(name)) return "slides";
  if (/\.pdf$/i.test(name)) return "pdf";
  if (/\.(doc|docx)$/i.test(name)) return "docs";
  return "all";
}
function fileLabel(name: string) {
  const type = kind(name);
  return type === "slides" ? "SLIDES" : type === "pdf" ? "PDF" : type === "docs" ? "DOC" : "FILE";
}
function timeLabel(seconds: number) {
  return seconds < 60 ? seconds + "s" : Math.floor(seconds / 60) + "m " + String(seconds % 60).padStart(2, "0") + "s";
}

export default function App() {
  const game = useRef<IRefPhaserGame | null>(null);
  const stage = useRef<HTMLElement | null>(null);
  const generator = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const submitting = useRef(false);
  const progress = useMemo(() => new LocalStorageProgress(), []);
  const [restored] = useState(readLastSession);
  const [status, setStatus] = useState<ConnectorSyncStatus>(initialStatus);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [courseId, setCourseId] = useState(restored?.courseId ?? "");
  const [modules, setModules] = useState<LearnModule[]>([]);
  const [topic, setTopic] = useState<LearnTopic | null>(restored?.topic ?? null);
  const [material, setMaterial] = useState<LectureMaterial | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showMore, setShowMore] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [questions, setQuestions] = useState<Question[]>(restored?.questions ?? []);
  const [source, setSource] = useState<"live" | "demo">(restored?.source ?? "live");
  const [modelInfo, setModelInfo] = useState<PracticeResponse | null>(restored?.modelInfo ?? null);
  const [index, setIndex] = useState(Math.min(restored?.index ?? 0, Math.max(0, (restored?.questions.length ?? 1) - 1)));
  const [choice, setChoice] = useState<string | null>(restored?.choice ?? null);
  const [feedback, setFeedback] = useState<"correct" | "incorrect" | null>(restored?.feedback ?? null);
  const [done, setDone] = useState(restored?.done ?? false);
  const [outcomes, setOutcomes] = useState<boolean[]>(restored?.outcomes ?? []);
  const [mastery, setMastery] = useState<Record<string, MasteryState>>({});
  const [gameKey, setGameKey] = useState(0);
  const [loading, setLoading] = useState<Loading>(null);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [models, setModels] = useState<ModelStatus | null>(null);
  const [model, setModel] = useState("");
  const [checkingModel, setCheckingModel] = useState(true);
  const [startedGenerating, setStartedGenerating] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const topics = useMemo(() => flattenTopics(modules), [modules]);
  const matches = useMemo(() => topics.filter(t =>
    (filter === "all" || kind(t.title) === filter) &&
    (t.title + " " + t.moduleTitle).toLowerCase().includes(search.trim().toLowerCase())
  ), [topics, filter, search]);
  const visibleTopics = showMore ? matches : matches.slice(0, 35);
  const topicGroups = useMemo(() => {
    const groups: { title: string; items: LearnTopic[] }[] = [];
    for (const item of visibleTopics) {
      let group = groups.find(g => g.title === item.moduleTitle);
      if (!group) { group = { title: item.moduleTitle, items: [] }; groups.push(group); }
      group.items.push(item);
    }
    return groups;
  }, [visibleTopics]);
  const currentCourse = courses.find(c => c.id === courseId);
  const active = questions[index] ?? null;
  const answered = outcomes.length;
  const correct = outcomes.filter(Boolean).length;
  const percent = questions.length ? Math.round(answered / questions.length * 100) : 0;
  const busy = loading !== null;

  const nextFocus = useMemo(() => {
    if (!questions.length) return null;
    const objectives = questions.map(q => ({
      id: q.objectiveId, courseId: courseId || "local-demo", materialId: topic?.id || DEMO_MATERIAL.id,
      statement: q.objective || q.prompt, confidence: .5,
    }));
    return rankRecommendations(objectives, mastery)[0] ?? null;
  }, [questions, mastery, courseId, topic]);

  const replayOutcomes = useRef(outcomes);
  const replayCount = useRef(questions.length);
  replayOutcomes.current = outcomes;
  replayCount.current = questions.length;
  const onSceneReady = useCallback((scene: Phaser.Scene) => {
    const encounter = scene as Encounter;
    encounter.reset?.();
    replayOutcomes.current.forEach(isCorrect => encounter.resolve?.(isCorrect, replayCount.current));
  }, []);

  const refreshModels = useCallback(async () => {
    setCheckingModel(true);
    try {
      const result = await getLocalModels();
      setModels(result);
      setModel(previous => previous && result.models.includes(previous) ? previous : result.preferred);
    } catch {
      setModels({ available: false, models: [], preferred: "", message: "Could not contact the local-model service." });
    } finally { setCheckingModel(false); }
  }, []);

  useEffect(() => {
    let alive = true;
    void Promise.all([getConnectorStatus(), getCourses()]).then(([connector, cached]) => {
      if (!alive) return;
      setStatus(connector.state === "not-configured" ? cached.status : connector);
      setCourses(cached.courses);
      if (restored?.courseId && cached.courses.some(c => c.id === restored.courseId)) {
        const sequence = ++requestId.current;
        setLoading("modules");
        void loadCourseModules(restored.courseId).then(m => {
          if (alive && sequence === requestId.current) setModules(m);
        }).catch(e => {
          if (alive && sequence === requestId.current) setError((e as Error).message);
        }).finally(() => {
          if (alive && sequence === requestId.current) setLoading(null);
        });
      }
    }).catch(() => { if (alive) setError("Could not check your course connection."); });
    void refreshModels();
    return () => { alive = false; generator.current?.abort(); };
  }, [refreshModels, restored]);

  useEffect(() => {
    saveLastSession({ questions, source, courseId, topic, modelInfo, index, outcomes, choice, feedback, done });
  }, [questions, source, courseId, topic, modelInfo, index, outcomes, choice, feedback, done]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(questions.map(async q => [q.objectiveId, await progress.loadMastery(q.objectiveId)] as const)).then(entries => {
      if (cancelled) return;
      const found = Object.fromEntries(entries.filter((entry): entry is [string, MasteryState] => entry[1] !== null));
      setMastery(previous => ({ ...previous, ...found }));
    });
    return () => { cancelled = true; };
  }, [questions, progress]);

  useEffect(() => {
    if (startedGenerating === null) return;
    const update = () => setElapsed(Math.floor((Date.now() - startedGenerating) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [startedGenerating]);

  function jumpToStudy() {
    window.requestAnimationFrame(() => stage.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  function clearQuestions() {
    setQuestions([]); setModelInfo(null);
    setIndex(0); setChoice(null); setFeedback(null); setDone(false); setOutcomes([]); setSaveError("");
  }
  function begin(nextQuestions: Question[], nextSource: "live" | "demo") {
    setQuestions(nextQuestions); setSource(nextSource);
    setIndex(0); setChoice(null); setFeedback(null); setDone(false); setOutcomes([]);
    setSaveError(""); setGameKey(v => v + 1);
    jumpToStudy();
  }
=======
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

>>>>>>> origin/main
  async function sync() {
    setLoading("courses"); setError("");
    try {
      const result = await syncCourses();
<<<<<<< HEAD
      setCourses(result.courses); setStatus(result.status);
      if (result.status.state !== "connected") setError(result.status.message || "Course sync failed. Try again.");
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(null); }
  }
  async function chooseCourse(id: string) {
    const seq = ++requestId.current;
    generator.current?.abort();
    setCourseId(id); setModules([]); setTopic(null); setMaterial(null); clearQuestions();
    setSearch(""); setShowMore(false); setError("");
    if (!id) return;
    setLoading("modules");
    try {
      const result = await loadCourseModules(id);
      if (seq === requestId.current) setModules(result);
    } catch (e) {
      if (seq === requestId.current) setError("Could not load course materials. " + (e as Error).message);
    } finally {
      if (seq === requestId.current) setLoading(null);
    }
  }
  async function chooseTopic(item: LearnTopic) {
    if (!courseId) return;
    const seq = ++requestId.current;
    generator.current?.abort();
    setTopic(item); setMaterial(null); clearQuestions();
    setPreviewOpen(false); setError(""); setLoading("lecture");
    try {
      const result = await loadLecture(courseId, item.id);
      if (seq === requestId.current) setMaterial(result);
    } catch (e) {
      if (seq === requestId.current) setError("Couldn't open " + item.title + ". " + (e as Error).message);
    } finally {
      if (seq === requestId.current) setLoading(null);
    }
  }
  async function generate() {
    if (!courseId || !topic || loading === "questions") return;
    const controller = new AbortController();
    generator.current = controller;
    setLoading("questions"); setStartedGenerating(Date.now()); setElapsed(0); setError("");
    try {
      const result = await generatePractice(courseId, topic.id, model || undefined, controller.signal);
      if (!controller.signal.aborted) { setModelInfo(result); begin(result.questions, "live"); }
    } catch (e) {
      if (!controller.signal.aborted) setError("Couldn't generate the challenge. " + (e as Error).message);
    } finally {
      if (generator.current === controller) {
        generator.current = null; setLoading(null); setStartedGenerating(null);
      }
    }
  }
  function cancelGeneration() {
    generator.current?.abort();
    generator.current = null; setLoading(null); setStartedGenerating(null);
    setError("Generation cancelled. Your lecture is still selected and you can retry.");
  }
  function demo() {
    if (loading === "questions") cancelGeneration();
    setModelInfo(null); setError("");
    begin(demoObjectives.map(makeQuestion), "demo");
  }
  async function submit() {
    if (!active || !choice || feedback || done || submitting.current) return;
    submitting.current = true;
=======
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
>>>>>>> origin/main
    const answer = { questionId: active.id, choiceId: choice, submittedAt: new Date().toISOString() };
    const result = evaluateAnswer(active, answer);
    const next = updateMastery(mastery[active.objectiveId] ?? null, result);
    try {
      await progress.saveAnswer(answer, result, next);
<<<<<<< HEAD
    } catch (e) {
      setSaveError("Your answer counted, but local saving failed: " + (e as Error).message);
    } finally {
      setMastery(previous => ({ ...previous, [active.objectiveId]: next }));
      setFeedback(result.isCorrect ? "correct" : "incorrect");
      setOutcomes(previous => [...previous, result.isCorrect]);
      (game.current?.scene as Encounter | null)?.resolve?.(result.isCorrect, questions.length);
      submitting.current = false;
    }
  }
  function next() {
    if (!feedback) return;
    if (index + 1 >= questions.length) setDone(true);
    else { setIndex(i => i + 1); setChoice(null); setFeedback(null); }
    jumpToStudy();
  }
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || done || !questions.length) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, [contenteditable=true]")) return;
      if (!feedback && /^[1-4]$/.test(e.key) && active) {
        const option = active.choices[Number(e.key) - 1];
        if (option) { setChoice(option.id); e.preventDefault(); }
      } else if (e.key === "Enter") {
        if (feedback) { e.preventDefault(); next(); }
        else if (choice) { e.preventDefault(); void submit(); }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  const canGenerate = Boolean(material?.pages.some(p => p.text.trim())) && !busy && models?.available === true && Boolean(model);
  const connectionLabel = status.state === "connected" ? "LEARN connected" : status.state === "reauth-required" ? "Sign-in needed" : "LEARN " + status.state;
  const modelLabel = checkingModel ? "Checking Ollama" : models?.available ? "Local AI ready" : "Local AI offline";

  return (
    <main className="experience">
      <header className="experience-header">
        <div className="brand-line"><span className="brand-mark" aria-hidden="true">S✦</span><div><strong>STUDY<span>AI</span></strong><small>YOUR LEARNING WORKSPACE</small></div></div>
        <div className="header-status"><span className={"connection-chip " + status.state}><i/>{connectionLabel}</span><span className={"connection-chip " + (models?.available ? "connected" : "offline")}><i/>{modelLabel}</span></div>
      </header>
      <section className="hero">
        <div><p className="eyebrow">STUDY SMARTER · REMEMBER LONGER</p><h1>From lecture to <em>level up.</em></h1><p>Choose a real lesson, turn it into a challenge, and see what you know.</p></div>
        <div className="hero-stats"><div><b>{courses.filter(c => c.dataSource.kind === "waterloo-mcp").length}</b><span>courses</span></div><div><b>{topics.length}</b><span>materials</span></div></div>
      </section>
      <div className="journey" aria-label="Study workflow"><span className={courseId ? "complete" : "current"}><b>01</b> Course</span><i/><span className={material ? "complete" : topic ? "current" : ""}><b>02</b> Lecture</span><i/><span className={questions.length ? "current" : ""}><b>03</b> Challenge</span></div>
      {error && <div className="experience-alert" role="alert"><span>{error}</span><button aria-label="Dismiss alert" onClick={() => setError("")}>×</button></div>}
      <div className="experience-layout">
        <aside className="library" aria-label="Course library">
          <div className="library-title"><div><small>YOUR LIBRARY</small><h2>Find a lesson</h2></div><span aria-hidden="true">⌕</span></div>
          <div className="library-body">
            <div className="sync-line"><div><strong>Waterloo LEARN</strong><small>{status.state === "connected" ? "Course index available" : status.message || connectionLabel}</small></div><button disabled={busy} onClick={() => void sync()}>{loading === "courses" ? "Syncing…" : "↻ Sync"}</button></div>
            <label htmlFor="course-picker">Course</label>
            <select id="course-picker" disabled={busy} value={courseId} onChange={e => void chooseCourse(e.target.value)}>
              <option value="">Select a course</option>
              {courses.filter(c => c.dataSource.kind === "waterloo-mcp").map(c => <option key={c.id} value={c.id}>{c.code || c.title}</option>)}
            </select>
            {currentCourse && <p className="selected-course">{currentCourse.title}</p>}
            <div className="library-divider"/>
            <div className="browse-head"><h3>Course materials</h3><span>{topics.length}</span></div>
            {courseId ? <>
              <label htmlFor="material-search" className="visually-hidden">Search lectures and modules</label>
              <input id="material-search" type="search" placeholder="Search lectures or modules…" value={search} onChange={e => {setSearch(e.target.value);setShowMore(false);}}/>
              <div className="filters" aria-label="File type">
                {([{id:"all",name:"All"},{id:"slides",name:"Slides"},{id:"pdf",name:"PDF"},{id:"docs",name:"Docs"}] as const).map(item => <button key={item.id} aria-pressed={filter === item.id} className={filter === item.id ? "active" : ""} onClick={() => {setFilter(item.id);setShowMore(false);}}>{item.name}</button>)}
              </div>
              {loading === "modules" ? <div className="library-skeleton">Loading modules and materials…</div> :
                <div className="material-list">
                  {topicGroups.map(group => <div className="material-group" key={group.title}><div className="group-label">{group.title}</div>{group.items.map(item => <button key={item.id} className={"material-item " + (item.id === topic?.id ? "active" : "")} disabled={busy} onClick={() => void chooseTopic(item)}><span className="file-type">{fileLabel(item.title)}</span><span className="material-name">{item.title}</span></button>)}</div>)}
                  {!matches.length && <div className="library-empty">No matching materials. Try another search or file type.</div>}
                  {!showMore && matches.length > visibleTopics.length && <button className="show-more" onClick={() => setShowMore(true)}>Show all {matches.length} materials</button>}
                </div>}
            </> : <div className="library-empty">Select a course to browse its lectures and files.</div>}
            <div className="demo-link"><strong>Just exploring?</strong><p>Try a sample battle without connecting a course.</p><button onClick={demo}>Try demo challenge</button></div>
          </div>
        </aside>
        <section className="study-column" ref={stage}>
          <article className="source-card">
            <div className="source-top"><span className="eyebrow">{material ? "REAL COURSE MATERIAL" : "YOUR NEXT STUDY SESSION"}</span><span>{material ? material.pages.length + " of " + material.totalPages + " pages" : "LEARN → PRACTICE"}</span></div>
            <h2>{material ? (topic?.title || material.title) : topic ? "Opening " + topic.title : "Choose a lecture to begin"}</h2>
            <p className="source-sub">{material ? (currentCourse?.code || "Waterloo LEARN") + " · " + material.title : "Build practice directly from your own course materials."}</p>
            {loading === "lecture" && <div className="activity-status"><span className="spin"/> Retrieving and converting lecture material locally…</div>}
            {material ? <>
              <div className="material-summary"><div><strong>{material.pages.length} pages extracted</strong><span>{material.source}</span></div><button onClick={() => setPreviewOpen(v => !v)} aria-expanded={previewOpen}>{previewOpen ? "Hide" : "Preview"} text</button></div>
              {previewOpen && <div className="material-preview">{material.pages.map(p => <p key={p.page}><b>Page {p.page}</b>{p.text || "No readable text extracted on this page."}</p>)}</div>}
              <p className="source-note">{material.note}</p>
              <div className="generation-controls">
                <div className="model-picker"><label htmlFor="model-picker">Local AI model</label><select id="model-picker" value={model} onChange={e => setModel(e.target.value)} disabled={busy || checkingModel}>{models?.models.length ? models.models.map(name => <option key={name} value={name}>{name}</option>) : <option value="">No installed models detected</option>}</select><button onClick={() => void refreshModels()} disabled={busy || checkingModel} title="Refresh Ollama models" aria-label="Refresh local models">↻</button></div>
                {!models?.available && !checkingModel && <p className="model-warning">{models?.message || "Ollama isn't connected."} You can still try the demo.</p>}
                {loading === "questions" ? <div className="generation-busy" role="status"><span className="spin"/><div><strong>Creating your challenge</strong><p>Local AI is working. {timeLabel(elapsed)} elapsed; an exact completion estimate is unavailable.</p></div><button onClick={cancelGeneration}>Cancel</button></div> :
                  <button className="cta" disabled={!canGenerate} onClick={() => void generate()}>✦ Generate practice challenge <span aria-hidden="true">→</span></button>}
              </div>
            </> : <div className="source-empty"><span aria-hidden="true">✦</span><p>{topic ? "Your previously selected lecture is available to reopen." : "Select a lesson in your library to create a study challenge."}</p>{topic && courseId && !busy && <button className="reopen-lecture" onClick={() => void chooseTopic(topic)}>Reopen lecture →</button>}</div>}
          </article>
          {questions.length ? <article className="battle-card">
            <header className="battle-head"><div><span className="eyebrow">{source === "live" ? "LECTURE-BASED PRACTICE" : "SYNTHETIC DEMO"}</span><h2>{done ? "Encounter complete" : "Your study encounter"}</h2></div><span className="question-count">{answered} / {questions.length} answered</span></header>
            {modelInfo && source === "live" && <p className="battle-note">Generated using <b>{modelInfo.model}</b>. Citations matched source text; explanations still require review.</p>}
            <div className="session-progress" role="progressbar" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={answered} aria-label="Questions answered"><div style={{width:percent+"%"}}/></div>
            <PhaserGame key={gameKey} ref={game} currentActiveScene={onSceneReady}/>
            {done ? <div className="question-area"><div className="result-score">{correct} <span>/ {questions.length} correct</span></div><h3>{correct === questions.length ? "Great recall. Keep it fresh." : "Progress made. Keep practicing."}</h3><p className="source-note">Answers were recorded locally. Replaying identical questions is practice, not proof of long-term mastery.</p>{nextFocus && <p className="review-next">Review suggestion: {nextFocus.rationale} — {questions.find(q => q.objectiveId === nextFocus.objectiveId)?.objective || "this topic"}</p>}<div className="result-actions"><button className="cta" onClick={() => begin(questions,source)}>Replay challenge</button>{source === "live" && <button className="outline-btn" disabled={busy || !models?.available || !topic} onClick={() => void generate()}>Make new questions</button>}</div></div> :
            active && <div className="question-area"><div className="question-meta"><strong>QUESTION {index + 1} OF {questions.length}</strong><span>{source === "live" ? "Source-based practice" : "Demo practice"}</span></div>{active.objective && <p className="objective-label">Skill: {active.objective}</p>}<h3>{active.prompt}</h3>
              <div className="answer-grid">{active.choices.map((item,position) => {
                const chosen = choice === item.id, solution = item.id === active.correctChoiceId;
                const state = feedback ? solution ? "answer-correct" : chosen ? "answer-wrong" : "dimmed" : chosen ? "chosen" : "";
                return <button key={item.id} className={"answer " + state} disabled={Boolean(feedback)} aria-pressed={chosen} onClick={() => setChoice(item.id)}><span className="answer-key">{position + 1}</span><span>{item.label}</span>{feedback && solution && <span className="answer-icon">✓</span>}{feedback && chosen && !solution && <span className="answer-icon">×</span>}</button>;
              })}</div>
              {feedback ? <><div className={"explanation " + feedback} role="status"><strong>{feedback === "correct" ? "✓ Correct answer" : "Review this concept"}</strong><p>{active.explanation}</p>{active.sourcePage != null && <details><summary>See lecture evidence · page {active.sourcePage}</summary><blockquote>{active.sourceQuote}</blockquote></details>}</div><button className="cta" onClick={next}>{index + 1 < questions.length ? "Next question →" : "View results →"}</button></> :
                <><p className="answer-hint">Tip: press 1–4 to choose and Enter to submit.</p><button className="cta" disabled={!choice} onClick={() => void submit()}>Submit answer →</button></>}
              {saveError && <p className="model-warning" role="alert">{saveError}</p>}
              <p className="mastery-footer">Estimated topic familiarity: {Math.round((mastery[active.objectiveId]?.normalizedScore ?? .2)*100)}% · Experimental heuristic</p>
            </div>}
          </article> : <article className="empty-encounter"><div className="empty-illustration" aria-hidden="true">✦</div><span className="eyebrow">YOUR NEXT CHALLENGE</span><h2>Knowledge is your power-up.</h2><p>Generate questions from your selected lecture to start an encounter—or play the demo.</p><button onClick={demo}>Try the demo →</button></article>}
        </section>
      </div>
      <footer className="experience-footer"><span>STUDYAI BETA · LOCAL-FIRST</span><details><summary>Privacy &amp; accuracy</summary><p>Lecture text is sent only to your local Ollama service when you choose to generate questions. Course material is never intentionally sent to a cloud model by StudyAI. AI-generated explanations may be inaccurate; check the lecture citation before high-stakes use.</p></details></footer>
=======
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
>>>>>>> origin/main
    </main>
  );
}
