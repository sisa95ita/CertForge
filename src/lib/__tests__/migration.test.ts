import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, migrateDatabase } from "../db";
import { importQuestionBank } from "../import-service";
import { createSimulation, getSimulation, retrySimulation, saveAnswers, submitSimulation } from "../simulation-service";
import { listSimulations, progressOverview } from "../history-service";
import { simulationStatistics } from "../statistics";
import { testBank } from "./fixtures";
const databases: ReturnType<typeof createTestDb>[] = [];
afterEach(() => { databases.splice(0).forEach((db) => db.close()); });
function legacy(db: ReturnType<typeof createTestDb>) {
  db.exec("ALTER TABLE simulation_questions DROP COLUMN score_contribution; ALTER TABLE simulations DROP COLUMN retried_from_simulation_id;");
  db.pragma("user_version = 1");
}
describe("SQLite migration", () => {
  it("preserves populated V1 banks, history, snapshots and binary scores; retries use fractional scores", () => {
    const db = createTestDb(); databases.push(db); importQuestionBank(db, testBank());
    const id = createSimulation(db, { mode: "exam", questionCount: 4 }, () => 0.999);
    const p = getSimulation(db, id)!.questions.find((q) => q.question.type === "multiple-choice")!.position;
    saveAnswers(db, id, p, ["a", "b"]); submitSimulation(db, id); legacy(db);
    db.prepare("UPDATE simulations SET score_percent = 0 WHERE id = ?").run(id);
    const banks = db.prepare("SELECT * FROM question_banks").all(), versions = db.prepare("SELECT * FROM question_bank_versions").all();
    const snapshots = db.prepare("SELECT snapshot_json FROM simulation_questions ORDER BY position").all();
    const answers = db.prepare("SELECT * FROM simulation_answers").all();
    migrateDatabase(db);
    expect(db.pragma("user_version", { simple: true })).toBe(2);
    expect(db.prepare("SELECT * FROM question_banks").all()).toEqual(banks);
    expect(db.prepare("SELECT * FROM question_bank_versions").all()).toEqual(versions);
    expect(db.prepare("SELECT snapshot_json FROM simulation_questions ORDER BY position").all()).toEqual(snapshots);
    expect(db.prepare("SELECT * FROM simulation_answers").all()).toEqual(answers);
    const historical = getSimulation(db, id)!;
    expect(historical.questions[p].evaluation).toEqual({ status: "incorrect", score: 0 });
    expect(simulationStatistics(historical).percent).toBe(0); expect(listSimulations(db)[0].scorePercent).toBe(0);
    expect(progressOverview(db).average).toBe(0); migrateDatabase(db); expect(getSimulation(db, id)).toEqual(historical);
    const retryId = retrySimulation(db, id, () => 0);
    const retryPos = getSimulation(db, retryId)!.questions.find((q) => q.question.type === "multiple-choice")!.position;
    saveAnswers(db, retryId, retryPos, ["a", "b"]); submitSimulation(db, retryId);
    expect(getSimulation(db, retryId)!.questions[retryPos].evaluation).toEqual({ status: "partial", score: 0.5 });
    expect(getSimulation(db, id)).toEqual(historical);
    expect(db.pragma("foreign_key_check")).toEqual([]); expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
  });
  it("preserves unevaluated active sessions", () => {
    const db = createTestDb(); databases.push(db); importQuestionBank(db, testBank());
    const id = createSimulation(db, { mode: "training", questionCount: 4 }); saveAnswers(db, id, 0, ["a"]);
    const question = getSimulation(db, id)!.questions[0].question; legacy(db); migrateDatabase(db);
    expect(getSimulation(db, id)!.questions[0]).toMatchObject({ question, selectedAnswers: ["a"], locked: false, evaluation: null });
  });
  it("rejects databases from newer builds", () => {
    const db = createTestDb(); databases.push(db); db.pragma("user_version = 3");
    expect(() => migrateDatabase(db)).toThrow(/newer/); expect(db.pragma("user_version", { simple: true })).toBe(3);
  });
});
