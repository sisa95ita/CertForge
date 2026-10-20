import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DataSource } from "typeorm";
import { questionBankSchema } from "../question-bank-schema";
import { importQuestionBank } from "../import-service";
import { createDataSource, initializeDatabase } from "../persistence/data-source";
import { QuestionBankEntity, QuestionBankVersionEntity, QuestionEntity, SimulationQuestionEntity } from "../persistence/entities";
import { confirmTrainingAnswer, createSimulation, getSimulation, retrySimulation, saveAnswers, setCurrentPosition, submitSimulation } from "../simulation-service";
import { evaluateQuestion } from "../evaluation";
import { correctAnswerIds, isFullyAnswered, matrixAnswerId, matrixSelection, withMatrixAnswer } from "../question-answers";
import { listSimulations, progressOverview } from "../history-service";
import { simulationStatistics } from "../statistics";
import type { SnapshotQuestion, YesNo } from "../types";
import { testBank } from "./fixtures";
import demo from "../../../examples/demo-question-bank-v2.json";
import { completionQuestion, matrixQuestion, v2Bank } from "./v2-fixtures";

const databases: DataSource[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).filter((db) => db.isInitialized).map((db) => db.destroy()));
  directories.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});
async function setup(filename = ":memory:") {
  const db = await initializeDatabase(createDataSource(filename)); databases.push(db);
  expect((await importQuestionBank(db, v2Bank())).status).toBe("imported");
  return db;
}
const identity = () => 0.999;
const rotate = () => 0;
function matrixSnapshot(): SnapshotQuestion {
  return { ...matrixQuestion(), bankTitle: "Bank", certification: testBank().certification, answers: [], correctAnswers: [] };
}
function choices(values: (YesNo | null)[]): string[] {
  return values.flatMap((answer, index) => answer ? [matrixAnswerId(matrixQuestion().statements[index].id, answer)] : []);
}

describe("schema V2 validation", () => {
  it("validates the documented V2 example bank", () => {
    expect(questionBankSchema.safeParse(demo).success).toBe(true);
  });
  it("accepts all four types in V2 and retains V1's free-form difficulty", () => {
    expect(questionBankSchema.safeParse({ ...v2Bank(), questions: [...v2Bank().questions, ...testBank().questions] }).success).toBe(true);
    const v1 = testBank(); v1.questions[0].difficulty = "custom legacy level";
    expect(questionBankSchema.safeParse(v1).success).toBe(true);
    expect(questionBankSchema.safeParse({ ...v2Bank(), schemaVersion: 1 }).success).toBe(false);
  });
  it("allows a matrix without an overall explanation", () => {
    const { explanation, ...matrix } = matrixQuestion();
    expect(explanation).toBeTruthy();
    expect(questionBankSchema.safeParse({ ...v2Bank(), questions: [matrix] }).success).toBe(true);
  });
  it.each([0, 1, 2, 4])("rejects a matrix with %s statements", (length) => {
    const statements = Array.from({ length }, (_, index) => ({ ...matrixQuestion().statements[index % 3], id: String(index) }));
    expect(questionBankSchema.safeParse({ ...v2Bank(), questions: [{ ...matrixQuestion(), statements }] }).success).toBe(false);
  });
  it.each([
    { id: "" }, { id: "s2" }, { text: " " }, { correctAnswer: "true" }, { explanation: "" },
  ])("rejects malformed matrix statements %j", (invalid) => {
    const matrix = matrixQuestion();
    expect(questionBankSchema.safeParse({ ...v2Bank(), questions: [{ ...matrix, statements: [{ ...matrix.statements[0], ...invalid }, ...matrix.statements.slice(1)] }] }).success).toBe(false);
  });
  it.each([
    { question: "No blank" }, { question: "{{blank}} plus {{blank}}" },
    { answers: [completionQuestion().answers[0]] },
    { answers: [completionQuestion().answers[0], completionQuestion().answers[0]] },
    { correctAnswers: [] }, { correctAnswers: ["opaque-option-1", "opaque-option-2"] },
    { correctAnswers: ["missing"] }, { explanation: "" }, { domain: "" }, { topic: "" },
    { difficulty: "unsupported" }, { learnReference: { title: "Learn", url: "https://example.com/" } },
  ])("rejects malformed completion %j", (invalid) => {
    expect(questionBankSchema.safeParse({ ...v2Bank(), questions: [{ ...completionQuestion(), ...invalid }] }).success).toBe(false);
  });
  it("rejects malformed V2 imports atomically, including a newer installed bank version", async () => {
    const db = await setup();
    const before = await db.getRepository(QuestionEntity).find();
    const invalid = v2Bank(2); invalid.questions = [completionQuestion(), { ...matrixQuestion(), statements: [] }];
    expect((await importQuestionBank(db, invalid)).status).toBe("failed");
    expect(await db.getRepository(QuestionEntity).find()).toEqual(before);
    expect(await db.getRepository(QuestionBankVersionEntity).count()).toBe(1);
    expect((await db.getRepository(QuestionBankEntity).findOneByOrFail({ id: invalid.id })).current_version).toBe(1);
    expect((await importQuestionBank(db, { ...invalid, id: testBank().id })).status).toBe("failed");
    expect(await db.getRepository(QuestionBankEntity).count()).toBe(1);
  });
});

