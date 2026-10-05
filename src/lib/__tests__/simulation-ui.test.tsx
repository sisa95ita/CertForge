// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { importQuestionBank } from "../import-service";
import { createSimulation, getSimulation, saveAnswers, confirmTrainingAnswer, submitSimulation } from "../simulation-service";
import { testBank } from "./fixtures";
import { NewSimulationForm } from "@/app/[locale]/simulations/new/new-simulation-form";
import { SimulationRunner } from "@/app/[locale]/simulations/[id]/simulation-runner";
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

const databases: ReturnType<typeof database.createTestDb>[] = [];
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); navigation.locale = "en"; navigation.pathname = "/en/simulations"; databases.splice(0).forEach((db) => db.close()); });
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
    const html = markup(createElement(NewSimulationForm, { catalog }));
    expect(html).toContain("All available (4)"); expect(html).toContain("Custom"); expect(html).toContain('max="4"');
    const empty = markup(createElement(NewSimulationForm, { catalog: { ...catalog, inventory: [] } }));
    expect(empty).toContain("All available (0)"); expect(empty).toMatch(/<button[^>]*disabled=""[^>]*type="submit"/);
  });
  it.each(["training", "exam"] as const)("shows required count, blocks excess options and hides feedback in %s", (mode) => {
    const { db, id, p } = setup(mode); saveAnswers(db, id, p, ["a", "b"]);
    const initial = getSimulation(db, id)!; initial.currentPosition = p;
    const html = markup(createElement(SimulationRunner, { initial }));
    expect(html).toContain("Select 2 answers.");
    const inputs = [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((m) => m[0]);
    expect(inputs).toHaveLength(4); expect(inputs.filter((input) => input.includes("disabled"))).toHaveLength(2);
    expect(inputs.filter((input) => input.includes("checked")).every((input) => !input.includes("disabled"))).toBe(true);
    expect(html).not.toContain("Selected correctly"); expect(html).not.toContain("Correct answer");
  });
  it("renders amber partial training feedback with component credit", () => {
    const { db, id, p } = setup("training"); saveAnswers(db, id, p, ["a", "b"]); confirmTrainingAnswer(db, id, p);
    const initial = getSimulation(db, id)!; initial.currentPosition = p;
    const html = markup(createElement(SimulationRunner, { initial }));
    expect(html).toContain("Partially correct"); expect(html).toContain("1 / 2 components correct (50.0% credit)");
    expect(html).toContain("Selected correctly"); expect(html).toContain("Selected incorrectly"); expect(html).toContain("learn.microsoft.com");
  });
  it("shows partial results, answer details, and distinct progress and attempt history with Retry", async () => {
    const { db, id, p } = setup("exam"); saveAnswers(db, id, p, ["a", "b"]); submitSimulation(db, id);
    const html = markup(await ResultsPage({ params: Promise.resolve({ id, locale: navigation.locale }) }));
    expect(html).toContain("12.5%"); expect(html).toContain("Partially correct"); expect(html).toContain("1 / 2 components correct");
    expect(html).toContain("Correct selection"); expect(html).toContain("Incorrect selection"); expect(html).toContain("Retry"); expect(html).toContain("learn.microsoft.com");
    const history = markup(await SimulationsPage());
    for (const text of ["Progress overview", "History", "Review", "Retry", "Recent average"]) expect(history).toContain(text);
  });
});

