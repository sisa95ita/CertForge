"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { translateError } from "@/i18n/errors";
import { presentation } from "@/i18n/format";
import type { SimulationView } from "@/lib/types";
import { canSelectAnswer } from "@/lib/evaluation";

export function SimulationRunner({ initial }: { initial: SimulationView }) {
  const router = useRouter();
  const t = useTranslations("Simulation");
  const c = useTranslations("Common");
  const errors = useTranslations("Errors");
  const f = presentation(useLocale());
  const [simulation, setSimulation] = useState(initial);
  const [position, setPosition] = useState(initial.currentPosition);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date(initial.startedAt).getTime());
  const autoSubmitting = useRef(false);
  const item = simulation.questions[position];
  const elapsed = Math.max(0, Math.floor((now - new Date(simulation.startedAt).getTime()) / 1000));
  const remaining = simulation.durationLimitSeconds === null ? null : Math.max(0, simulation.durationLimitSeconds - elapsed);

  async function patch(body: Record<string, unknown>): Promise<SimulationView> {
    const response = await fetch(`/api/simulations/${simulation.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const value = await response.json() as SimulationView & { error?: string };
    if (!response.ok) throw new Error(value.error ?? "saveProgress");
    setSimulation(value);
    return value;
  }

  async function submit(skipWarning = false) {
    const unanswered = simulation.questions.filter((question) => !question.selectedAnswers.length).length;
    if (!skipWarning && unanswered && !window.confirm(t("submitWarning", {count: unanswered}))) return;
    setBusy(true); setError("");
    try { await patch({ action: "submit" }); router.push(`/simulations/${simulation.id}/results`); router.refresh(); }
    catch (value) { setError(value instanceof Error ? value.message : "submitFailed"); setBusy(false); }
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (remaining === 0 && simulation.mode === "exam" && !autoSubmitting.current) {
      autoSubmitting.current = true;
      void submit(true);
    }
  // submit intentionally uses the latest render when the countdown changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, simulation.mode]);

  async function choose(optionId: string, checked: boolean) {
    if (busy || item.locked || (checked && item.question.type === "multiple-choice" && !canSelectAnswer(item.selectedAnswers, optionId, item.question.correctAnswers.length))) return;
    const previous = simulation;
    setBusy(true);
    const selected = item.question.type === "single-choice" ? [optionId] : checked ? [...item.selectedAnswers, optionId] : item.selectedAnswers.filter((answer) => answer !== optionId);
    setSimulation((current) => ({ ...current, questions: current.questions.map((question, index) => index === position ? { ...question, selectedAnswers: selected } : question) }));
    setError("");
    try { await patch({ action: "answers", position, answers: selected }); }
    catch (value) { setSimulation(previous); setError(value instanceof Error ? value.message : "saveAnswer"); }
    finally { setBusy(false); }
  }

  async function navigate(next: number) {
    if (busy) return;
    if (next < 0 || next >= simulation.questions.length) return;
    setPosition(next); setError("");
    try { await patch({ action: "navigate", position: next }); } catch (value) { setError(value instanceof Error ? value.message : "savePosition"); }
  }

  async function confirmAnswer() {
    setBusy(true); setError("");
    try { await patch({ action: "confirm", position }); }
    catch (value) { setError(value instanceof Error ? value.message : "confirmAnswer"); }
    finally { setBusy(false); }
  }

  async function toggleReview() {
    const value = !item.forReview;
    setSimulation((current) => ({ ...current, questions: current.questions.map((question, index) => index === position ? { ...question, forReview: value } : question) }));
    try { await patch({ action: "review", position, value }); } catch (reason) { setError(reason instanceof Error ? reason.message : "saveReview"); }
  }

  const partial = item.evaluation?.status === "partial";
  const allTrainingLocked = simulation.questions.every((question) => question.locked);
  return <div className="mx-auto max-w-5xl">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><span className="badge capitalize">{c(simulation.mode)}</span><span className="muted ml-3 text-sm">{t("questionPosition", {position: f.number(position + 1), total: f.number(simulation.questions.length)})}</span></div><div className={`font-mono text-sm font-bold ${remaining !== null && remaining < 60 ? "bad" : ""}`}>{remaining === null ? t("studyTime", {duration: f.duration(elapsed)}) : t("timeLeft", {duration: f.duration(remaining)})}</div></div>
    <div className="grid gap-5 lg:grid-cols-[1fr_250px]">
      <section className="card p-6 sm:p-8">
        <div className="mb-4 flex flex-wrap gap-2"><span className="badge">{item.question.domain}</span><span className="badge">{item.question.topic}</span><span className="badge capitalize">{item.question.difficulty}</span></div>
        <h1 className="text-xl font-extrabold leading-8">{item.question.question}</h1>
        {item.question.type === "multiple-choice" && <p className="muted mt-2 text-sm">{t("selectAnswers", {count: item.question.correctAnswers.length})}</p>}
        <div className="mt-6 space-y-3">{item.question.answers.map((option) => {
          const selected = item.selectedAnswers.includes(option.id); const correctOption = item.question.correctAnswers.includes(option.id);
          const resultStyle = item.locked && correctOption ? "border-green-500 bg-green-50" : item.locked && selected && !correctOption ? "border-red-400 bg-red-50" : selected ? "border-blue-500 bg-blue-50" : "border-slate-200";
          return <label className={`flex gap-3 rounded-xl border-2 p-4 ${resultStyle} ${item.locked ? "cursor-default" : "cursor-pointer"}`} key={option.id}><input disabled={item.locked || busy || (item.question.type === "multiple-choice" && !canSelectAnswer(item.selectedAnswers, option.id, item.question.correctAnswers.length))} type={item.question.type === "single-choice" ? "radio" : "checkbox"} name={`q-${position}`} checked={selected} onChange={(event) => void choose(option.id, event.target.checked)} /><span><strong className="mr-2 uppercase">{option.id}.</strong>{option.text}{item.locked && <span className="ml-2 text-xs font-bold">{correctOption ? t(selected ? "selectedCorrectly" : "correctAnswer") : selected ? t("selectedIncorrectly") : ""}</span>}</span></label>;
        })}</div>
        {simulation.mode === "training" && !item.locked && <button disabled={busy || !item.selectedAnswers.length} className="btn btn-primary mt-6" onClick={confirmAnswer}>{t("confirm")}</button>}
        {simulation.mode === "training" && item.locked && <div className={`mt-6 rounded-xl border p-5 ${item.correct ? "border-green-300 bg-green-50" : partial ? "border-amber-300 bg-amber-50" : "border-red-300 bg-red-50"}`}><h2 className={`font-extrabold ${item.correct ? "good" : partial ? "text-amber-700" : "bad"}`}>{c(item.correct ? "correct" : partial ? "partial" : "incorrect")}</h2>{partial && <p className="mt-1 text-sm text-amber-800">{c("components", {correct: f.number(item.selectedAnswers.filter((id) => item.question.correctAnswers.includes(id)).length), total: f.number(item.question.correctAnswers.length), percent: f.percent((item.evaluation?.score ?? 0) * 100)})}</p>}<p className="mt-2 leading-7">{item.question.explanation}</p>{item.question.learnReference && <a className="mt-3 inline-block font-bold text-blue-700 underline" href={item.question.learnReference.url} target="_blank" rel="noreferrer">{item.question.learnReference.title} ↗</a>}</div>}
        {error && <p className="bad mt-4" role="alert">{translateError(errors, error)}</p>}
        <div className="mt-7 flex flex-wrap justify-between gap-3"><button className="btn" disabled={busy || position === 0} onClick={() => void navigate(position - 1)}>← {c("previous")}</button><div className="flex gap-2">{simulation.mode === "exam" && <button className="btn" disabled={busy} onClick={toggleReview}>{t(item.forReview ? "removeReview" : "markReview")}</button>}{position < simulation.questions.length - 1 ? <button className="btn btn-primary" disabled={busy} onClick={() => void navigate(position + 1)}>{c("next")} →</button> : simulation.mode === "exam" || allTrainingLocked ? <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{t(simulation.mode === "exam" ? "submitExam" : "viewResults")}</button> : null}</div></div>
      </section>
      <aside className="card h-fit p-5"><h2 className="font-extrabold">{t("navigator")}</h2><div className="mt-4 grid grid-cols-5 gap-2">{simulation.questions.map((question, index) => <button disabled={busy} aria-label={t(question.forReview ? "reviewQuestionLabel" : "questionLabel", {position: f.number(index + 1)})} className={`relative aspect-square rounded-lg border text-sm font-bold ${index === position ? "border-blue-600 bg-blue-600 text-white" : question.selectedAnswers.length ? "border-green-300 bg-green-50" : "border-slate-200 bg-white"}`} onClick={() => void navigate(index)} key={index}>{f.number(index + 1)}{question.forReview && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-500" />}</button>)}</div><div className="muted mt-4 space-y-1 text-xs"><div><span className="inline-block h-2.5 w-2.5 rounded bg-green-100" /> {t("answered", {count: f.number(simulation.questions.filter((q) => q.selectedAnswers.length).length)})}</div><div>○ {t("unanswered", {count: f.number(simulation.questions.filter((q) => !q.selectedAnswers.length).length)})}</div>{simulation.mode === "exam" && <div><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" /> {t("forReview", {count: f.number(simulation.questions.filter((q) => q.forReview).length)})}</div>}</div>{simulation.mode === "exam" && <button disabled={busy} className="btn mt-5 w-full" onClick={() => void submit()}>{t("submitExam")}</button>}</aside>
    </div>
  </div>;
}
