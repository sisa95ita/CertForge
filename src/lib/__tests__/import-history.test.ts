import { QuestionBankVersionEntity } from "../persistence/entities";
import { describe, expect, it } from "vitest";
import { createTestDb } from "./test-db";
import { importQuestionBank } from "../import-service";
import { createSimulation, getSimulation } from "../simulation-service";
function bank(version: number, text = "Original question") {
    return {
        id: "98f03ec4-7b58-45db-a1ac-f30d072433c4", schemaVersion: 1 as const, version, title: "Versioned bank", description: "Test versioning",
        certification: { name: "Test", code: "T-1" },
        questions: [{ id: "q1", domain: "D", topic: "T", difficulty: "easy", type: "single-choice" as const, question: text, answers: [{ id: "a", text: "Right" }, { id: "b", text: "Wrong" }], correctAnswers: ["a"], explanation: `Explanation for ${text}` }],
    };
}
describe("imports and historical integrity", () => {
    it("detects duplicate and older bank versions, then updates to a newer version", async () => {
        const db = (await createTestDb());
        expect((await importQuestionBank(db, bank(1))).status).toBe("imported");
        expect((await importQuestionBank(db, bank(1))).status).toBe("skipped");
        const updated = (await importQuestionBank(db, bank(2, "Updated question")));
        expect(updated.status).toBe("updated");
        const older = (await importQuestionBank(db, bank(1)));
        expect(older.status).toBe("skipped");
        if (older.status === "skipped")
            expect(older.reason).toBe("newer-installed");
        expect(await db.getRepository(QuestionBankVersionEntity).count()).toBe(2);
        await db.destroy();
    });
    it("keeps simulation content unchanged after a bank update", async () => {
        const db = (await createTestDb());
        (await importQuestionBank(db, bank(1)));
        const id = (await createSimulation(db, { mode: "training", questionCount: 1, bankIds: [] }));
        expect((await getSimulation(db, id))?.questions[0].question.question).toBe("Original question");
        (await importQuestionBank(db, bank(2, "Updated question")));
        const historical = (await getSimulation(db, id));
        expect(historical?.questions[0].question.question).toBe("Original question");
        expect(historical?.questions[0].question.explanation).toContain("Original question");
        await db.destroy();
    });
});
