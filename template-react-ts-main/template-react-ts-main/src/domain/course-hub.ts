import { loadCourseOverview as _loadCourseOverview, loadExamContext as _loadExamContext, searchCourseMaterials as _searchCourseMaterials } from "./live";

export type Overview = Awaited<ReturnType<typeof _loadCourseOverview>>;
export type ExamResult = Awaited<ReturnType<typeof _loadExamContext>>;
export type SearchResult = Awaited<ReturnType<typeof _searchCourseMaterials>>;

export async function getCourseOverview(courseId: string, refresh = false, full = false): Promise<Overview> {
  return _loadCourseOverview(courseId, refresh, full);
}

export async function getCourseExamContext(courseId: string): Promise<ExamResult> {
  return _loadExamContext(courseId);
}

export async function searchWholeCourse(courseId: string, query: string): Promise<SearchResult> {
  return _searchCourseMaterials(courseId, query);
}
