import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type CertForgeDatabase } from "../db";
import { importQuestionBank } from "../import-service";
import { listSimulations, progressOverview } from "../history-service";
import { simulationStatistics } from "../statistics";
import { createSimulation, getSimulation, retrySimulation, saveAnswers, confirmTrainingAnswer, submitSimulation, setCurrentPosition, setReviewFlag } from "../simulation-service";
import { testBank } from "./fixtures";
let db: CertForgeDatabase;
beforeEach(() => { db = createTestDb(); importQuestionBank(db, testBank()); });
afterEach(() => { db.close(); vi.useRealTimers(); });
const identity = () => 0.999;
const rotate = () => 0;
function create(mode: "training" | "exam" = "exam", count = 4, random = identity) {
  return createSimulation(db, { mode, questionCount: count, durationMinutes: 30 }, random);
}
function view(id: string) { return getSimulation(db, id)!; }
function pos(id: string, qid: string) { return view(id).questions.find((q) => q.question.id === qid)!.position; }
describe("simulation creation", () => {
  it("preserves custom count and domain distribution", () => {
    const questions = view(create("training", 2)).questions;
    expect(questions).toHaveLength(2);
    expect(new Set(questions.map((q) => q.question.domain))).toEqual(new Set(["D1", "D2"]));
  });
  it("selects all eligible questions across banks and filters", () => {
    const extra = testBank(); extra.id = "c45306e8-e829-4c25-92f2-956454b548c1"; extra.title = "Second bank";
    extra.questions = extra.questions.slice(0, 2); importQuestionBank(db, extra);
    const id = createSimulation(db, { mode: "exam", questionCount: 4, bankIds: [testBank().id, extra.id], certification: "TEST", domain: "D1", topic: "T1" }, rotate);
    expect(view(id).questions).toHaveLength(4);
    expect(view(id).questions.every((q) => q.question.domain === "D1" && q.question.topic === "T1")).toBe(true);
    expect(new Set(view(id).questions.map((q) => q.question.bankTitle))).toEqual(new Set(["Bank", "Second bank"]));
    const all = createSimulation(db, { mode: "training", questionCount: 6 }, identity);
    expect(view(all).questions).toHaveLength(6);
  });
  it("rejects excessive counts and empty eligible pools before writing", () => {
    expect(() => create("exam", 5)).toThrow(/4 questions/);
    expect(() => createSimulation(db, { mode: "exam", questionCount: 1, domain: "missing" })).toThrow(/0 questions/);
    expect(() => create("exam", 0)).toThrow();
    expect(listSimulations(db)).toEqual([]);
  });
  it.each(["training", "exam"] as const)("persists shuffled answers with stable IDs for %s", (mode) => {
    const first = view(create(mode));
    const id = create(mode, 4, rotate), second = view(id);
    for (const item of second.questions) {
      const original = first.questions.find((q) => q.question.id === item.question.id)!;
      expect(item.question.answers).not.toEqual(original.question.answers);
      expect([...item.question.answers].sort((a,b) => a.id.localeCompare(b.id))).toEqual(original.question.answers);
      expect(item.question.correctAnswers).toEqual(original.question.correctAnswers);
      expect(item.question.difficulty).toBe("medium");
    }
    saveAnswers(db, id, 0, ["a"]); setCurrentPosition(db, id, 1); setCurrentPosition(db, id, 0);
    expect(view(id).questions.map((q) => q.question)).toEqual(second.questions.map((q) => q.question));
    const reopened = new Database(db.serialize());
    try { expect(getSimulation(reopened, id)!.questions.map((q) => q.question)).toEqual(second.questions.map((q) => q.question)); }
    finally { reopened.close(); }
    submitSimulation(db, id);
    expect(view(id).questions.map((q) => q.question)).toEqual(second.questions.map((q) => q.question));
  });
});
describe("historical retry", () => {
  it.each(["training", "exam"] as const)("creates a fresh independent %s attempt from old snapshots", (mode) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const id = create(mode);
    saveAnswers(db, id, 0, ["a"]);
    if (mode === "exam") setReviewFlag(db, id, 0, true); else confirmTrainingAnswer(db, id, 0);
    setCurrentPosition(db, id, 2); vi.advanceTimersByTime(60000); submitSimulation(db, id);
    const original = view(id);
    const rows = db.prepare("SELECT * FROM simulation_questions WHERE simulation_id = ? ORDER BY position").all(id);
    const originalRow = db.prepare("SELECT * FROM simulations WHERE id = ?").get(id);
    const answers = db.prepare("SELECT * FROM simulation_answers WHERE simulation_id = ?").all(id);
    importQuestionBank(db, testBank(2, " UPDATED")); vi.advanceTimersByTime(60000);
    const retryId = retrySimulation(db, id, rotate), retry = view(retryId);
    expect(retryId).not.toBe(id); expect(retryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(retry).toMatchObject({ mode, status: "in-progress", completedAt: null, currentPosition: 0, retriedFromSimulationId: id, durationLimitSeconds: original.durationLimitSeconds });
    expect(retry.startedAt).not.toBe(original.startedAt); expect(simulationStatistics(retry).durationSeconds).toBe(0);
    expect(retry.questions).toHaveLength(original.questions.length);
    expect(retry.questions.map((q) => q.question.id)).not.toEqual(original.questions.map((q) => q.question.id));
    for (const item of retry.questions) {
      const previous = original.questions.find((q) => q.question.id === item.question.id)!;
      expect(item).toMatchObject({ selectedAnswers: [], locked: false, correct: null, evaluation: null, forReview: false });
      expect(item.question.answers).not.toEqual(previous.question.answers);
      expect({ ...item.question, answers: [...item.question.answers].sort((a,b) => a.id.localeCompare(b.id)) }).toEqual(previous.question);
    }
    expect(db.prepare("SELECT source_bank_version FROM simulation_questions WHERE simulation_id = ?").all(retryId)).toEqual(Array(4).fill({ source_bank_version: 1 }));
    expect(view(create(mode)).questions[0].question.question).toContain("UPDATED");
    expect(view(id)).toEqual(original);
    expect(db.prepare("SELECT * FROM simulation_questions WHERE simulation_id = ? ORDER BY position").all(id)).toEqual(rows);
    expect(db.prepare("SELECT * FROM simulations WHERE id = ?").get(id)).toEqual(originalRow);
    expect(db.prepare("SELECT * FROM simulation_answers WHERE simulation_id = ?").all(id)).toEqual(answers);
    submitSimulation(db, retryId);
    expect(listSimulations(db).filter((s) => s.status === "completed").map((s) => s.id)).toEqual(expect.arrayContaining([id, retryId]));
  });
  it("rejects active and missing originals and retries only a historical subset", () => {
    const id = create("exam", 2);
    expect(() => retrySimulation(db, id)).toThrow(/Only completed/);
    expect(() => retrySimulation(db, "missing")).toThrow(/not found/);
    submitSimulation(db, id);
    expect(view(retrySimulation(db, id, rotate)).questions.map((q) => q.question.id).sort()).toEqual(view(id).questions.map((q) => q.question.id).sort());
  });
});
describe("selection limits and fractional scoring", () => {
  it.each(["training", "exam"] as const)("enforces server limits in %s and preserves saved answers on rejection", (mode) => {
    const id = create(mode), p = pos(id, "q2");
    saveAnswers(db, id, p, ["a", "b"]);
    expect(() => saveAnswers(db, id, p, ["a", "b", "c"])).toThrow(/at most 2/);
    expect(view(id).questions[p].selectedAnswers).toEqual(["a", "b"]);
    expect(() => saveAnswers(db, id, p, ["invalid"])).toThrow(/invalid/);
    saveAnswers(db, id, p, ["a", "a", "c"]); expect(view(id).questions[p].selectedAnswers).toEqual(["a", "c"]);
    expect(() => saveAnswers(db, id, pos(id, "q1"), ["a", "b"])).toThrow(/only one/);
  });
  it("evaluates training only on confirmation and locks partial feedback", () => {
    const id = create("training"), p = pos(id, "q2");
    expect(() => confirmTrainingAnswer(db, id, p)).toThrow(/at least one/);
    saveAnswers(db, id, p, ["a", "b"]);
    expect(view(id).questions[p]).toMatchObject({ locked: false, evaluation: null, correct: null });
    expect(confirmTrainingAnswer(db, id, p)).toEqual({ status: "partial", score: 0.5 });
    expect(view(id).questions[p]).toMatchObject({ locked: true, correct: false });
    expect(() => saveAnswers(db, id, p, ["a", "c"])).toThrow(/locked/);
    submitSimulation(db, id); expect(view(id).questions[p].evaluation?.score).toBe(0.5);
  });
  it("allows exam changes until submission and evaluates then", () => {
    const id = create(), p = pos(id, "q2");
    saveAnswers(db, id, p, ["a", "b"]); saveAnswers(db, id, p, ["a", "c"]);
    expect(view(id).questions[p]).toMatchObject({ locked: false, evaluation: null });
    submitSimulation(db, id);
    expect(view(id).questions[p]).toMatchObject({ locked: true, correct: true, evaluation: { status: "correct", score: 1 } });
    expect(() => saveAnswers(db, id, p, ["b"])).toThrow(/complete/);
  });
  it.each(["training", "exam"] as const)("uses fractional overall, domain, topic, history and progress scores in %s", (mode) => {
    const id = create(mode), selections: Record<string, string[]> = { q1: ["a"], q2: ["a", "b"], q3: ["b"], q4: ["a"] };
    for (const q of view(id).questions) {
      saveAnswers(db, id, q.position, selections[q.question.id]);
      if (mode === "training") confirmTrainingAnswer(db, id, q.position);
    }
    submitSimulation(db, id); const completed = view(id), stats = simulationStatistics(completed);
    expect(stats).toMatchObject({ correct: 2, partial: 1, incorrect: 1, total: 4, credit: 2.5, percent: 62.5 });
    expect(stats.byDomain).toEqual([{ name: "D1", correct: 1, credit: 1.5, total: 2, percent: 75 }, { name: "D2", correct: 1, credit: 1, total: 2, percent: 50 }]);
    expect(stats.byTopic.map((q) => q.percent)).toEqual([75, 50]); expect(listSimulations(db)[0].scorePercent).toBe(62.5);
    const progress = progressOverview(db);
    expect(progress).toMatchObject({ completed: 1, average: 62.5, recentAverage: 62.5 });
    expect(progress.byDomain).toEqual(stats.byDomain); expect(progress.byTopic).toEqual(stats.byTopic);
    expect(progress.byMode.find((q) => q.mode === mode)?.average).toBe(62.5);
    submitSimulation(db, id); expect(view(id)).toEqual(completed);
  });
  it("scores unanswered questions as zero on expiry", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const id = create(); saveAnswers(db, id, pos(id, "q2"), ["a", "b"]); vi.advanceTimersByTime(1800000);
    expect(view(id).status).toBe("completed");
    expect(simulationStatistics(view(id))).toMatchObject({ correct: 0, partial: 1, incorrect: 3, percent: 12.5 });
  });
});