describe("normalized V2 scoring", () => {
  it.each([
    { values: ["yes", "no", "yes"], correct: 3 },
    { values: ["yes", "no", "no"], correct: 2 },
    { values: ["yes", "yes", "no"], correct: 1 },
    { values: ["no", "yes", "no"], correct: 0 },
    { values: ["yes", null, null], correct: 1 },
    { values: [null, null, null], correct: 0 },
  ] as { values: (YesNo | null)[]; correct: number }[])("scores $correct/3 with unanswered rows as zero", ({ values, correct }) => {
    expect(evaluateQuestion(choices(values), matrixSnapshot())).toEqual({ score: correct / 3, status: correct === 3 ? "correct" : correct ? "partial" : "incorrect" });
  });
  it.each([
    { selected: ["opaque-option-1"], score: 1 },
    { selected: ["opaque-option-2"], score: 0 },
    { selected: [], score: 0 },
  ])("scores completion $selected as $score", ({ selected, score }) => {
    expect(evaluateQuestion(selected, { ...completionQuestion(), bankTitle: "Bank", certification: testBank().certification })).toEqual({ score, status: score ? "correct" : "incorrect" });
  });
  it("replaces a matrix row selection without ambiguity in punctuation-containing IDs", () => {
    const id = matrixQuestion().statements[0].id;
    const selected = withMatrixAnswer(choices(["yes", "no", null]), id, "no");
    expect(selected).toHaveLength(2);
    expect(matrixSelection(selected, id)).toBe("no");
    expect(matrixSelection(selected, "s2")).toBe("no");
    expect(isFullyAnswered({ question: matrixSnapshot(), selectedAnswers: selected })).toBe(false);
  });
});

