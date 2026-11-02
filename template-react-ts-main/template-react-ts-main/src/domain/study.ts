import type { AnswerResult, IdentifiedLearningObjective, LocalLearningMaterial, MasteryState, MultipleChoiceQuestion, StudyRecommendation, SubmittedAnswer } from "./contracts";
import { DefaultScheduler, Rating, type DefaultScheduler as FSRSScheduler } from "ts-fsrs";

export const DEMO_MATERIAL: LocalLearningMaterial = { id: "synthetic-buffer-equilibrium", courseId: "local-demo", title: "Buffer equilibrium: a local demo", contentText: "A buffer resists a change in pH because a weak acid and its conjugate base consume added hydrogen or hydroxide ions. The Henderson-Hasselbalch relationship compares their concentrations.", fingerprint: "synthetic-buffer-equilibrium-v1", provenance: { origin: "synthetic", sourceId: "local-demo" }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

const STOP_WORDS = new Set("a an and are as at because by for from has in is its of on or that the their this to with".split(" "));
function conceptTerms(sentence: string): string[] { const terms = sentence.toLowerCase().match(/[a-z][a-z-]{2,}|ph\b/g) ?? []; return [...new Set(terms.filter((term) => !STOP_WORDS.has(term)))].slice(0, 5); }
function objectiveId(materialId: string, sentence: string, index: number): string { const slug = sentence.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48); return `${materialId}-${index + 1}-${slug || "objective"}`; }

export function identifyObjectives(material: LocalLearningMaterial = DEMO_MATERIAL): IdentifiedLearningObjective[] { return material.contentText.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean).map((statement, index) => ({ id: objectiveId(material.id, statement, index), materialId: material.id, courseId: material.courseId, statement, confidence: Math.min(0.95, 0.7 + statement.length / 500), conceptTerms: conceptTerms(statement), order: index + 1 })).filter((objective) => objective.conceptTerms && objective.conceptTerms.length > 0); }

export function makeQuestion(objective: IdentifiedLearningObjective): MultipleChoiceQuestion { return { id: `q-${objective.id}`, objectiveId: objective.id, prompt: `Which statement best matches this lesson objective: ${objective.statement}`, choices: [{ id: "a", label: objective.statement }, { id: "b", label: "The lesson provides no related concept." }, { id: "c", label: "The concept is unrelated to the lesson." }], correctChoiceId: "a", explanation: `This answer restates the local lesson objective: ${objective.statement}` }; }
export function evaluateAnswer(question: MultipleChoiceQuestion, answer: SubmittedAnswer, now = new Date().toISOString()): AnswerResult { return { questionId: question.id, objectiveId: question.objectiveId, submittedChoiceId: answer.choiceId, correctChoiceId: question.correctChoiceId, isCorrect: answer.choiceId === question.correctChoiceId, explanation: question.explanation, evaluatedAt: now }; }
let schedulerPromise: Promise<FSRSScheduler<"FSRS-7">> | null = null;
function getScheduler(): Promise<FSRSScheduler<"FSRS-7">> { return schedulerPromise ??= DefaultScheduler<"FSRS-7">({ desiredRetention: .9, enableFuzz: false }); }

export async function updateMastery(previous: MasteryState | null, result: AnswerResult, now = result.evaluatedAt): Promise<MasteryState> {
  const scheduler = await getScheduler();
  const reviewAt = new Date(now);
  const savedCard = previous?.fsrsCard;
  const restoredCard = savedCard && typeof savedCard.dueAt === "string" && Number.isFinite(Date.parse(savedCard.dueAt))
    ? { ...savedCard, dueAt: new Date(savedCard.dueAt), lastReviewAt: typeof savedCard.lastReviewAt === "string" ? new Date(savedCard.lastReviewAt) : null }
    : scheduler.newCard({ now: reviewAt });
  const cardData = restoredCard as Record<string, unknown>;
  const card = { ...cardData, stabilityFast: Number(cardData.stabilityFast ?? cardData.stability ?? 0) } as unknown as Parameters<typeof scheduler.review>[0]["card"];
  const review = scheduler.review({ card, grade: result.isCorrect ? Rating.Good : Rating.Again, now: reviewAt });
  const attempts = (previous?.attempts ?? 0) + 1;
  const correctCount = (previous?.correctCount ?? 0) + (result.isCorrect ? 1 : 0);
  const normalizedScore = Math.max(0, Math.min(1, (previous?.normalizedScore ?? .2) + (result.isCorrect ? .18 : -.12)));
  return {
    objectiveId: previous?.objectiveId || result.objectiveId,
    normalizedScore,
    attempts,
    correctCount,
    lastAttemptAt: now,
    nextReviewAt: review.card.dueAt.toISOString(),
    fsrsCard: JSON.parse(JSON.stringify(review.card)) as Record<string, unknown>,
  };
}
export function rankRecommendations(objectives: IdentifiedLearningObjective[], mastery: Record<string, MasteryState>, now = Date.now()): StudyRecommendation[] { return objectives.map((objective) => { const state = mastery[objective.id]; const due = !state?.nextReviewAt || Date.parse(state.nextReviewAt) <= now; const normalizedPriority = Math.max(0, Math.min(1, (1 - (state?.normalizedScore ?? .2)) * (due ? 1 : .55))); return { objectiveId: objective.id, normalizedPriority, rationale: !state ? "New objective to learn" : due ? "Review is due now" : "Keep momentum with a lighter review", dueAt: state?.nextReviewAt ?? null }; }).sort((a, b) => b.normalizedPriority - a.normalizedPriority); }