describe("CertForge localization", () => {
  it.each(["it", "en"] as const)("renders home, import, setup and history in %s", async (locale) => {
    navigation.locale = locale;
    navigation.pathname = `/${locale}/simulations`;
    const { db, id } = setup("training");
    const home = markup(await Home());
    expect(home).toContain(locale === "it" ? "Importa raccolte di domande" : "Import Question Banks");
    expect(home).toContain(`href="/${locale}/import"`);
    const imported = markup(await ImportPage());
    expect(imported).toContain(locale === "it" ? "Scegli i file" : "Choose files");
    const form = markup(createElement(NewSimulationForm, { catalog: getCatalog(db) as Parameters<typeof NewSimulationForm>[0]["catalog"] }));
    for (const value of locale === "it" ? ["Allenamento", "Esame", "Avvia allenamento", "4 domande", "Certificazione", "Area", "Argomento"] : ["Training", "Exam", "Start Training", "4 questions", "Certification", "Domain", "Topic"]) expect(form).toContain(value);
    expect(form).toContain("Generic certification");
    const history = markup(await SimulationsPage());
    expect(history).toContain(locale === "it" ? "Riprendi una simulazione" : "Continue Simulation");
    expect(history).toContain(locale === "it" ? "4 domande" : "4 questions");
    expect(history).toContain(`href="/${locale}/simulations/${id}"`);
    expect(history).toContain(locale === "it" ? "Le simulazioni completate appariranno qui." : "Completed simulations will appear here.");
  });

  it.each(["it", "en"] as const)("renders training feedback, exam controls and results in %s without altering bank content", async (locale) => {
    navigation.locale = locale;
    const { db, id, p } = setup("training");
    saveAnswers(db, id, p, ["a", "b"]); confirmTrainingAnswer(db, id, p);
    const initial = getSimulation(db, id)!; initial.currentPosition = p;
    const before = JSON.stringify(getSimulation(db, id));
    const changes = db.prepare("SELECT total_changes() AS count").get();
    const html = markup(createElement(SimulationRunner, { initial }));
    expect(html).toContain(locale === "it" ? "Seleziona 2 risposte." : "Select 2 answers.");
    expect(html).toContain(locale === "it" ? "Parzialmente corretta" : "Partially correct");
    expect(html).toContain(locale === "it" ? "Precedente" : "Previous");
    expect(html).toContain(locale === "it" ? "Successiva" : "Next");
    for (const text of [initial.questions[p].question.question, initial.questions[p].question.explanation, "Learn", "https://learn.microsoft.com/en-us/training/", "D1", "T1", "medium"]) expect(html).toContain(text);
    expect(JSON.stringify(getSimulation(db, id))).toBe(before);
    expect(db.prepare("SELECT total_changes() AS count").get()).toEqual(changes);
    submitSimulation(db, id);
    const resultsBefore = JSON.stringify(getSimulation(db, id));
    const results = markup(await ResultsPage({ params: Promise.resolve({ id, locale }) }));
    expect(results).toContain(locale === "it" ? "La tua risposta" : "Your answer");
    expect(results).toContain(locale === "it" ? "Riprova" : "Retry");
    expect(results).toContain(locale === "it" ? "12,5%" : "12.5%");
    for (const question of initial.questions) { expect(results).toContain(question.question.question); expect(results).toContain(question.question.explanation); }
    expect(JSON.stringify(getSimulation(db, id))).toBe(resultsBefore);
    const exam = setup("exam");
    const examHtml = markup(createElement(SimulationRunner, { initial: getSimulation(exam.db, exam.id)! }));
    expect(examHtml).toContain(locale === "it" ? "Tempo rimasto" : "Time left");
    expect(examHtml).toContain(locale === "it" ? "Segna da rivedere" : "Mark for review");
    expect(examHtml).toContain(locale === "it" ? "Consegna esame" : "Submit exam");
  });

  it.each(["it", "en"] as const)("preserves the current simulation ID, query, fragment and data when switching from %s", (locale) => {
    navigation.locale = locale;
    const targetLocale = locale === "it" ? "en" : "it";
    const { db, id, p } = setup("exam"); saveAnswers(db, id, p, ["a", "b"]);
    const snapshot = JSON.stringify(getSimulation(db, id));
    const changes = db.prepare("SELECT total_changes() AS count").get();
    navigation.pathname = `/${locale}/simulations/${id}`;
    window.history.replaceState({}, "", navigation.pathname + "?view=question#answers");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(provider(createElement(LanguageSwitcher)));
    fireEvent.click(screen.getByRole("button", { name: locale === "it" ? "Inglese" : "Italian" }));
    expect(navigation.replace).toHaveBeenCalledWith(`/${targetLocale}/simulations/${id}?view=question#answers`, { scroll: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(JSON.stringify(getSimulation(db, id))).toBe(snapshot);
    expect(db.prepare("SELECT total_changes() AS count").get()).toEqual(changes);
    // The next locale route reads the same saved selections and position.
    navigation.locale = targetLocale;
    const reloaded = getSimulation(db, id)!; reloaded.currentPosition = p;
    const html = markup(createElement(SimulationRunner, { initial: reloaded }));
    expect([...html.matchAll(/<input[^>]*checked=""/g)]).toHaveLength(2);
    expect(html).toContain(targetLocale === "it" ? "Seleziona 2 risposte." : "Select 2 answers.");
  });

  it.each(["it", "en"] as const)("preserves %s in completed and active simulation redirects", async (locale) => {
    navigation.locale = locale;
    const { db, id } = setup("training");
    await expect(ResultsPage({ params: Promise.resolve({ id, locale }) })).rejects.toThrow(`REDIRECT:/${locale}/simulations/${id}`);
    submitSimulation(db, id);
    await expect(SimulationPage({ params: Promise.resolve({ id, locale }) })).rejects.toThrow(`REDIRECT:/${locale}/simulations/${id}/results`);
  });

  it.each(["it", "en"] as const)("preserves %s when creating or retrying a simulation", async (locale) => {
    navigation.locale = locale;
    const { db, id } = setup("training");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "next-id" }) }); vi.stubGlobal("fetch", fetchMock);
    render(provider(createElement(NewSimulationForm, { catalog: getCatalog(db) as Parameters<typeof NewSimulationForm>[0]["catalog"] })));
    fireEvent.click(screen.getByRole("button", { name: locale === "it" ? "Avvia allenamento" : "Start Training" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/${locale}/simulations/next-id`));
    expect(fetchMock).toHaveBeenCalledWith("/api/simulations", expect.objectContaining({ method: "POST" }));
    cleanup(); navigation.push.mockClear();
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
    for (const value of ["English bank title", "2 domande importate", "aggiornata dalla versione 1 alla 2", "già importata", "Raccolta di domande non valida", "Gli ID delle opzioni di risposta devono essere univoci", "JSON non valido"]) expect(text).toContain(value);
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
