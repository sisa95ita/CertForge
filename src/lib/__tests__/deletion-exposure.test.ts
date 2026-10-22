import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CertForgeDatabase } from "../db";
import * as database from "../db";
import { createTestDb } from "./test-db";
import { testBank } from "./fixtures";
import { v2Bank } from "./v2-fixtures";
import { importQuestionBank } from "../import-service";
import { deleteQuestionBank, deleteSimulation } from "../deletion-service";
import { listSimulations, progressOverview } from "../history-service";
import { confirmSimulation, createSimulation, getCatalog, getQuestionExposures, getSimulation, previewSimulation, RepetitionConfirmationRequiredError, retrySimulation, saveAnswers, setReviewFlag, submitSimulation } from "../simulation-service";
import { QuestionBankEntity, QuestionBankVersionEntity, QuestionEntity, QuestionOptionEntity, SimulationAnswerEntity, SimulationEntity, SimulationQuestionEntity } from "../persistence/entities";
import { logicalQuestionKey, QUESTION_REPEAT_THRESHOLD } from "../selection";
import { POST } from "@/app/api/simulations/route";
import { DELETE as deleteBankRoute } from "@/app/api/catalog/[id]/route";
import { DELETE as deleteSimulationRoute } from "@/app/api/simulations/[id]/route";

let db: CertForgeDatabase;
const random = () => 0.999;
const input = { mode: "training", questionCount: 4 };
beforeEach(async () => { db = await createTestDb(); await importQuestionBank(db, testBank()); vi.spyOn(database, "getDataSource").mockResolvedValue(db); });
afterEach(async () => { vi.restoreAllMocks(); await db.destroy(); });
const view = async (id: string) => (await getSimulation(db, id))!;
const exposures = () => getQuestionExposures(db);
const count = async (questionId = "q1") => (await exposures()).get(logicalQuestionKey({ bankId: testBank().id, questionId })) ?? 0;
async function repeatAll() {
  for (let index = 0; index < QUESTION_REPEAT_THRESHOLD; index++) await createSimulation(db, input, random);
}
const planIds = (token: string) => (JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString()) as { questions: { questionId: string }[] }).questions.map((q) => q.questionId);
const post = (body: unknown) => POST(new Request("http://localhost/api/simulations", { method: "POST", body: JSON.stringify(body) }));

