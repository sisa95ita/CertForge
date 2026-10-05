import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DataSource } from "typeorm";
import { createTestDb } from "./test-db";
import { createDataSource, initializeDatabase } from "../persistence/data-source";
import { Baseline1791158400000 } from "../persistence/migrations/1791158400000-Baseline";
import { createLegacyDatabase } from "./legacy-db";
import { getCatalog, getSimulation, retrySimulation, saveAnswers, submitSimulation } from "../simulation-service";
import { listSimulations, progressOverview } from "../history-service";
import { simulationStatistics } from "../statistics";

const databases: DataSource[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).filter((db) => db.isInitialized).map((db) => db.destroy()));
  directories.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});
function filename() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "certforge-migration-")); directories.push(dir);
  return path.join(dir, "legacy.db");
}
const tables = ["question_banks", "question_bank_versions", "questions", "question_options", "simulations", "simulation_questions", "simulation_answers"];

describe("TypeORM migrations", () => {
  it("retains the migration identity when the production bundler renames its class", async () => {
    class M extends Baseline1791158400000 {}
    const source = createDataSource(":memory:").setOptions({ migrations: [M] });
    const db = await initializeDatabase(source); databases.push(db);
    expect(await db.query("SELECT name FROM migrations")).toEqual([{ name: "Baseline1791158400000" }]);
    expect(await db.runMigrations()).toEqual([]);
  });

  it("creates the complete fresh schema with the real migrations and is idempotent", async () => {
    const db = await createTestDb(); databases.push(db);
    expect(db.options).toMatchObject({ type: "better-sqlite3", synchronize: false, enableWAL: true });
    const actual = await db.query("SELECT name FROM sqlite_master WHERE type = 'table'") as { name: string }[];
    expect(actual.map((t) => t.name)).toEqual(expect.arrayContaining([...tables, "migrations"]));
    expect(await db.runMigrations()).toEqual([]);
    expect(await db.query("PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
    const indexes = await db.query("SELECT name FROM sqlite_master WHERE type = 'index'") as { name: string }[];
    expect(indexes.map((i) => i.name)).toEqual(expect.arrayContaining(["idx_questions_domain", "idx_questions_topic", "idx_simulations_status"]));
  });

  it.each([1, 2] as const)("adopts populated pre-TypeORM V%s without recreating tables or changing historical data", async (version) => {
    const file = filename();
    const legacy = createLegacyDatabase(file, version);
    const before = Object.fromEntries(tables.map((table) => [table, legacy.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
    const roots = legacy.prepare("SELECT name, rootpage FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    legacy.close();
    const db = await initializeDatabase(createDataSource(file)); databases.push(db);
    for (const table of tables) {
      const rows = await db.query(`SELECT * FROM ${table} ORDER BY rowid`);
      const comparable = version === 1 ? rows.map((row: Record<string, unknown>) => {
        const copy = { ...row }; delete copy.score_contribution; delete copy.retried_from_simulation_id; return copy;
      }) : rows;
      expect(comparable).toEqual(before[table]);
    }
    const afterRoots = await db.query("SELECT name, rootpage FROM sqlite_master WHERE type = 'table' AND name != 'migrations' AND name != 'sqlite_sequence' ORDER BY name");
    expect(afterRoots).toEqual(roots);
    expect(await db.query("PRAGMA user_version")).toEqual([{ user_version: version }]);
    expect(await db.query("PRAGMA journal_mode")).toEqual([{ journal_mode: "wal" }]);
    expect(await db.runMigrations()).toEqual([]);
    const catalog = await getCatalog(db);
    expect(catalog.banks[0]).toMatchObject({ version: 2, questionCount: 4 });
    const historical = (await getSimulation(db, "complete-exam"))!;
    expect(historical.questions[0].question.question).not.toContain("UPDATED");
    expect(historical.questions[0].evaluation).toEqual(version === 1 ? { status: "incorrect", score: 0 } : { status: "partial", score: 0.5 });
    expect(simulationStatistics(historical).percent).toBe(version === 1 ? 0 : 50);
    expect((await listSimulations(db)).find((s) => s.id === "complete-exam")?.scorePercent).toBe(version === 1 ? 0 : 50);
    expect((await progressOverview(db)).average).toBe(version === 1 ? 50 : 75);
    for (const id of ["active-training", "active-exam"]) {
      expect((await getSimulation(db, id))!.questions[0]).toMatchObject({ selectedAnswers: ["a", "b"], locked: false, correct: null, evaluation: null });
    }
    if (version === 2) expect(await getSimulation(db, "retry")).toMatchObject({ retriedFromSimulationId: "complete-exam" });
    const retryId = await retrySimulation(db, "complete-exam", () => 0);
    await saveAnswers(db, retryId, 0, ["a", "b"]); await submitSimulation(db, retryId);
    expect((await getSimulation(db, retryId))!.questions[0].evaluation).toEqual({ status: "partial", score: 0.5 });
    expect(await getSimulation(db, "complete-exam")).toEqual(historical);
    expect(await db.query("PRAGMA foreign_key_check")).toEqual([]);
    expect(await db.query("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
  });

  it("rejects a newer legacy schema without touching its data", async () => {
    const file = filename(); const legacy = createLegacyDatabase(file, 2);
    legacy.pragma("user_version = 3"); const banks = legacy.prepare("SELECT * FROM question_banks").all(); legacy.close();
    const source = createDataSource(file);
    await expect(initializeDatabase(source)).rejects.toThrow(/newer/);
    expect(source.isInitialized).toBe(false);
    const Database = (await import("better-sqlite3")).default; const raw = new Database(file);
    try { expect(raw.prepare("SELECT * FROM question_banks").all()).toEqual(banks); expect(raw.pragma("user_version", { simple: true })).toBe(3); }
    finally { raw.close(); }
  });
});
