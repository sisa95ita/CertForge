import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { getDataSource } from "../db";
import { createDataSource, initializeDatabase } from "../persistence/data-source";
import { QuestionBankEntity, QuestionBankVersionEntity, QuestionEntity, QuestionOptionEntity, SimulationEntity, SimulationQuestionEntity, SimulationAnswerEntity } from "../persistence/entities";
import { createTestDb } from "./test-db";
import { testBank } from "./fixtures";
import { importQuestionBank } from "../import-service";
import { createSimulation, getSimulation, getCatalog, saveAnswers, setCurrentPosition, setReviewFlag, submitSimulation } from "../simulation-service";

const databases: DataSource[] = [];
const directories: string[] = [];
const state = globalThis as typeof globalThis & { certForgeDataSourcePromise?: Promise<DataSource> };
afterEach(async () => {
  await Promise.all(databases.splice(0).filter((db) => db.isInitialized).map((db) => db.destroy()));
  directories.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  state.certForgeDataSourcePromise = undefined; vi.unstubAllEnvs();
});
function filename() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "certforge-persistence-")); directories.push(dir);
  return path.join(dir, "nested", "certforge.db");
}
async function testDb() { const db = await createTestDb(); databases.push(db); return db; }
async function bankRows(db: DataSource) {
  return Promise.all([db.getRepository(QuestionBankEntity).find(), db.getRepository(QuestionBankVersionEntity).find(), db.getRepository(QuestionEntity).find(), db.getRepository(QuestionOptionEntity).find()]);
}

describe("CertForge persistence", () => {
  it("loads only the current bank version and keeps the catalog shape and facets", async () => {
    const db = await testDb();
    expect(await getCatalog(db)).toEqual({ banks: [], facets: [], inventory: [] });
    await importQuestionBank(db, testBank()); await importQuestionBank(db, testBank(2, " UPDATED"));
    const catalog = await getCatalog(db);
    expect(catalog.banks).toEqual([{ id: testBank().id, title: "Bank UPDATED", certificationName: "Generic certification", certificationCode: "TEST", version: 2, questionCount: 4 }]);
    expect(catalog.facets).toEqual([{ certificationName: "Generic certification", certificationCode: "TEST", domain: "D1", topic: "T1" }, { certificationName: "Generic certification", certificationCode: "TEST", domain: "D2", topic: "T2" }]);
    expect(catalog.inventory).toHaveLength(4);
    expect(await db.getRepository(QuestionEntity).count()).toBe(8);
  });

  it.each([false, true])("rolls back every row after an import failure (updating=%s)", async (updating) => {
    const db = await testDb();
    if (updating) await importQuestionBank(db, testBank());
    const before = await bankRows(db);
    // A real SQLite error after earlier bank, version, question and option inserts.
    await db.query(`CREATE TRIGGER reject_import BEFORE INSERT ON question_options WHEN NEW.question_id = 'q2' BEGIN SELECT RAISE(ABORT, 'injected import failure'); END`);
    expect(await importQuestionBank(db, testBank(updating ? 2 : 1))).toEqual({ status: "failed", title: "Bank", errors: ["Database import failed"] });
    expect(await bankRows(db)).toEqual(before);
    await db.query("DROP TRIGGER reject_import");
    expect((await importQuestionBank(db, testBank(updating ? 2 : 1))).status).toBe(updating ? "updated" : "imported");
  });

  it("rejects invalid duplicate identities before writing", async () => {
    const db = await testDb(); const invalid = testBank(); invalid.questions.push(invalid.questions[0]);
    expect((await importQuestionBank(db, invalid)).status).toBe("failed");
    expect(await db.getRepository(QuestionBankEntity).count()).toBe(0);
  });

  it("serializes concurrent imports and simulations on the shared SQLite connection", async () => {
    const db = await testDb();
    const results = await Promise.all([importQuestionBank(db, testBank()), importQuestionBank(db, testBank()), importQuestionBank(db, testBank(2))]);
    expect(results.map((r) => r.status)).toEqual(["imported", "skipped", "updated"]);
    const ids = await Promise.all(Array.from({ length: 6 }, () => createSimulation(db, { mode: "training", questionCount: 4 })));
    expect(new Set(ids).size).toBe(6);
    expect(await db.getRepository(SimulationQuestionEntity).count()).toBe(24);
    await Promise.all(ids.map((id) => saveAnswers(db, id, 0, ["a"])));
    const views = await Promise.all(ids.map((id) => getSimulation(db, id)));
    expect(views.every((v) => v!.questions[0].selectedAnswers[0] === "a")).toBe(true);
  });

  it("resumes an exam from a reopened database with the same snapshots, timing, flags and answers", async () => {
    const file = filename(); const db = await initializeDatabase(createDataSource(file)); databases.push(db);
    await importQuestionBank(db, testBank());
    const id = await createSimulation(db, { mode: "exam", questionCount: 4, durationMinutes: 30 }, () => 0);
    await saveAnswers(db, id, 0, ["a"]); await setCurrentPosition(db, id, 2); await setReviewFlag(db, id, 0, true);
    const before = await getSimulation(db, id); await db.destroy();
    const reopened = await initializeDatabase(createDataSource(file)); databases.push(reopened);
    expect(await getSimulation(reopened, id)).toEqual(before);
    await submitSimulation(reopened, id);
    expect((await getSimulation(reopened, id))!.questions.map((q) => q.question)).toEqual(before!.questions.map((q) => q.question));
  });

  it("preserves foreign key enforcement and deletion cascades", async () => {
    const db = await testDb(); await importQuestionBank(db, testBank());
    const id = await createSimulation(db, { mode: "training", questionCount: 1 }); await saveAnswers(db, id, 0, ["a"]);
    await expect(db.getRepository(SimulationAnswerEntity).insert({ simulation_id: "missing", position: 0, option_id: "a", selected_at: new Date().toISOString() })).rejects.toThrow();
    await db.getRepository(SimulationEntity).delete({ id });
    expect(await db.getRepository(SimulationQuestionEntity).count()).toBe(0);
    expect(await db.getRepository(SimulationAnswerEntity).count()).toBe(0);
    expect(await db.getRepository(QuestionEntity).count()).toBe(4);
  });

  it("shares one initialization promise across concurrent callers and hot reload", async () => {
    vi.stubEnv("CERTFORGE_DB_PATH", filename());
    const first = getDataSource(); const second = getDataSource();
    expect(first).toBe(second);
    const db = await first; databases.push(db);
    expect(await getDataSource()).toBe(db);
    vi.resetModules(); const reloaded = await import("../db");
    expect(await reloaded.getDataSource()).toBe(db);
    expect(await db.runMigrations()).toEqual([]);
  });

  it("allows initialization to recover after a migration failure", async () => {
    const file = filename(); fs.mkdirSync(path.dirname(file), { recursive: true });
    const Database = (await import("better-sqlite3")).default;
    const raw = new Database(file); raw.pragma("user_version = 3"); raw.close();
    vi.stubEnv("CERTFORGE_DB_PATH", file);
    await expect(getDataSource()).rejects.toThrow(/newer/);
    const repaired = new Database(file); repaired.pragma("user_version = 0"); repaired.close();
    const db = await getDataSource(); databases.push(db);
    expect(await getCatalog(db)).toEqual({ banks: [], facets: [], inventory: [] });
  });
});