describe("catalog deletion and historical ownership", () => {
  it("removes all catalog versions/options, preserves completed and active snapshots/answers, and permits reimport", async () => {
    const complete = await createSimulation(db, input, random);
    await saveAnswers(db, complete, 0, ["a"]); await submitSimulation(db, complete);
    const active = await createSimulation(db, { ...input, mode: "exam", durationMinutes: 60 }, random);
    await saveAnswers(db, active, 0, ["a"]); await setReviewFlag(db, active, 0, true);
    const before = [await view(complete), await view(active)];
    const snapshots = await db.getRepository(SimulationQuestionEntity).find();
    await importQuestionBank(db, testBank(2, " UPDATED"));
    const response = await deleteBankRoute(new Request("http://localhost"), { params: Promise.resolve({ id: testBank().id }) });
    expect(response.status).toBe(204);
    for (const repository of [db.getRepository(QuestionBankEntity), db.getRepository(QuestionBankVersionEntity), db.getRepository(QuestionEntity), db.getRepository(QuestionOptionEntity)]) expect(await repository.count()).toBe(0);
    expect(await getCatalog(db)).toEqual({ banks: [], facets: [], inventory: [] });
    expect([await view(complete), await view(active)]).toEqual(before);
    expect(await db.getRepository(SimulationQuestionEntity).find()).toEqual(snapshots);
    await expect(createSimulation(db, input)).rejects.toThrow(/0 questions/);
    const retry = await retrySimulation(db, complete, random);
    expect((await view(retry)).questions.map((q) => q.question)).toEqual(before[0].questions.map((q) => q.question));
    expect(await count()).toBe(3);
    expect((await importQuestionBank(db, testBank())).status).toBe("imported");
    expect((await getCatalog(db)).banks).toHaveLength(1);
    expect(await count()).toBe(3);
    const preview = await previewSimulation(db, input, random);
    expect(preview.repeatedCount).toBe(4);
    expect(await db.query("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("retains V2 matrix and completion snapshots and retry after catalog deletion", async () => {
    const bank = v2Bank(); await importQuestionBank(db, bank);
    const id = await createSimulation(db, { ...input, bankIds: [bank.id], questionCount: 2 }, random);
    await submitSimulation(db, id);
    const before = await view(id);
    await deleteQuestionBank(db, bank.id);
    const retry = await view(await retrySimulation(db, id, random));
    expect(retry.questions.map((q) => q.question)).toEqual(before.questions.map((q) => q.question));
  });

  it("rolls back catalog deletions when a child deletion fails", async () => {
    await db.query("CREATE TRIGGER reject_delete BEFORE DELETE ON questions BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
    await expect(deleteQuestionBank(db, testBank().id)).rejects.toThrow("injected failure");
    expect(await db.getRepository(QuestionOptionEntity).count()).toBe(16);
    expect((await getCatalog(db)).banks).toHaveLength(1);
  });
});

describe("completed simulation deletion", () => {
  it("removes owned answers/snapshots/flags, updates progress, reduces exposure and preserves retry descendants and catalog", async () => {
    const parent = await createSimulation(db, { ...input, mode: "exam", durationMinutes: 60 }, random);
    await saveAnswers(db, parent, 0, ["a"]); await setReviewFlag(db, parent, 0, true);
    await submitSimulation(db, parent);
    const retry = await retrySimulation(db, parent, random);
    const before = await view(retry);
    const catalog = await getCatalog(db);
    expect(await count()).toBe(2);
    const response = await deleteSimulationRoute(new Request("http://localhost"), { params: Promise.resolve({ id: parent }) });
    expect(response.status).toBe(204);
    expect(await getSimulation(db, parent)).toBeNull();
    expect(await db.getRepository(SimulationQuestionEntity).countBy({ simulation_id: parent })).toBe(0);
    expect(await db.getRepository(SimulationAnswerEntity).countBy({ simulation_id: parent })).toBe(0);
    expect((await listSimulations(db)).map((s) => s.id)).toEqual([retry]);
    expect(await progressOverview(db)).toMatchObject({ completed: 0, average: 0, byDomain: [], byTopic: [] });
    expect(await getCatalog(db)).toEqual(catalog);
    expect(await view(retry)).toEqual({ ...before, retriedFromSimulationId: null });
    expect(await count()).toBe(1);
    await saveAnswers(db, retry, 0, ["a"]); await submitSimulation(db, retry);
    expect((await view(await retrySimulation(db, retry, random))).questions).toHaveLength(4);
    expect(await db.query("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("rejects active and missing attempts without deleting data", async () => {
    const id = await createSimulation(db, input);
    await expect(deleteSimulation(db, id)).rejects.toThrow("deleteCompletedOnly");
    await expect(deleteSimulation(db, "missing")).rejects.toThrow("not found");
    expect(await count()).toBe(1);
    expect(await view(id)).toMatchObject({ status: "in-progress" });
    expect((await deleteBankRoute(new Request("http://localhost"), { params: Promise.resolve({ id: "missing" }) })).status).toBe(404);
    expect((await deleteSimulationRoute(new Request("http://localhost"), { params: Promise.resolve({ id }) })).status).toBe(400);
  });
});

describe("exposure and exact selection preview", () => {
  it("counts newly created active sets, selects unseen questions next, and follows external IDs across versions", async () => {
    const filtered = { ...input, questionCount: 1, domain: "D1", topic: "T1" };
    const first = await view(await createSimulation(db, filtered, random));
    expect(await count(first.questions[0].question.id)).toBe(1);
    const second = await view(await createSimulation(db, filtered, random));
    expect(second.questions[0].question.id).not.toBe(first.questions[0].question.id);
    expect(await count()).toBe(1);
    await importQuestionBank(db, testBank(2, " UPDATED"));
    expect(await count()).toBe(1);
    const next = await view(await createSimulation(db, filtered, random));
    expect(next.questions[0].question.question).toContain("UPDATED");
    expect(await count(next.questions[0].question.id)).toBe(2);
    const unrelated = testBank(); unrelated.id = "c45306e8-e829-4c25-92f2-956454b548c1"; await importQuestionBank(db, unrelated);
    expect((await exposures()).get(logicalQuestionKey({ bankId: unrelated.id, questionId: "q1" }))).toBeUndefined();
  });

  it("all-available warns with the exact repeated count and canceled previews write nothing", async () => {
    await repeatAll();
    const before = await exposures();
    const rows = await db.getRepository(SimulationEntity).count();
    const questions = await db.getRepository(SimulationQuestionEntity).count();
    await expect(createSimulation(db, input, random)).rejects.toBeInstanceOf(RepetitionConfirmationRequiredError);
    const response = await post(input);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty("id");
    expect(body.preview).toMatchObject({ repeatedCount: 4, totalCount: 4, threshold: 3 });
    expect(await db.getRepository(SimulationEntity).count()).toBe(rows);
    expect(await db.getRepository(SimulationQuestionEntity).count()).toBe(questions);
    expect(await exposures()).toEqual(before);
  });

  it("accepts the exact preview order even when exposures change, and then counts the new attempt", async () => {
    await repeatAll();
    const preview = await previewSimulation(db, { ...input, questionCount: 2 }, () => 0.2);
    const ids = planIds(preview.token);
    const previous = (await listSimulations(db))[0].id;
    await submitSimulation(db, previous); await retrySimulation(db, previous, random);
    const response = await post({ selectionToken: preview.token });
    expect(response.status).toBe(201);
    const id = (await response.json()).id;
    expect((await view(id)).questions.map((q) => q.question.id)).toEqual(ids);
    expect(await count(ids[0])).toBe(5);
  });

  it.each(["delete", "update", "tamper"] as const)("rejects a %s-invalidated plan atomically", async (action) => {
    const preview = await previewSimulation(db, input, random);
    let token = preview.token;
    if (action === "delete") await deleteQuestionBank(db, testBank().id);
    if (action === "update") await importQuestionBank(db, testBank(2));
    if (action === "tamper") token = "x" + token;
    await expect(confirmSimulation(db, token)).rejects.toThrow("selectionExpired");
    expect(await db.getRepository(SimulationEntity).count()).toBe(0);
    expect(await exposures()).toEqual(new Map());
  });

  it("rejects a preview if deleted content is reimported under the same UUID/version", async () => {
    const preview = await previewSimulation(db, input);
    await deleteQuestionBank(db, testBank().id);
    await importQuestionBank(db, testBank(1, " CHANGED"));
    await expect(confirmSimulation(db, preview.token)).rejects.toThrow("selectionExpired");
  });

  it("retries historical sets despite heavy repetition and counts every new retry", async () => {
    const original = await createSimulation(db, input, random); await submitSimulation(db, original);
    for (let index = 0; index < 4; index++) {
      const retry = await view(await retrySimulation(db, original, random));
      expect(retry.questions.map((q) => q.question.id)).toEqual((await view(original)).questions.map((q) => q.question.id));
    }
    expect(await count()).toBe(5);
  });

  it("uses a single grouped exposure query rather than one per eligible question", async () => {
    await createSimulation(db, input);
    const spy = vi.spyOn(db.logger, "logQuery");
    await previewSimulation(db, input);
    const grouped = spy.mock.calls.filter(([query]) => query.includes("COUNT(DISTINCT") && query.includes("simulation_questions"));
    expect(grouped).toHaveLength(1);
  });
});

describe("warning edge cases and transaction rollback", () => {
  it("reports only unavoidable repeated questions and respects selected-bank/topic filters", async () => {
    const original = await createSimulation(db, { ...input, questionCount: 1, domain: "D1", topic: "T1" }, random);
    await submitSimulation(db, original);
    await retrySimulation(db, original, random); await retrySimulation(db, original, random);
    const repeatedId = (await view(original)).questions[0].question.id;
    expect(await count(repeatedId)).toBe(3);
    const all = await previewSimulation(db, input, random);
    expect(all).toMatchObject({ repeatedCount: 1, totalCount: 4 });
    const custom = await previewSimulation(db, { ...input, questionCount: 1, domain: "D1", topic: "T1" }, random);
    expect(custom.repeatedCount).toBe(0);
    expect(planIds(custom.token)).not.toContain(repeatedId);
    const extra = testBank(); extra.id = "c45306e8-e829-4c25-92f2-956454b548c1";
    await importQuestionBank(db, extra);
    const selectedBank = await previewSimulation(db, { ...input, bankIds: [testBank().id], domain: "D1", topic: "T1", questionCount: 2 }, random);
    expect(selectedBank).toMatchObject({ repeatedCount: 1, totalCount: 2 });
  });

  it("rolls back confirmed creation if a snapshot insert fails", async () => {
    const preview = await previewSimulation(db, input, random);
    await db.query("CREATE TRIGGER reject_snapshot BEFORE INSERT ON simulation_questions WHEN NEW.position = 1 BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
    await expect(confirmSimulation(db, preview.token)).rejects.toThrow("injected failure");
    expect(await db.getRepository(SimulationEntity).count()).toBe(0);
    expect(await db.getRepository(SimulationQuestionEntity).count()).toBe(0);
    expect(await exposures()).toEqual(new Map());
  });

  it("rolls back deletion and retry unlinking if a cascading child deletion fails", async () => {
    const original = await createSimulation(db, input, random);
    await saveAnswers(db, original, 0, ["a"]); await submitSimulation(db, original);
    const retry = await retrySimulation(db, original, random);
    const before = [await view(original), await view(retry)];
    await db.query("CREATE TRIGGER reject_answer_delete BEFORE DELETE ON simulation_answers BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
    await expect(deleteSimulation(db, original)).rejects.toThrow("injected failure");
    expect([await view(original), await view(retry)]).toEqual(before);
    expect(await count()).toBe(2);
  });

  it("rejects expired previews without persisting anything", async () => {
    const preview = await previewSimulation(db, input, random);
    const current = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(current + 31 * 60 * 1000);
    await expect(confirmSimulation(db, preview.token)).rejects.toThrow("selectionExpired");
    expect(await db.getRepository(SimulationEntity).count()).toBe(0);
  });
});
