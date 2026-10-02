import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as database from "../db";
import { importQuestionBank } from "../import-service";
import { createSimulation, getSimulation, saveAnswers, confirmTrainingAnswer, submitSimulation } from "../simulation-service";
import { testBank } from "./fixtures";
import { NewSimulationForm } from "@/app/simulations/new/new-simulation-form";
import { SimulationRunner } from "@/app/simulations/[id]/simulation-runner";
import ResultsPage from "@/app/simulations/[id]/results/page";
import SimulationsPage from "@/app/simulations/page";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), notFound: vi.fn(), redirect: vi.fn() }));
const databases: ReturnType<typeof database.createTestDb>[] = [];
afterEach(() => { vi.restoreAllMocks(); databases.splice(0).forEach((db) => db.close()); });
function setup(mode: "training" | "exam") {
  const db = database.createTestDb(); databases.push(db); importQuestionBank(db, testBank());
  vi.spyOn(database, "getDb").mockReturnValue(db);
  const id = createSimulation(db, { mode, questionCount: 4 }, () => 0.999);
  const p = getSimulation(db, id)!.questions.find((q) => q.question.type === "multiple-choice")!.position;
  return { db, id, p };
}
describe("simulation UI", () => {
  it("offers all and custom counts, disables starting with an empty pool", () => {
    const catalog = { banks: [{ id: "bank", title: "Bank", certificationName: "Test", certificationCode: "TEST", version: 1, questionCount: 4 }], facets: [], inventory: Array.from({ length: 4 }, () => ({ bankId: "bank", certificationCode: "TEST", domain: "D", topic: "T" })) };
    const html = renderToStaticMarkup(createElement(NewSimulationForm, { catalog }));
    expect(html).toContain("All available (4)"); expect(html).toContain("Custom"); expect(html).toContain('max="4"');
    const empty = renderToStaticMarkup(createElement(NewSimulationForm, { catalog: { ...catalog, inventory: [] } }));
    expect(empty).toContain("All available (0)"); expect(empty).toMatch(/<button[^>]*disabled=""[^>]*type="submit"/);
  });
  it.each(["training", "exam"] as const)("shows required count, blocks excess options and hides feedback in %s", (mode) => {
    const { db, id, p } = setup(mode); saveAnswers(db, id, p, ["a", "b"]);
    const initial = getSimulation(db, id)!; initial.currentPosition = p;
    const html = renderToStaticMarkup(createElement(SimulationRunner, { initial }));
    expect(html).toContain("Select 2 answers.");
    const inputs = [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((m) => m[0]);
    expect(inputs).toHaveLength(4); expect(inputs.filter((input) => input.includes("disabled"))).toHaveLength(2);
    expect(inputs.filter((input) => input.includes("checked")).every((input) => !input.includes("disabled"))).toBe(true);
    expect(html).not.toContain("Selected correctly"); expect(html).not.toContain("Correct answer");
  });
  it("renders amber partial training feedback with component credit", () => {
    const { db, id, p } = setup("training"); saveAnswers(db, id, p, ["a", "b"]); confirmTrainingAnswer(db, id, p);
    const initial = getSimulation(db, id)!; initial.currentPosition = p;
    const html = renderToStaticMarkup(createElement(SimulationRunner, { initial }));
    expect(html).toContain("Partially correct"); expect(html).toContain("1 / 2 components correct (50.0% credit)");
    expect(html).toContain("Selected correctly"); expect(html).toContain("Selected incorrectly"); expect(html).toContain("learn.microsoft.com");
  });
  it("shows partial results, answer details, and distinct progress and attempt history with Retry", async () => {
    const { db, id, p } = setup("exam"); saveAnswers(db, id, p, ["a", "b"]); submitSimulation(db, id);
    const html = renderToStaticMarkup(await ResultsPage({ params: Promise.resolve({ id }) }));
    expect(html).toContain("12.5%"); expect(html).toContain("Partially correct"); expect(html).toContain("1 / 2 components correct");
    expect(html).toContain("Correct selection"); expect(html).toContain("Incorrect selection"); expect(html).toContain("Retry"); expect(html).toContain("learn.microsoft.com");
    const history = renderToStaticMarkup(createElement(SimulationsPage));
    for (const text of ["Progress overview", "History", "Review", "Retry", "Recent average"]) expect(history).toContain(text);
  });
});