describe("V2 simulation lifecycle", () => {
  it.each(["training", "exam"] as const)("supports mixed V1/V2 banks in %s without rewriting old banks", async (mode) => {
    const db = await setup(); await importQuestionBank(db, testBank());
    const before = await db.getRepository(QuestionBankVersionEntity).findOneByOrFail({ bank_id: testBank().id, version: 1 });
    const id = await createSimulation(db, { mode, questionCount: 6 }, identity);
    for (const item of (await getSimulation(db, id))!.questions) {
      await saveAnswers(db, id, item.position, correctAnswerIds(item.question));
      if (mode === "training") expect((await confirmTrainingAnswer(db, id, item.position)).score).toBe(1);
    }
    await submitSimulation(db, id);
    expect(simulationStatistics((await getSimulation(db, id))!).percent).toBe(100);
    expect(await db.getRepository(QuestionBankVersionEntity).findOneByOrFail({ bank_id: testBank().id, version: 1 })).toEqual(before);
  });
  it("requires three rows for training confirmation, evaluates together, and locks feedback", async () => {
    const db = await setup(); const id = await createSimulation(db, { mode: "training", questionCount: 2 }, identity);
    await saveAnswers(db, id, 0, choices(["yes", null, null]));
    expect((await getSimulation(db, id))!.questions[0]).toMatchObject({ evaluation: null, locked: false });
    await expect(confirmTrainingAnswer(db, id, 0)).rejects.toThrow(/each statement/);
    await saveAnswers(db, id, 0, choices(["yes", "no", "no"]));
    expect(await confirmTrainingAnswer(db, id, 0)).toEqual({ status: "partial", score: 2 / 3 });
    await expect(saveAnswers(db, id, 0, choices(["yes", "no", "yes"]))).rejects.toThrow(/locked/);
    await saveAnswers(db, id, 1, ["opaque-option-2"]);
    expect(await confirmTrainingAnswer(db, id, 1)).toEqual({ status: "incorrect", score: 0 });
    await expect(saveAnswers(db, id, 1, ["opaque-option-1"])).rejects.toThrow(/locked/);
  });
  it("allows exam edits, navigation and incomplete matrix submission with fractional statistics", async () => {
    const db = await setup(); const id = await createSimulation(db, { mode: "exam", questionCount: 2 }, identity);
    await saveAnswers(db, id, 0, choices(["no", null, null]));
    await saveAnswers(db, id, 0, choices(["yes", "no", null]));
    await setCurrentPosition(db, id, 1);
    expect((await getSimulation(db, id))!.questions[0]).toMatchObject({ evaluation: null, correct: null, locked: false });
    await saveAnswers(db, id, 1, ["opaque-option-2"]); await saveAnswers(db, id, 1, ["opaque-option-1"]);
    await submitSimulation(db, id);
    const stats = simulationStatistics((await getSimulation(db, id))!);
    expect(stats.credit).toBeCloseTo(1 + 2 / 3); expect(stats.percent).toBeCloseTo((1 + 2 / 3) / 2 * 100);
    for (const field of ["byDomain", "byTopic"] as const) {
      expect(stats[field].find((group) => group.name.startsWith("Matrix"))!.credit).toBe(2 / 3);
      const progress = await progressOverview(db);
      expect(progress[field].find((group) => group.name.startsWith("Matrix"))!.percent).toBeCloseTo(200 / 3);
    }
    expect((await listSimulations(db))[0].scorePercent).toBeCloseTo(stats.percent);
    expect((await progressOverview(db)).average).toBeCloseTo(stats.percent);
  });
  it.each(["training", "exam"] as const)("rejects conflicting/unknown rows and multiple completions in %s without losing answers", async (mode) => {
    const db = await setup(); const id = await createSimulation(db, { mode, questionCount: 2 }, identity);
    const selected = choices(["yes", null, null]); await saveAnswers(db, id, 0, selected);
    await expect(saveAnswers(db, id, 0, [...selected, ...choices(["no", null, null])])).rejects.toThrow(/one answer per statement/);
    await expect(saveAnswers(db, id, 0, [matrixAnswerId("unknown", "yes")])).rejects.toThrow(/invalid/);
    await expect(saveAnswers(db, id, 1, ["opaque-option-1", "opaque-option-2"])).rejects.toThrow(/only one/);
    expect((await getSimulation(db, id))!.questions[0].selectedAnswers).toEqual(selected);
  });
  it.each(["training", "exam"] as const)("persists shuffled completions and partial matrix answers across restart in %s", async (mode) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "certforge-v2-")); directories.push(dir);
    const file = path.join(dir, "resume.db"); const db = await setup(file);
    const id = await createSimulation(db, { mode, questionCount: 2 }, rotate);
    const initial = (await getSimulation(db, id))!;
    const m = initial.questions.find((item) => item.question.type === "yes-no-matrix")!.position;
    const c = initial.questions.find((item) => item.question.type === "statement-completion")!.position;
    const options = initial.questions[c].question.answers;
    expect(options).not.toEqual(completionQuestion().answers);
    expect(new Set(options.map((option) => option.id))).toEqual(new Set(completionQuestion().answers.map((option) => option.id)));
    await saveAnswers(db, id, m, choices(["yes", null, null])); await saveAnswers(db, id, c, ["opaque-option-1"]);
    await setCurrentPosition(db, id, m);
    const before = await getSimulation(db, id); await db.destroy();
    const reopened = await initializeDatabase(createDataSource(file)); databases.push(reopened);
    expect(await getSimulation(reopened, id)).toEqual(before);
    await setCurrentPosition(reopened, id, c);
    expect((await getSimulation(reopened, id))!.questions[c].question.answers).toEqual(options);
  });
  it.each(["training", "exam"] as const)("retries historical V2 snapshots in %s after bank updates", async (mode) => {
    const db = await setup(); const id = await createSimulation(db, { mode, questionCount: 2 }, identity);
    await saveAnswers(db, id, 0, choices(["yes", "no", "no"])); await saveAnswers(db, id, 1, ["opaque-option-1"]);
    if (mode === "training") { await confirmTrainingAnswer(db, id, 0); await confirmTrainingAnswer(db, id, 1); }
    await submitSimulation(db, id);
    const before = await getSimulation(db, id);
    const rows = await db.getRepository(SimulationQuestionEntity).findBy({ simulation_id: id });
    expect((await importQuestionBank(db, v2Bank(2, " UPDATED"))).status).toBe("updated");
    const retryId = await retrySimulation(db, id, rotate); const retry = (await getSimulation(db, retryId))!;
    expect(retry.retriedFromSimulationId).toBe(id);
    for (const item of retry.questions) {
      const previous = before!.questions.find((q) => q.question.id === item.question.id)!;
      expect(item).toMatchObject({ selectedAnswers: [], locked: false, evaluation: null, correct: null });
      expect(item.question.question).toBe(previous.question.question);
      expect(item.question.statements).toEqual(previous.question.statements);
      expect(item.question.correctAnswers).toEqual(previous.question.correctAnswers);
      if (item.question.type === "statement-completion") {
        expect(item.question.answers).not.toEqual(previous.question.answers);
        expect([...item.question.answers].sort((a,b) => a.id.localeCompare(b.id))).toEqual(previous.question.answers);
      }
    }
    expect(await getSimulation(db, id)).toEqual(before);
    expect(await db.getRepository(SimulationQuestionEntity).findBy({ simulation_id: id })).toEqual(rows);
    const fresh = (await getSimulation(db, await createSimulation(db, { mode, questionCount: 2 }, identity)))!;
    expect(fresh.questions.every((q) => q.question.question.endsWith(" UPDATED"))).toBe(true);
    expect(await db.query("PRAGMA foreign_key_check")).toEqual([]);
  });
});
