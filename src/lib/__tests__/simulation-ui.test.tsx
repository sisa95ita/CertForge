// @vitest-environment jsdom
import { DeleteButton } from "@/components/delete-button";
import { getQuestionExposures } from "../simulation-service";
import { POST as createRoute } from "@/app/api/simulations/route";
import { DELETE as deleteBankRoute } from "@/app/api/catalog/[id]/route";
import { DELETE as deleteAttemptRoute } from "@/app/api/simulations/[id]/route";
import { SimulationQuestionEntity, SimulationAnswerEntity } from "../persistence/entities";
import { createElement, type ReactNode } from "react";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import en from "../../../messages/en.json";
import itMessages from "../../../messages/it.json";
import { LanguageSwitcher } from "@/app/[locale]/language-switcher";
import { ImportPanel } from "@/app/[locale]/import/import-panel";
import ImportPage from "@/app/[locale]/import/page";
import Home from "@/app/[locale]/page";
import SimulationPage from "@/app/[locale]/simulations/[id]/page";
import { RetryButton } from "@/app/[locale]/simulations/retry-button";
import { getCatalog } from "../simulation-service";
import { presentation } from "@/i18n/format";
import { translateError } from "@/i18n/errors";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as database from "../db";
import { createTestDb } from "./test-db";
import { importQuestionBank } from "../import-service";
import { createSimulation, getSimulation, retrySimulation, saveAnswers, confirmTrainingAnswer, submitSimulation } from "../simulation-service";
import { testBank } from "./fixtures";
import { NewSimulationForm } from "@/app/[locale]/simulations/new/new-simulation-form";
import { SimulationRunner } from "@/app/[locale]/simulations/[id]/simulation-runner";
import { setCurrentPosition } from "../simulation-service";
import { v2Bank, matrixQuestion, completionQuestion } from "./v2-fixtures";
import { matrixAnswerId } from "../question-answers";
import ResultsPage from "@/app/[locale]/simulations/[id]/results/page";
import SimulationsPage from "@/app/[locale]/simulations/page";
const navigation = vi.hoisted(() => ({ locale: "en" as "en" | "it", pathname: "/en/simulations", push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({
    useRouter: () => navigation,
    usePathname: () => navigation.pathname,
    useParams: () => ({ locale: navigation.locale }),
    notFound: () => { throw new Error("NOT_FOUND"); },
    redirect: (href: string) => { navigation.redirect(href); throw new Error(`REDIRECT:${href}`); },
    permanentRedirect: vi.fn(),
}));
vi.mock("next-intl/server", () => ({
    getLocale: async () => navigation.locale,
    getTranslations: async (namespace: string) => createTranslator({ locale: navigation.locale, messages: (navigation.locale === "it" ? itMessages : en) as Record<string, Record<string, string>>, namespace }),
}));
function provider(children: ReactNode, locale = navigation.locale) {
    return <NextIntlClientProvider locale={locale} messages={locale === "it" ? itMessages : en} onError={(error) => { throw error; }}>{children}</NextIntlClientProvider>;
}
function markup(children: ReactNode) { return renderToStaticMarkup(provider(children)); }
const databases: Awaited<ReturnType<typeof createTestDb>>[] = [];
afterEach(async () => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); navigation.locale = "en"; navigation.pathname = "/en/simulations"; await Promise.all(databases.splice(0).map((db) => db.destroy())); });
async function setup(mode: "training" | "exam") {
    const db = (await createTestDb());
    databases.push(db);
    (await importQuestionBank(db, testBank()));
    vi.spyOn(database, "getDataSource").mockResolvedValue(db);
    const id = (await createSimulation(db, { mode, questionCount: 4 }, () => 0.999));
    const p = (await getSimulation(db, id))!.questions.find((q) => q.question.type === "multiple-choice")!.position;
    return { db, id, p };
}
describe("simulation UI", () => {
    it("offers all and custom counts, disables starting with an empty pool", () => {
        const catalog = { banks: [{ id: "bank", title: "Bank", certificationName: "Test", certificationCode: "TEST", version: 1, questionCount: 4 }], facets: [], inventory: Array.from({ length: 4 }, () => ({ bankId: "bank", certificationCode: "TEST", domain: "D", topic: "T" })) };
        const html = markup(createElement(NewSimulationForm, { catalog }));
        expect(html).toContain("All available (4)");
        expect(html).toContain("Custom");
        expect(html).toContain('max="4"');
        const empty = markup(createElement(NewSimulationForm, { catalog: { ...catalog, inventory: [] } }));
        expect(empty).toContain("All available (0)");
        expect(empty).toMatch(/<button[^>]*disabled=""[^>]*type="submit"/);
    });
    it.each(["training", "exam"] as const)("shows required count, blocks excess options and hides feedback in %s", async (mode) => {
        const { db, id, p } = (await setup(mode));
        (await saveAnswers(db, id, p, ["a", "b"]));
        const initial = (await getSimulation(db, id))!;
        initial.currentPosition = p;
        const html = markup(createElement(SimulationRunner, { initial }));
        expect(html).toContain("Select 2 answers.");
        const inputs = [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((m) => m[0]);
        expect(inputs).toHaveLength(4);
        expect(inputs.filter((input) => input.includes("disabled"))).toHaveLength(2);
        expect(inputs.filter((input) => input.includes("checked")).every((input) => !input.includes("disabled"))).toBe(true);
        expect(html).not.toContain("Selected correctly");
        expect(html).not.toContain("Correct answer");
    });
    it("renders amber partial training feedback with component credit", async () => {
        const { db, id, p } = (await setup("training"));
        (await saveAnswers(db, id, p, ["a", "b"]));
        (await confirmTrainingAnswer(db, id, p));
        const initial = (await getSimulation(db, id))!;
        initial.currentPosition = p;
        const html = markup(createElement(SimulationRunner, { initial }));
        expect(html).toContain("Partially correct");
        expect(html).toContain("1 / 2 components correct (50.0% credit)");
        expect(html).toContain("Selected correctly");
        expect(html).toContain("Selected incorrectly");
        expect(html).toContain("learn.microsoft.com");
    });
    it("shows partial results, answer details, and distinct progress and attempt history with Retry", async () => {
        const { db, id, p } = (await setup("exam"));
        (await saveAnswers(db, id, p, ["a", "b"]));
        (await submitSimulation(db, id));
        const html = markup(await ResultsPage({ params: Promise.resolve({ id, locale: navigation.locale }) }));
        expect(html).toContain("12.5%");
        expect(html).toContain("Partially correct");
        expect(html).toContain("1 / 2 components correct");
        expect(html).toContain("Correct selection");
        expect(html).toContain("Incorrect selection");
        expect(html).toContain("Retry");
        expect(html).toContain("learn.microsoft.com");
        const history = markup(await SimulationsPage());
        for (const text of ["Progress overview", "History", "Review", "Retry", "Recent average"])
            expect(history).toContain(text);
    });
});
describe("CertForge localization", () => {
    it.each(["it", "en"] as const)("renders home, import, setup and history in %s", async (locale) => {
        navigation.locale = locale;
        navigation.pathname = `/${locale}/simulations`;
        const { db, id } = (await setup("training"));
        const home = markup(await Home());
        expect(home).toContain(locale === "it" ? "Importa raccolte di domande" : "Import Question Banks");
        expect(home).toContain(`href="/${locale}/import"`);
        const imported = markup(await ImportPage());
        expect(imported).toContain(locale === "it" ? "Scegli i file" : "Choose files");
        const form = markup(createElement(NewSimulationForm, { catalog: (await getCatalog(db)) as Parameters<typeof NewSimulationForm>[0]["catalog"] }));
        for (const value of locale === "it" ? ["Allenamento", "Esame", "Avvia allenamento", "4 domande", "Certificazione", "Area", "Argomento"] : ["Training", "Exam", "Start Training", "4 questions", "Certification", "Domain", "Topic"])
            expect(form).toContain(value);
        expect(form).toContain("Generic certification");
        const history = markup(await SimulationsPage());
        expect(history).toContain(locale === "it" ? "Riprendi una simulazione" : "Continue Simulation");
        expect(history).toContain(locale === "it" ? "4 domande" : "4 questions");
        expect(history).toContain(`href="/${locale}/simulations/${id}"`);
        expect(history).toContain(locale === "it" ? "Le simulazioni completate appariranno qui." : "Completed simulations will appear here.");
    });
    it.each(["it", "en"] as const)("renders training feedback, exam controls and results in %s without altering bank content", async (locale) => {
        navigation.locale = locale;
        const { db, id, p } = (await setup("training"));
        (await saveAnswers(db, id, p, ["a", "b"]));
        (await confirmTrainingAnswer(db, id, p));
        const initial = (await getSimulation(db, id))!;
        initial.currentPosition = p;
        const before = JSON.stringify((await getSimulation(db, id)));
        const changes = (await db.query("SELECT total_changes() AS count"));
        const html = markup(createElement(SimulationRunner, { initial }));
        expect(html).toContain(locale === "it" ? "Seleziona 2 risposte." : "Select 2 answers.");
        expect(html).toContain(locale === "it" ? "Parzialmente corretta" : "Partially correct");
        expect(html).toContain(locale === "it" ? "Precedente" : "Previous");
        expect(html).toContain(locale === "it" ? "Successiva" : "Next");
        for (const text of [initial.questions[p].question.question, initial.questions[p].question.explanation, "Learn", "https://learn.microsoft.com/en-us/training/", "D1", "T1", "medium"])
            expect(html).toContain(text);
        expect(JSON.stringify((await getSimulation(db, id)))).toBe(before);
        expect((await db.query("SELECT total_changes() AS count"))).toEqual(changes);
        (await submitSimulation(db, id));
        const resultsBefore = JSON.stringify((await getSimulation(db, id)));
        const results = markup(await ResultsPage({ params: Promise.resolve({ id, locale }) }));
        expect(results).toContain(locale === "it" ? "La tua risposta" : "Your answer");
        expect(results).toContain(locale === "it" ? "Riprova" : "Retry");
        expect(results).toContain(locale === "it" ? "12,5%" : "12.5%");
        for (const question of initial.questions) {
            expect(results).toContain(question.question.question);
            expect(results).toContain(question.question.explanation);
        }
        expect(JSON.stringify((await getSimulation(db, id)))).toBe(resultsBefore);
        const exam = (await setup("exam"));
        const examHtml = markup(createElement(SimulationRunner, { initial: (await getSimulation(exam.db, exam.id))! }));
        expect(examHtml).toContain(locale === "it" ? "Tempo rimasto" : "Time left");
        expect(examHtml).toContain(locale === "it" ? "Segna da rivedere" : "Mark for review");
        expect(examHtml).toContain(locale === "it" ? "Consegna esame" : "Submit exam");
    });
    it.each(["it", "en"] as const)("preserves the current simulation ID, query, fragment and data when switching from %s", async (locale) => {
        navigation.locale = locale;
        const targetLocale = locale === "it" ? "en" : "it";
        const { db, id, p } = (await setup("exam"));
        (await saveAnswers(db, id, p, ["a", "b"]));
        const snapshot = JSON.stringify((await getSimulation(db, id)));
        const changes = (await db.query("SELECT total_changes() AS count"));
        navigation.pathname = `/${locale}/simulations/${id}`;
        window.history.replaceState({}, "", navigation.pathname + "?view=question#answers");
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        render(provider(createElement(LanguageSwitcher)));
        fireEvent.click(screen.getByRole("button", { name: locale === "it" ? "Inglese" : "Italian" }));
        expect(navigation.replace).toHaveBeenCalledWith(`/${targetLocale}/simulations/${id}?view=question#answers`, { scroll: false });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(navigation.push).not.toHaveBeenCalled();
        expect(JSON.stringify((await getSimulation(db, id)))).toBe(snapshot);
        expect((await db.query("SELECT total_changes() AS count"))).toEqual(changes);
        // The next locale route reads the same saved selections and position.
        navigation.locale = targetLocale;
        const reloaded = (await getSimulation(db, id))!;
        reloaded.currentPosition = p;
        const html = markup(createElement(SimulationRunner, { initial: reloaded }));
        expect([...html.matchAll(/<input[^>]*checked=""/g)]).toHaveLength(2);
        expect(html).toContain(targetLocale === "it" ? "Seleziona 2 risposte." : "Select 2 answers.");
    });
    it.each(["it", "en"] as const)("preserves %s in completed and active simulation redirects", async (locale) => {
        navigation.locale = locale;
        const { db, id } = (await setup("training"));
        await expect(ResultsPage({ params: Promise.resolve({ id, locale }) })).rejects.toThrow(`REDIRECT:/${locale}/simulations/${id}`);
        (await submitSimulation(db, id));
        await expect(SimulationPage({ params: Promise.resolve({ id, locale }) })).rejects.toThrow(`REDIRECT:/${locale}/simulations/${id}/results`);
    });
    it.each(["it", "en"] as const)("preserves %s when creating or retrying a simulation", async (locale) => {
        navigation.locale = locale;
        const { db, id } = (await setup("training"));
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "next-id" }) });
        vi.stubGlobal("fetch", fetchMock);
        render(provider(createElement(NewSimulationForm, { catalog: (await getCatalog(db)) as Parameters<typeof NewSimulationForm>[0]["catalog"] })));
        fireEvent.click(screen.getByRole("button", { name: locale === "it" ? "Avvia allenamento" : "Start Training" }));
        await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/${locale}/simulations/next-id`));
        expect(fetchMock).toHaveBeenCalledWith("/api/simulations", expect.objectContaining({ method: "POST" }));
        cleanup();
        navigation.push.mockClear();
        render(provider(createElement(RetryButton, { simulationId: id })));
        fireEvent.click(screen.getByRole("button", { name: locale === "it" ? "Riprova" : "Retry" }));
        await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/${locale}/simulations/next-id`));
    });
    it("localizes import statuses and validation errors while preserving bank titles", async () => {
        navigation.locale = "it";
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [
                    { status: "imported", title: "English bank title", questions: 2, version: 1 },
                    { status: "updated", title: "Another English title", questions: 2, version: 2, previousVersion: 1 },
                    { status: "skipped", title: "Existing bank", reason: "same-version", version: 1 },
                    { status: "failed", title: "Invalid question bank", errors: ["questions.0.answers: Answer option ids must be unique", "Malformed JSON: Unexpected token"] },
                ] }) }));
        render(provider(createElement(ImportPanel)));
        fireEvent.change(screen.getByLabelText("Scegli i file", { selector: "input" }), { target: { files: [new File(["{}"], "bank.json", { type: "application/json" })] } });
        fireEvent.click(screen.getByRole("button", { name: "Importa 1 file" }));
        await screen.findByText("Importazione completata");
        const text = document.body.textContent!;
        for (const value of ["English bank title", "2 domande importate", "aggiornata dalla versione 1 alla 2", "già importata", "Raccolta di domande non valida", "Gli ID delle opzioni di risposta devono essere univoci", "JSON non valido"])
            expect(text).toContain(value);
        expect(text).not.toContain("Malformed JSON");
    });
    it("renders pluralized answer instructions and variable errors in Italian", () => {
        const t = createTranslator({ locale: "it", messages: itMessages as Record<string, Record<string, string>>, namespace: "Simulation" });
        expect(t("selectAnswers", { count: 1 })).toBe("Seleziona 1 risposta.");
        expect(t("selectAnswers", { count: 2 })).toBe("Seleziona 2 risposte.");
        expect(t("selectAnswers", { count: 5 })).toBe("Seleziona 5 risposte.");
        const errors = createTranslator({ locale: "it", messages: itMessages as Record<string, Record<string, string>>, namespace: "Errors" });
        expect(translateError(errors, "Select at most 3 answers")).toBe("Seleziona al massimo 3 risposte");
        expect(translateError(errors, "Correct answer 'b' does not reference an option")).toContain("'b'");
        expect(translateError(errors, "questions.0.answers: Too small: expected array to have >=2 items")).toBe("questions.0.answers: Il valore è inferiore al minimo di 2");
    });
    it("formats dates, percentages and durations for the active UI locale", () => {
        expect(presentation("it").date("2026-10-02T12:00:00Z")).toBe("02/10/2026");
        expect(presentation("en").date("2026-10-02T12:00:00Z")).toBe("10/2/2026");
        expect(presentation("it").percent(12.5)).toBe("12,5%");
        expect(presentation("en").percent(12.5)).toBe("12.5%");
        expect(presentation("it").duration(65)).toContain("min");
    });
});
async function labeledSimulation(mode: "training" | "exam", type: "single-choice" | "multiple-choice", opaque = false) {
    const db = (await createTestDb());
    databases.push(db);
    vi.spyOn(database, "getDataSource").mockResolvedValue(db);
    const ids = opaque
        ? { a: "answer-x", b: "foo", c: "opaque-answer", d: "option-42" }
        : { a: "a", b: "b", c: "c", d: "d" };
    const options = type === "single-choice"
        ? [{ id: ids.d, text: "Four" }, { id: ids.b, text: "Two" }, { id: ids.a, text: "One" }, { id: ids.c, text: "Three" }]
        : [{ id: ids.c, text: "Three" }, { id: ids.a, text: "One" }, { id: ids.d, text: "Four" }, { id: ids.b, text: "Two" }];
    const bank = testBank();
    bank.questions = [{ ...bank.questions[0], type, answers: options, correctAnswers: type === "single-choice" ? [ids.a] : [ids.a, ids.b] }];
    (await importQuestionBank(db, bank));
    const id = (await createSimulation(db, { mode, questionCount: 1 }, () => 0.999));
    return { db, id, ids };
}
describe("answer labels stay separate from stable IDs", () => {
    const cases = (["training", "exam"] as const).flatMap((mode) => (["single-choice", "multiple-choice"] as const).flatMap((type) => [false, true].map((opaque) => ({ mode, type, opaque }))));
    it.each(cases)("renders position labels and saves stable IDs in $mode $type (opaque=$opaque)", async ({ mode, type, opaque }) => {
        const { db, id, ids } = (await labeledSimulation(mode, type, opaque));
        const initial = (await getSimulation(db, id))!;
        const snapshot = (await db.getRepository(SimulationQuestionEntity).findOne({ select: { snapshot_json: true }, where: { simulation_id: id } }));
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(init!.body as string) as {
                action: string;
                answers: string[];
            };
            if (body.action === "answers")
                (await saveAnswers(db, id, 0, body.answers));
            else if (body.action === "confirm")
                (await confirmTrainingAnswer(db, id, 0));
            else if (body.action === "submit")
                (await submitSimulation(db, id));
            return { ok: true, json: async () => (await getSimulation(db, id))! };
        });
        vi.stubGlobal("fetch", fetchMock);
        const view = render(provider(createElement(SimulationRunner, { initial })));
        const role = type === "single-choice" ? "radio" : "checkbox";
        const expectedLabels = type === "single-choice"
            ? ["A. Four", "B. Two", "C. One", "D. Three"]
            : ["A. Three", "B. One", "C. Four", "D. Two"];
        expect(screen.getAllByRole(role).map((input) => input.closest("label")!.querySelector("strong")!.textContent)).toEqual(["A.", "B.", "C.", "D."]);
        for (const label of expectedLabels)
            expect(screen.getByRole(role, { name: label })).toBeTruthy();
        if (opaque)
            for (const stableId of Object.values(ids))
                expect(view.container.textContent).not.toContain(stableId);
        const selectedLabels = type === "single-choice" ? ["C. One"] : ["B. One", "D. Two"];
        const stableIds = type === "single-choice" ? [ids.a] : [ids.a, ids.b];
        for (let index = 0; index < selectedLabels.length; index++) {
            fireEvent.click(screen.getByRole(role, { name: selectedLabels[index] }));
            await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(index + 1));
            await waitFor(() => expect((screen.getByRole(role, { name: selectedLabels[index] }) as HTMLInputElement).disabled).toBe(false));
            const sent = JSON.parse(fetchMock.mock.calls[index][1]!.body as string);
            expect(sent).toEqual({ action: "answers", position: 0, answers: stableIds.slice(0, index + 1) });
        }
        expect((await getSimulation(db, id))!.questions[0].selectedAnswers).toEqual([...stableIds].sort());
        expect((await db.getRepository(SimulationAnswerEntity).find({ select: { option_id: true }, where: { simulation_id: id }, order: { option_id: "ASC" } })))
            .toEqual([...stableIds].sort().map((option_id) => ({ option_id })));
        if (mode === "training") {
            fireEvent.click(screen.getByRole("button", { name: "Confirm answer" }));
            await waitFor(() => expect(screen.getAllByText("Selected correctly")).toHaveLength(stableIds.length));
            expect((await getSimulation(db, id))!.questions[0].evaluation).toEqual({ status: "correct", score: 1 });
            for (const label of selectedLabels) {
                expect(screen.getByRole(role, { name: label + " Selected correctly" })).toBeTruthy();
            }
            await waitFor(() => expect((screen.getByRole("button", { name: "View results" }) as HTMLButtonElement).disabled).toBe(false));
            fireEvent.click(screen.getByRole("button", { name: "View results" }));
        }
        else {
            fireEvent.click(screen.getAllByRole("button", { name: "Submit exam" })[0]);
        }
        await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/en/simulations/" + id + "/results"));
        const completed = (await getSimulation(db, id))!;
        expect(completed.questions[0].evaluation).toEqual({ status: "correct", score: 1 });
        expect(completed.questions[0].question).toEqual(initial.questions[0].question);
        expect((await db.getRepository(SimulationQuestionEntity).findOne({ select: { snapshot_json: true }, where: { simulation_id: id } }))).toEqual(snapshot);
        cleanup();
        render(provider(await ResultsPage({ params: Promise.resolve({ id, locale: "en" }) })));
        const review = document.querySelector("article")!;
        const selected = within(review).getByText("Your answer").nextElementSibling!;
        const correct = within(review).getByText("Correct answer").nextElementSibling!;
        for (const label of selectedLabels) {
            expect(selected.textContent).toContain(label);
            expect(correct.textContent).toContain(label);
        }
        expect(screen.getByRole("heading", { name: "100.0%" })).toBeTruthy();
    });
    it("uses snapshot labels for correct, incorrect and partial Training feedback", async () => {
        const { db, id } = (await labeledSimulation("training", "multiple-choice"));
        (await saveAnswers(db, id, 0, ["a", "d"]));
        (await confirmTrainingAnswer(db, id, 0));
        const initial = (await getSimulation(db, id))!;
        expect(initial.questions[0].evaluation).toEqual({ status: "partial", score: 0.5 });
        render(provider(createElement(SimulationRunner, { initial })));
        expect(screen.getByRole("checkbox", { name: "B. One Selected correctly" })).toBeTruthy();
        expect(screen.getByRole("checkbox", { name: "C. Four Selected incorrectly" })).toBeTruthy();
        expect(screen.getByRole("checkbox", { name: "D. Two Correct answer" })).toBeTruthy();
        expect(screen.getByText("1 / 2 components correct (50.0% credit)")).toBeTruthy();
        cleanup();
        (await submitSimulation(db, id));
        render(provider(await ResultsPage({ params: Promise.resolve({ id, locale: "en" }) })));
        const review = document.querySelector("article")!;
        expect(within(review).getByText("Your answer").nextElementSibling!.textContent)
            .toBe("B. One (Correct selection)C. Four (Incorrect selection)");
        expect(within(review).getByText("Correct answer").nextElementSibling!.textContent)
            .toBe("B. One; D. Two");
    });
    it.each(["en", "it"] as const)("reviews historical snapshot order in %s without writes or migration", async (locale) => {
        navigation.locale = locale;
        const { db, id } = (await labeledSimulation("exam", "single-choice", true));
        (await saveAnswers(db, id, 0, ["answer-x"]));
        (await submitSimulation(db, id));
        const before = (await getSimulation(db, id))!;
        const rows = (await db.getRepository(SimulationQuestionEntity).findBy({ simulation_id: id }));
        const changes = (await db.query("SELECT total_changes() AS count"));
        const version = ((await db.query("PRAGMA user_version"))[0].user_version);
        const history = markup(await SimulationsPage());
        expect(history).toContain('href="/' + locale + '/simulations/' + id + '/results"');
        render(provider(await ResultsPage({ params: Promise.resolve({ id, locale }) })));
        const review = document.querySelector("article")!;
        const yourAnswer = within(review).getByText(locale === "it" ? "La tua risposta" : "Your answer").nextElementSibling!;
        const correctAnswer = within(review).getByText(locale === "it" ? "Risposta corretta" : "Correct answer").nextElementSibling!;
        expect(yourAnswer.textContent).toContain("C. One");
        expect(correctAnswer.textContent).toBe("C. One");
        for (const stableId of ["answer-x", "foo", "opaque-answer", "option-42"])
            expect(review.textContent).not.toContain(stableId);
        expect((await getSimulation(db, id))).toEqual(before);
        expect((await db.getRepository(SimulationQuestionEntity).findBy({ simulation_id: id }))).toEqual(rows);
        expect((await db.query("SELECT total_changes() AS count"))).toEqual(changes);
        expect(((await db.query("PRAGMA user_version"))[0].user_version)).toBe(version);
    });
    it.each(["training", "exam"] as const)("relabels a reshuffled %s retry and preserves correctness and the original snapshot", async (mode) => {
        const { db, id } = (await labeledSimulation(mode, "multiple-choice"));
        (await saveAnswers(db, id, 0, ["a", "b"]));
        if (mode === "training")
            (await confirmTrainingAnswer(db, id, 0));
        (await submitSimulation(db, id));
        const original = (await getSimulation(db, id))!;
        const snapshot = (await db.getRepository(SimulationQuestionEntity).findOne({ select: { snapshot_json: true }, where: { simulation_id: id } }));
        const retryId = (await retrySimulation(db, id, () => 0));
        const retried = (await getSimulation(db, retryId))!;
        expect(retried.questions[0].question.answers.map((option) => option.id)).toEqual(["a", "d", "b", "c"]);
        expect(retried.questions[0].question.correctAnswers).toEqual(["a", "b"]);
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(init!.body as string) as {
                answers: string[];
            };
            (await saveAnswers(db, retryId, 0, body.answers));
            return { ok: true, json: async () => (await getSimulation(db, retryId))! };
        });
        vi.stubGlobal("fetch", fetchMock);
        render(provider(createElement(SimulationRunner, { initial: retried })));
        expect(screen.getAllByRole("checkbox").map((input) => input.closest("label")!.querySelector("strong")!.textContent))
            .toEqual(["A.", "B.", "C.", "D."]);
        for (const label of ["A. One", "B. Four", "C. Two", "D. Three"])
            expect(screen.getByRole("checkbox", { name: label })).toBeTruthy();
        for (const label of ["A. One", "C. Two"]) {
            fireEvent.click(screen.getByRole("checkbox", { name: label }));
            await waitFor(() => expect((screen.getByRole("checkbox", { name: label }) as HTMLInputElement).disabled).toBe(false));
        }
        expect((await getSimulation(db, retryId))!.questions[0].selectedAnswers).toEqual(["a", "b"]);
        if (mode === "training")
            expect((await confirmTrainingAnswer(db, retryId, 0))).toEqual({ status: "correct", score: 1 });
        (await submitSimulation(db, retryId));
        expect((await getSimulation(db, retryId))!.questions[0].evaluation).toEqual({ status: "correct", score: 1 });
        cleanup();
        render(provider(await ResultsPage({ params: Promise.resolve({ id: retryId, locale: "en" }) })));
        const correct = within(document.querySelector("article")!).getByText("Correct answer").nextElementSibling!;
        expect(correct.textContent).toBe("A. One; C. Two");
        expect((await getSimulation(db, id))).toEqual(original);
        expect((await db.getRepository(SimulationQuestionEntity).findOne({ select: { snapshot_json: true }, where: { simulation_id: id } }))).toEqual(snapshot);
    });
});

