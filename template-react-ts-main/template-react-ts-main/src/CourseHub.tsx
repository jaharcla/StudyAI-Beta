import { useEffect, useState, type FormEvent } from "react";
import { getCourseExamContext, getCourseOverview, searchWholeCourse } from "./domain/course-hub";
import type { ExamResult, Overview, SearchResult } from "./domain/course-hub";
import type { LearnTopic } from "./domain/live";

interface Props {
  courseId: string;
  courseName: string;
  topics: LearnTopic[];
  onOpenTopic: (topic: LearnTopic) => void;
}
function dateLabel(date: string) {
  const when = new Date(date);
  return Number.isNaN(when.getTime()) ? "Date unavailable" : when.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function smallText(value: unknown) {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}
function findTopic(item: Record<string,unknown>, topics: LearnTopic[]): LearnTopic | null {
  const id = smallText(item.topicId ?? item.topic_id ?? item.id);
  return topics.find(t => t.id === id) || null;
}
export function CourseHub({ courseId, courseName, topics, onOpenTopic }: Props) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fullProfile, setFullProfile] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);
  const [exam, setExam] = useState<ExamResult | null>(null);
  const [examError, setExamError] = useState("");
  const [examLoading, setExamLoading] = useState(false);

  useEffect(() => {
    let live = true;
    setOverview(null); setOverviewError(""); setSearch(null); setExam(null); setQuery(""); setFullProfile(false);
    setLoading(true);
    void getCourseOverview(courseId).then(data => { if (live) setOverview(data); })
      .catch(error => { if (live) setOverviewError((error as Error).message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [courseId]);

  async function refresh() {
    setLoading(true); setOverviewError("");
    try { setOverview(await getCourseOverview(courseId, true, fullProfile)); }
    catch(error) { setOverviewError((error as Error).message); }
    finally { setLoading(false); }
  }
  async function loadFullProfile() {
    setLoading(true); setOverviewError("");
    try {
      setOverview(await getCourseOverview(courseId, false, true));
      setFullProfile(true);
    } catch(error) { setOverviewError((error as Error).message); }
    finally { setLoading(false); }
  }
  async function prepareExam() {
    setExamLoading(true); setExamError("");
    try { setExam(await getCourseExamContext(courseId)); }
    catch(error) { setExamError((error as Error).message); }
    finally { setExamLoading(false); }
  }
  async function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (query.trim().length < 2 || searching) return;
    setSearching(true); setSearchError(""); setSearch(null);
    try { setSearch(await searchWholeCourse(courseId, query.trim())); }
    catch(error) { setSearchError((error as Error).message); }
    finally { setSearching(false); }
  }
  const sources = overview?.sources;
  const ready = sources ? Object.values(sources).filter(item => item.state === "available").length : 0;
  const materialResults = Array.isArray(search?.search?.results) ? search.search.results : [];
  const examMaterials = Array.isArray(exam?.context?.studyMaterials) ? exam.context.studyMaterials : [];
  const examWarnings = Array.isArray(exam?.context?.warnings) ? exam.context.warnings : [];

  return <article className="hub-card" aria-label={courseName + " course dashboard"}>
    <div className="hub-head">
      <div><span className="eyebrow">COURSE INTELLIGENCE</span><h2>{courseName || "Your course"} at a glance</h2><p>Organize across lectures, deadlines and assessments—not one file at a time.</p></div>
      <div className="hub-head-actions">{!fullProfile && <button className="hub-action" disabled={loading} onClick={() => void loadFullProfile()}>Load full profile</button>}<button className="hub-refresh" disabled={loading} onClick={() => void refresh()}>{loading ? "Loading…" : "↻ Refresh"}</button></div>
    </div>
    {loading && <p className="hub-loading" role="status">{fullProfile ? "Refreshing LEARN information. Some sources can take longer and may fail independently." : "Retrieving LEARN course information. Full grade, assignment and outline details are optional."}</p>}
    {overviewError && <p className="hub-warning" role="alert">Course overview: {overviewError}</p>}
    {overview && <>
      <div className="hub-summary">
        <div><strong>{topics.length}</strong><span>Course materials</span></div>
        <div><strong>{overview.due.length}</strong><span>Upcoming dates found</span></div>
        <div><strong>{ready}/5</strong><span>LEARN sources read</span></div>
      </div>
      {!fullProfile && <p className="hub-secondary">Quick view checks the calendar and announcements. Select <b>Load full profile</b> for assignments, grades and course outline.</p>}
      <div className="hub-section-head"><h3>Next up</h3><small>{overview.cached ? "Cached snapshot" : "Updated " + new Date(overview.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small></div>
      {overview.due.length ? <div className="hub-due-list">
        {overview.due.slice(0, 5).map((item,i) => <div key={item.title + item.dueAt + i} className="hub-due-item"><span>{dateLabel(item.dueAt)}</span><div><strong>{item.title}</strong><small>{item.origin}</small></div></div>)}
      </div> : <p className="hub-secondary">No upcoming dates were returned by the available LEARN sources. This does not guarantee you have nothing due.</p>}
      {overview.warnings.length > 0 && <details className="hub-disclosure"><summary>{overview.warnings.length} source(s) unavailable — inspect</summary>{overview.warnings.map(item => <p key={item.source}><b>{item.source}</b>: {item.message}</p>)}</details>}
      <details className="hub-disclosure"><summary>Announcements, grades and course outline</summary>
        <div className="hub-details">
          <h4>Recent announcements</h4>
          {sources?.announcements?.state === "available" ? (sources.announcements.items ?? []).slice(0, 4).map(item => <div key={item.id}><strong>{item.title}</strong><p>{item.body?.slice(0, 250)}</p></div>) : <p>Not available from LEARN.</p>}
          <h4>Gradebook</h4>
          {sources?.grades?.state === "available" ? (sources.grades.items ?? []).slice(0, 8).map((item,i) => <p key={i}><strong>{item.item}</strong> — {item.grade || "Not graded"}{item.weight ? " · weight " + item.weight : ""}</p>) : <p>{sources?.grades?.state === "not-checked" ? "Not loaded yet. Select Load full profile." : "Gradebook not available from LEARN."}</p>}
          <h4>Course outline</h4>
          {sources?.outline?.state === "available" ? <><p>{sources.outline.title || "Course outline available"}</p>{sources.outline.url && <a href={sources.outline.url} target="_blank" rel="noreferrer">Open official outline</a>}</> : <p>{sources?.outline?.state === "not-checked" ? "Not loaded yet. Select Load full profile." : "Course outline not available from LEARN."}</p>}
        </div>
      </details>
    </>}
    <div className="hub-tools">
      <section>
        <div className="hub-section-head"><h3>Prepare for an exam</h3></div>
        <p className="hub-secondary">Use the existing LEARN exam-context tool to identify scope, relevant lectures and available assessment signals.</p>
        <button className="hub-action" disabled={examLoading} onClick={() => void prepareExam()}>{examLoading ? "Finding exam scope…" : "Prepare exam study context"}</button>
        {examError && <p className="hub-warning">{examError}</p>}
        {exam && <div className="hub-result"><strong>Exam context retrieved</strong><p>{examMaterials.length} potentially relevant materials identified. Assessment: {exam.context.assessment || "requested exam"}.</p>
          {examMaterials.slice(0, 7).map((item,i) => {
            const topic = findTopic(item, topics);
            return <div key={i} className="hub-match"><span>{smallText(item.title ?? item.name) || "Course material " + (i+1)}</span>{topic && <button onClick={() => onOpenTopic(topic)}>Open</button>}</div>;
          })}
          {examWarnings.length > 0 && <p>{examWarnings.length} source warnings; exam coverage may be incomplete.</p>}
        </div>}
      </section>
      <section>
        <div className="hub-section-head"><h3>Search the whole course</h3></div>
        <p className="hub-secondary">Find cited passages across multiple files using the existing LEARN index. First search may need to download files.</p>
        <form className="hub-search" onSubmit={e => void runSearch(e)}><input aria-label="Search concepts across course materials" value={query} onChange={e => setQuery(e.target.value)} placeholder="e.g. oblique triangles, Law of Cosines" minLength={2} maxLength={200}/><button disabled={searching || query.trim().length < 2} type="submit">{searching ? "Searching…" : "Search"}</button></form>
        {searching && <p className="hub-secondary" role="status">Searching up to 12 lecture files through your local connector. This may be slower the first time.</p>}
        {searchError && <p className="hub-warning">{searchError}</p>}
        {search && <div className="hub-result"><strong>{materialResults.length} cited passage(s)</strong><p>{search.search.indexedFiles ?? "Unknown"} indexed files; {search.search.failedFiles ?? "unknown"} failed files.</p>
          {materialResults.slice(0, 8).map((item,i) => {
            const topic = findTopic(item, topics);
            const heading = smallText(item.title ?? item.filename ?? item.materialTitle ?? item.topicTitle) || "Result " + (i+1);
            const excerpt = smallText(item.excerpt ?? item.snippet ?? item.text ?? item.passage).slice(0, 450);
            const page = item.page ?? item.pageNumber;
            return <div className="hub-match" key={i}><div><strong>{heading}{page ? " · p. " + String(page) : ""}</strong><p>{excerpt || "Passage returned by the course index."}</p></div>{topic && <button onClick={() => onOpenTopic(topic)}>Open lecture</button>}</div>;
          })}
        </div>}
      </section>
    </div>
  </article>;
}
