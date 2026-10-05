import { SimulationEntity, SimulationQuestionEntity, SimulationAnswerEntity } from "../persistence/entities";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "./test-db";
import type { CertForgeDatabase } from "../db";
import { importQuestionBank } from "../import-service";
import { listSimulations, progressOverview } from "../history-service";
import { simulationStatistics } from "../statistics";
import { createSimulation, getSimulation, retrySimulation, saveAnswers, confirmTrainingAnswer, submitSimulation, setCurrentPosition, setReviewFlag } from "../simulation-service";
import { testBank } from "./fixtures";
let db: CertForgeDatabase;
beforeEach(async () => { db = (await createTestDb()); (await importQuestionBank(db, testBank())); });
afterEach(async () => { await db.destroy(); vi.useRealTimers(); });
const identity = () => 0.999;
const rotate = () => 0;
async function create(mode: "training" | "exam" = "exam", count = 4, random = identity) {
    return (await createSimulation(db, { mode, questionCount: count, durationMinutes: 30 }, random));
}
async function view(id: string) { return (await getSimulation(db, id))!; }
async function pos(id: string, qid: string) { return (await view(id)).questions.find((q) => q.question.id === qid)!.position; }
describe("simulation creation", () => {
    it("preserves custom count and domain distribution", async () => {
        const questions = (await view((await create("training", 2)))).questions;
        expect(questions).toHaveLength(2);
        expect(new Set(questions.map((q) => q.question.domain))).toEqual(new Set(["D1", "D2"]));
    });
    it("selects all eligible questions across banks and filters", async () => {
        const extra = testBank();
        extra.id = "c45306e8-e829-4c25-92f2-956454b548c1";
        extra.title = "Second bank";
        extra.questions = extra.questions.slice(0, 2);
        (await importQuestionBank(db, extra));
        const id = (await createSimulation(db, { mode: "exam", questionCount: 4, bankIds: [testBank().id, extra.id], certification: "TEST", domain: "D1", topic: "T1" }, rotate));
        expect((await view(id)).questions).toHaveLength(4);
        expect((await view(id)).questions.every((q) => q.question.domain === "D1" && q.question.topic === "T1")).toBe(true);
        expect(new Set((await view(id)).questions.map((q) => q.question.bankTitle))).toEqual(new Set(["Bank", "Second bank"]));
        const all = (await createSimulation(db, { mode: "training", questionCount: 6 }, identity));
        expect((await view(all)).questions).toHaveLength(6);
    });
    it("rejects excessive counts and empty eligible pools before writing", async () => {
        await expect(create("exam", 5)).rejects.toThrow(/4 questions/);
        await expect(createSimulation(db, { mode: "exam", questionCount: 1, domain: "missing" })).rejects.toThrow(/0 questions/);
        await expect(create("exam", 0)).rejects.toThrow();
        expect((await listSimulations(db))).toEqual([]);
    });
    it.each(["training", "exam"] as const)("persists shuffled answers with stable IDs for %s", async (mode) => {
        const first = (await view((await create(mode))));
        const id = (await create(mode, 4, rotate)), second = (await view(id));
        for (const item of second.questions) {
            const original = first.questions.find((q) => q.question.id === item.question.id)!;
            expect(item.question.answers).not.toEqual(original.question.answers);
            expect([...item.question.answers].sort((a, b) => a.id.localeCompare(b.id))).toEqual(original.question.answers);
            expect(item.question.correctAnswers).toEqual(original.question.correctAnswers);
            expect(item.question.difficulty).toBe("medium");
        }
        (await saveAnswers(db, id, 0, ["a"]));
        (await setCurrentPosition(db, id, 1));
        (await setCurrentPosition(db, id, 0));
        expect((await view(id)).questions.map((q) => q.question)).toEqual(second.questions.map((q) => q.question));
        (await submitSimulation(db, id));
        expect((await view(id)).questions.map((q) => q.question)).toEqual(second.questions.map((q) => q.question));
    });
});
describe("historical retry", () => {
    it.each(["training", "exam"] as const)("creates a fresh independent %s attempt from old snapshots", async (mode) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
        const id = (await create(mode));
        (await saveAnswers(db, id, 0, ["a"]));
        if (mode === "exam")
            (await setReviewFlag(db, id, 0, true));
        else
            (await confirmTrainingAnswer(db, id, 0));
        (await setCurrentPosition(db, id, 2));
        vi.advanceTimersByTime(60000);
        (await submitSimulation(db, id));
        const original = (await view(id));
        const rows = (await db.getRepository(SimulationQuestionEntity).find({ where: { simulation_id: id }, order: { position: "ASC" } }));
        const originalRow = (await db.getRepository(SimulationEntity).findOneBy({ id }));
        const answers = (await db.getRepository(SimulationAnswerEntity).findBy({ simulation_id: id }));
        (await importQuestionBank(db, testBank(2, " UPDATED")));
        vi.advanceTimersByTime(60000);
        const retryId = (await retrySimulation(db, id, rotate)), retry = (await view(retryId));
        expect(retryId).not.toBe(id);
        expect(retryId).toMatch(/^[0-9a-f-]{36}$/);
        expect(retry).toMatchObject({ mode, status: "in-progress", completedAt: null, currentPosition: 0, retriedFromSimulationId: id, durationLimitSeconds: original.durationLimitSeconds });
        expect(retry.startedAt).not.toBe(original.startedAt);
        expect(simulationStatistics(retry).durationSeconds).toBe(0);
        expect(retry.questions).toHaveLength(original.questions.length);
        expect(retry.questions.map((q) => q.question.id)).not.toEqual(original.questions.map((q) => q.question.id));
        for (const item of retry.questions) {
            const previous = original.questions.find((q) => q.question.id === item.question.id)!;
            expect(item).toMatchObject({ selectedAnswers: [], locked: false, correct: null, evaluation: null, forReview: false });
            expect(item.question.answers).not.toEqual(previous.question.answers);
            expect({ ...item.question, answers: [...item.question.answers].sort((a, b) => a.id.localeCompare(b.id)) }).toEqual(previous.question);
        }
        expect((await db.getRepository(SimulationQuestionEntity).find({ select: { source_bank_version: true }, where: { simulation_id: retryId } }))).toEqual(Array(4).fill({ source_bank_version: 1 }));
        expect((await view((await create(mode)))).questions[0].question.question).toContain("UPDATED");
        expect((await view(id))).toEqual(original);
        expect((await db.getRepository(SimulationQuestionEntity).find({ where: { simulation_id: id }, order: { position: "ASC" } }))).toEqual(rows);
        expect((await db.getRepository(SimulationEntity).findOneBy({ id }))).toEqual(originalRow);
        expect((await db.getRepository(SimulationAnswerEntity).findBy({ simulation_id: id }))).toEqual(answers);
        (await submitSimulation(db, retryId));
        expect((await listSimulations(db)).filter((s) => s.status === "completed").map((s) => s.id)).toEqual(expect.arrayContaining([id, retryId]));
    });
    it("rejects active and missing originals and retries only a historical subset", async () => {
        const id = (await create("exam", 2));
        await expect(retrySimulation(db, id)).rejects.toThrow(/Only completed/);
        await expect(retrySimulation(db, "missing")).rejects.toThrow(/not found/);
        (await submitSimulation(db, id));
        expect((await view((await retrySimulation(db, id, rotate)))).questions.map((q) => q.question.id).sort()).toEqual((await view(id)).questions.map((q) => q.question.id).sort());
    });
});
describe("selection limits and fractional scoring", () => {
    it.each(["training", "exam"] as const)("enforces server limits in %s and preserves saved answers on rejection", async (mode) => {
        const id = (await create(mode)), p = (await pos(id, "q2"));
        (await saveAnswers(db, id, p, ["a", "b"]));
        await expect(saveAnswers(db, id, p, ["a", "b", "c"])).rejects.toThrow(/at most 2/);
        expect((await view(id)).questions[p].selectedAnswers).toEqual(["a", "b"]);
        await expect(saveAnswers(db, id, p, ["invalid"])).rejects.toThrow(/invalid/);
        (await saveAnswers(db, id, p, ["a", "a", "c"]));
        expect((await view(id)).questions[p].selectedAnswers).toEqual(["a", "c"]);
        await expect(saveAnswers(db, id, (await pos(id, "q1")), ["a", "b"])).rejects.toThrow(/only one/);
    });
    it("evaluates training only on confirmation and locks partial feedback", async () => {
        const id = (await create("training")), p = (await pos(id, "q2"));
        await expect(confirmTrainingAnswer(db, id, p)).rejects.toThrow(/at least one/);
        (await saveAnswers(db, id, p, ["a", "b"]));
        expect((await view(id)).questions[p]).toMatchObject({ locked: false, evaluation: null, correct: null });
        expect((await confirmTrainingAnswer(db, id, p))).toEqual({ status: "partial", score: 0.5 });
        expect((await view(id)).questions[p]).toMatchObject({ locked: true, correct: false });
        await expect(saveAnswers(db, id, p, ["a", "c"])).rejects.toThrow(/locked/);
        (await submitSimulation(db, id));
        expect((await view(id)).questions[p].evaluation?.score).toBe(0.5);
    });
    it("allows exam changes until submission and evaluates then", async () => {
        const id = (await create()), p = (await pos(id, "q2"));
        (await saveAnswers(db, id, p, ["a", "b"]));
        (await saveAnswers(db, id, p, ["a", "c"]));
        expect((await view(id)).questions[p]).toMatchObject({ locked: false, evaluation: null });
        (await submitSimulation(db, id));
        expect((await view(id)).questions[p]).toMatchObject({ locked: true, correct: true, evaluation: { status: "correct", score: 1 } });
        await expect(saveAnswers(db, id, p, ["b"])).rejects.toThrow(/complete/);
    });
    it.each(["training", "exam"] as const)("uses fractional overall, domain, topic, history and progress scores in %s", async (mode) => {
        const id = (await create(mode)), selections: Record<string, string[]> = { q1: ["a"], q2: ["a", "b"], q3: ["b"], q4: ["a"] };
        for (const q of (await view(id)).questions) {
            (await saveAnswers(db, id, q.position, selections[q.question.id]));
            if (mode === "training")
                (await confirmTrainingAnswer(db, id, q.position));
        }
        (await submitSimulation(db, id));
        const completed = (await view(id)), stats = simulationStatistics(completed);
        expect(stats).toMatchObject({ correct: 2, partial: 1, incorrect: 1, total: 4, credit: 2.5, percent: 62.5 });
        expect(stats.byDomain).toEqual([{ name: "D1", correct: 1, credit: 1.5, total: 2, percent: 75 }, { name: "D2", correct: 1, credit: 1, total: 2, percent: 50 }]);
        expect(stats.byTopic.map((q) => q.percent)).toEqual([75, 50]);
        expect((await listSimulations(db))[0].scorePercent).toBe(62.5);
        const progress = (await progressOverview(db));
        expect(progress).toMatchObject({ completed: 1, average: 62.5, recentAverage: 62.5 });
        expect(progress.byDomain).toEqual(stats.byDomain);
        expect(progress.byTopic).toEqual(stats.byTopic);
        expect(progress.byMode.find((q) => q.mode === mode)?.average).toBe(62.5);
        (await submitSimulation(db, id));
        expect((await view(id))).toEqual(completed);
    });
    it("scores unanswered questions as zero on expiry", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
        const id = (await create());
        (await saveAnswers(db, id, (await pos(id, "q2")), ["a", "b"]));
        vi.advanceTimersByTime(1800000);
        expect((await view(id)).status).toBe("completed");
        expect(simulationStatistics((await view(id)))).toMatchObject({ correct: 0, partial: 1, incorrect: 3, percent: 12.5 });
    });
});