async function v2Setup(mode: "training" | "exam", bank = v2Bank()) {
    const db = await createTestDb(); databases.push(db);
    await importQuestionBank(db, bank);
    vi.spyOn(database, "getDataSource").mockResolvedValue(db);
    const id = await createSimulation(db, { mode, questionCount: 2 }, () => 0.999);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init!.body as string);
        if (body.action === "answers") await saveAnswers(db, id, body.position, body.answers);
        if (body.action === "confirm") await confirmTrainingAnswer(db, id, body.position);
        if (body.action === "navigate") await setCurrentPosition(db, id, body.position);
        if (body.action === "submit") await submitSimulation(db, id);
        return { ok: true, json: async () => (await getSimulation(db, id))! };
    });
    vi.stubGlobal("fetch", fetchMock);
    return { db, id, fetchMock };
}
describe("V2 question controls and review", () => {
    it.each(["en", "it"] as const)("confirms all matrix rows together and locks localized training feedback in %s", async (locale) => {
        navigation.locale = locale;
        const { db, id, fetchMock } = await v2Setup("training");
        render(provider(<SimulationRunner initial={(await getSimulation(db, id))!} />));
        const yes = locale === "it" ? "Sì" : "Yes";
        const no = "No";
        const confirmName = locale === "it" ? "Conferma risposta" : "Confirm answer";
        const confirm = screen.getByRole("button", { name: confirmName }) as HTMLButtonElement;
        expect(confirm.disabled).toBe(true);
        expect(screen.getAllByRole("group")).toHaveLength(3);
        expect(document.body.textContent).not.toContain("First explanation");
        const select = async (statement: string, answer: string, calls: number) => {
            const group = screen.getByRole("group", { name: statement });
            fireEvent.click(within(group).getByRole("radio", { name: answer }));
            await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(calls));
            await waitFor(() => expect((within(group).getByRole("radio", { name: answer }) as HTMLInputElement).disabled).toBe(false));
        };
        await select("Statement one", yes, 1);
        await select("Statement two", no, 2);
        expect(confirm.disabled).toBe(true);
        expect(document.body.textContent).toContain(locale === "it" ? "Con risposta: 0" : "Answered: 0");
        await select("Statement three", no, 3);
        expect(confirm.disabled).toBe(false);
        expect(document.body.textContent).toContain(locale === "it" ? "Con risposta: 1" : "Answered: 1");
        fireEvent.click(confirm);
        await screen.findByText(locale === "it" ? "Parzialmente corretta" : "Partially correct");
        for (const radio of screen.getAllByRole("radio")) expect((radio as HTMLInputElement).disabled).toBe(true);
        expect(document.body.textContent).toContain(locale === "it" ? "2 di 3 affermazioni corrette" : "2 of 3 statements correct");
        expect(document.body.textContent).toContain(locale === "it" ? "0,67 / 1 punto" : "0.67 / 1 point");
        for (const text of ["First explanation", "Second explanation", "Third explanation", "Overall explanation", "Matrix Learn"])
            expect(document.body.textContent).toContain(text);
        expect((await getSimulation(db, id))!.questions[0].evaluation).toEqual({ score: 2 / 3, status: "partial" });
    });
    it("persists partial exam rows, allows navigation and changes, and submits with rows unanswered", async () => {
        const { db, id, fetchMock } = await v2Setup("exam");
        render(provider(<SimulationRunner initial={(await getSimulation(db, id))!} />));
        const group = screen.getByRole("group", { name: "Statement one" });
        fireEvent.click(within(group).getByRole("radio", { name: "Yes" }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await waitFor(() => expect((within(group).getByRole("radio", { name: "No" }) as HTMLInputElement).disabled).toBe(false));
        fireEvent.click(within(group).getByRole("radio", { name: "No" }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        await waitFor(() => expect((screen.getByRole("button", { name: /Next/ }) as HTMLButtonElement).disabled).toBe(false));
        expect(document.body.textContent).not.toContain("First explanation");
        expect(document.body.textContent).not.toContain("Correct answer");
        expect(document.body.textContent).toContain("Answered: 0");
        fireEvent.click(screen.getByRole("button", { name: /Next/ }));
        await screen.findByRole("combobox");
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        fireEvent.click(screen.getByRole("button", { name: /Previous/ }));
        await screen.findByRole("group", { name: "Statement one" });
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
        expect((within(screen.getByRole("group", { name: "Statement one" })).getByRole("radio", { name: "No" }) as HTMLInputElement).checked).toBe(true);
        const warning = vi.spyOn(window, "confirm").mockReturnValue(true);
        fireEvent.click(screen.getByRole("button", { name: "Submit exam" }));
        await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/en/simulations/${id}/results`));
        expect(warning).toHaveBeenCalledWith("2 questions are unanswered. Submit anyway?");
        expect((await getSimulation(db, id))!.status).toBe("completed");
    });
    it.each(["en", "it"] as const)("renders an inline labeled dropdown using text and stable IDs and locks completion training in %s", async (locale) => {
        navigation.locale = locale;
        const { db, id, fetchMock } = await v2Setup("training");
        await setCurrentPosition(db, id, 1);
        const view = render(provider(<SimulationRunner initial={(await getSimulation(db, id))!} />));
        const select = screen.getByRole("combobox", { name: /Call client/ }) as HTMLSelectElement;
        expect(select.labels).toHaveLength(1);
        expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
            locale === "it" ? "Seleziona una risposta" : "Select an answer",
            ...completionQuestion().answers.map((answer) => answer.text),
        ]);
        expect(view.container.textContent).not.toContain("{{blank}}");
        expect(view.container.textContent).not.toContain("opaque-option-1");
        const confirm = screen.getByRole("button", { name: locale === "it" ? "Conferma risposta" : "Confirm answer" }) as HTMLButtonElement;
        expect(confirm.disabled).toBe(true);
        fireEvent.change(select, { target: { value: "opaque-option-2" } });
        await waitFor(() => expect(select.disabled).toBe(false));
        expect(fetchMock).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ body: JSON.stringify({ action: "answers", position: 1, answers: ["opaque-option-2"] }) }));
        fireEvent.click(confirm);
        await screen.findByText(locale === "it" ? "Completamento corretto" : "Correct completion");
        expect(select.disabled).toBe(true);
        expect(document.body.textContent).toContain("Call client.responses.create(...) to respond.");
        expect(document.body.textContent).toContain("Completion explanation");
        expect(document.body.textContent).toContain("Completion Learn");
        expect((await getSimulation(db, id))!.questions[1]).toMatchObject({ locked: true, evaluation: { score: 0, status: "incorrect" } });
    });
    it("allows completion exam changes with stable option order and hides feedback until results", async () => {
        const { db, id } = await v2Setup("exam");
        await setCurrentPosition(db, id, 1);
        render(provider(<SimulationRunner initial={(await getSimulation(db, id))!} />));
        const select = screen.getByRole("combobox") as HTMLSelectElement;
        const options = Array.from(select.options).map((option) => option.value);
        fireEvent.change(select, { target: { value: "opaque-option-2" } });
        await waitFor(() => expect(select.disabled).toBe(false));
        fireEvent.change(select, { target: { value: "opaque-option-1" } });
        await waitFor(() => expect(select.disabled).toBe(false));
        expect(Array.from(select.options).map((option) => option.value)).toEqual(options);
        expect(document.body.textContent).not.toContain("Completion explanation");
        expect(document.body.textContent).not.toContain("Correct completion");
        expect((await getSimulation(db, id))!.questions[1].evaluation).toBeNull();
        cleanup();
        render(provider(<SimulationRunner initial={(await getSimulation(db, id))!} />));
        expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("opaque-option-1");
        expect(Array.from((screen.getByRole("combobox") as HTMLSelectElement).options).map((option) => option.value)).toEqual(options);
    });
    it.each(["en", "it"] as const)("renders historical V2 review including unanswered rows and completed statements in %s", async (locale) => {
        navigation.locale = locale;
        const { db, id } = await v2Setup("exam");
        await saveAnswers(db, id, 0, [matrixAnswerId(matrixQuestion().statements[0].id, "yes"), matrixAnswerId("s2", "no")]);
        await saveAnswers(db, id, 1, ["opaque-option-2"]);
        await submitSimulation(db, id);
        await importQuestionBank(db, v2Bank(2, " UPDATED"));
        const html = markup(await ResultsPage({ params: Promise.resolve({ id, locale }) }));
        for (const text of ["First explanation", "Second explanation", "Third explanation", "Overall explanation", "Call client.models.list(...) to respond.", "Call client.responses.create(...) to respond.", "Matrix Learn", "Completion Learn"])
            expect(html).toContain(text);
        expect(html).toContain(locale === "it" ? "Nessuna risposta" : "No answer");
        expect(html).toContain(locale === "it" ? "2 di 3 affermazioni corrette" : "2 of 3 statements correct");
        expect(html).not.toContain("UPDATED");
        expect(html).not.toContain("opaque-option-");
        expect(html).not.toContain("{{blank}}");
    });
});

    it("preserves replacement-like characters in selected and correct completion text", async () => {
        const bank = v2Bank();
        const literal = "$& + $' + $` + $$";
        bank.questions[1] = {
            ...completionQuestion(),
            answers: [{ id: "opaque-option-1", text: literal }, ...completionQuestion().answers.slice(1)],
        };
        const { db, id } = await v2Setup("training", bank);
        await setCurrentPosition(db, id, 1);
        await saveAnswers(db, id, 1, ["opaque-option-1"]);
        await confirmTrainingAnswer(db, id, 1);
        render(provider(<SimulationRunner initial={(await getSimulation(db, id))!} />));
        const expected = "Call client." + literal + "(...) to respond.";
        expect(screen.getByText(expected, { selector: "dd" })).toBeTruthy();
        cleanup();
        await submitSimulation(db, id);
        render(provider(await ResultsPage({ params: Promise.resolve({ id, locale: "en" }) })));
        expect(screen.getByRole("heading", { name: expected })).toBeTruthy();
    });

describe("deletion and repetition confirmation UI", () => {
    // jsdom has no native modal implementation; exercise the same dialog events.
    function dialogs() {
        Object.defineProperties(HTMLDialogElement.prototype, {
            showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
            close: { configurable: true, value(this: HTMLDialogElement) { this.open = false; } },
        });
    }

    it.each(["en", "it"] as const)("preserves the form on Back and confirms the exact preview with no canceled writes in %s", async (locale) => {
        dialogs(); navigation.locale = locale;
        const { db } = await setup("training");
        await createSimulation(db, { mode: "training", questionCount: 4 });
        await createSimulation(db, { mode: "training", questionCount: 4 });
        const before = await getQuestionExposures(db);
        let token = "";
        const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
            const response = await createRoute(new Request("http://localhost/api/simulations", init));
            const body = await response.clone().json();
            if (body.preview) token = body.preview.token;
            return response;
        });
        vi.stubGlobal("fetch", fetchMock);
        render(provider(<NewSimulationForm catalog={await getCatalog(db)} />));
        fireEvent.click(screen.getByRole("radio", { name: locale === "it" ? "Personalizzato" : "Custom" }));
        const count = screen.getByRole("spinbutton", { name: locale === "it" ? "Numero personalizzato di domande" : "Custom question count" }) as HTMLInputElement;
        fireEvent.change(count, { target: { value: "2" } });
        const start = locale === "it" ? "Avvia allenamento" : "Start Training";
        fireEvent.click(screen.getByRole("button", { name: start }));
        const dialog = await screen.findByRole("dialog");
        expect(dialog.textContent).toContain(locale === "it" ? "2 delle 2 domande selezionate" : "2 of the 2 selected questions");
        expect(dialog.textContent).toContain(locale === "it" ? "almeno 3 volte" : "at least 3 times");
        expect(await db.getRepository(SimulationQuestionEntity).count()).toBe(12);
        fireEvent.click(within(dialog).getByRole("button", { name: locale === "it" ? "Indietro" : "Back" }));
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(count.value).toBe("2");
        expect(await getQuestionExposures(db)).toEqual(before);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(navigation.push).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: start }));
        const confirmation = await screen.findByRole("dialog");
        const plan = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString()) as { questions: { questionId: string }[] };
        fireEvent.click(within(confirmation).getByRole("button", { name: locale === "it" ? "Continua comunque" : "Continue anyway" }));
        await waitFor(() => expect(navigation.push).toHaveBeenCalledTimes(1));
        expect(fetchMock).toHaveBeenLastCalledWith("/api/simulations", expect.objectContaining({ body: JSON.stringify({ selectionToken: token }) }));
        const href = navigation.push.mock.calls[0][0] as string;
        const created = (await getSimulation(db, href.split("/").at(-1)!))!;
        expect(created.questions.map((q) => q.question.id)).toEqual(plan.questions.map((q) => q.questionId));
        expect(await db.getRepository(SimulationQuestionEntity).count()).toBe(14);
    });

    it.each(["en", "it"] as const)("confirms bank and history deletion, supports Cancel, and refreshes current data in %s", async (locale) => {
        dialogs(); navigation.locale = locale;
        const { db, id } = await setup("training");
        await submitSimulation(db, id);
        const fetchMock = vi.fn(async (url: string) => {
            const context = { params: Promise.resolve({ id: url.includes("/catalog/") ? testBank().id : id }) };
            const request = new Request("http://localhost" + url, { method: "DELETE" });
            return url.includes("/catalog/") ? deleteBankRoute(request, context) : deleteAttemptRoute(request, context);
        });
        vi.stubGlobal("fetch", fetchMock);
        const label = locale === "it" ? "Elimina" : "Delete";
        render(provider(<DeleteButton kind="bank" id={testBank().id} name="Bank" />));
        fireEvent.click(screen.getByRole("button", { name: label }));
        let dialog = await screen.findByRole("dialog");
        expect(dialog.textContent).toContain("Bank");
        expect(dialog.textContent).toContain(locale === "it" ? "cronologia" : "history");
        fireEvent.click(within(dialog).getByRole("button", { name: locale === "it" ? "Annulla" : "Cancel" }));
        expect(fetchMock).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: label }));
        dialog = await screen.findByRole("dialog");
        fireEvent.click(within(dialog).getByRole("button", { name: label }));
        await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(1));
        expect((await getCatalog(db)).banks).toHaveLength(0);
        expect(await getSimulation(db, id)).not.toBeNull();
        cleanup();
        render(provider(<DeleteButton kind="simulation" id={id} />));
        fireEvent.click(screen.getByRole("button", { name: label }));
        dialog = await screen.findByRole("dialog");
        fireEvent.click(within(dialog).getByRole("button", { name: label }));
        await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(2));
        expect(await getSimulation(db, id)).toBeNull();
        const history = markup(await SimulationsPage());
        expect(history).toContain(locale === "it" ? "Le simulazioni completate appariranno qui." : "Completed simulations will appear here.");
    });
});
