import { Link } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { presentation } from "@/i18n/format";
import { Breakdown } from "../../breakdown";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { RetryButton } from "../../retry-button";
import { getDb } from "@/lib/db";
import { getSimulation } from "@/lib/simulation-service";
import { simulationStatistics } from "@/lib/statistics";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ id: string; locale: string }> }) {
  const { id, locale } = await params;
  const t = await getTranslations("Results");
  const c = await getTranslations("Common");
  const q = await getTranslations("Simulation");
  const f = presentation(await getLocale());
  const simulation = getSimulation(getDb(), id);
  if (!simulation) notFound();
  if (simulation.status !== "completed") redirect({ href: `/simulations/${id}`, locale });
  const stats = simulationStatistics(simulation);
  return <div className="mx-auto max-w-5xl">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><span className="badge capitalize">{t(simulation.mode === "exam" ? "examResults" : "trainingResults")}</span><h1 className="mt-2 text-4xl font-black tracking-tight">{f.percent(stats.percent)}</h1><p className="muted mt-1">{t("completed", {date: simulation.completedAt ? f.dateTime(simulation.completedAt) : ""})}</p></div><div className="flex items-center gap-3"><Link className="btn" href="/simulations">{t("back")}</Link><RetryButton simulationId={id} /></div></div>
    <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-5"><Stat label={c("correct")} value={f.number(stats.correct)} tone="good" /><Stat label={c("partial")} value={f.number(stats.partial)} tone="text-amber-700" /><Stat label={c("incorrect")} value={f.number(stats.incorrect)} tone="bad" /><Stat label={c("questionsLabel")} value={f.number(stats.total)} /><Stat label={c("duration")} value={f.duration(stats.durationSeconds)} /></div>
    <div className="mt-7 grid gap-4 md:grid-cols-2">{await Breakdown({title: t("byDomain"), items: stats.byDomain})}{await Breakdown({title: t("byTopic"), items: stats.byTopic})}</div>
    <section className="mt-10"><h2 className="text-2xl font-black">{t("review")}</h2><div className="mt-4 space-y-4">{simulation.questions.map((item) => {
      const partial = item.evaluation?.status === "partial";
      const answerText = (ids: string[]) => ids.length ? ids.map((id) => item.question.answers.find((option) => option.id === id)?.text ?? id).join("; ") : t("noAnswer");
      return <article className={`card border-l-4 p-6 ${item.correct ? "border-l-green-500" : partial ? "border-l-amber-500" : "border-l-red-500"}`} key={item.position}><div className="flex flex-wrap items-center justify-between gap-2"><span className={`font-extrabold ${item.correct ? "good" : partial ? "text-amber-700" : "bad"}`}>{c(item.correct ? "correct" : partial ? "partial" : "incorrect")}</span><span className="muted text-sm">{q("questionLabel", {position: f.number(item.position + 1)})}</span></div>{partial && <p className="mt-2 text-sm text-amber-800">{c("components", {correct: f.number(item.selectedAnswers.filter((id) => item.question.correctAnswers.includes(id)).length), total: f.number(item.question.correctAnswers.length), percent: f.percent((item.evaluation?.score ?? 0) * 100)})}</p>}<h3 className="mt-3 text-lg font-extrabold leading-7">{item.question.question}</h3><dl className="mt-4 grid gap-3 text-sm"><div><dt className="font-bold">{t("yourAnswer")}</dt><dd className="muted mt-1">{item.selectedAnswers.length ? <ul className="space-y-1">{item.selectedAnswers.map((id) => <li key={id}>{answerText([id])} <span className={item.question.correctAnswers.includes(id) ? "good font-bold" : "bad font-bold"}>({t(item.question.correctAnswers.includes(id) ? "correctSelection" : "incorrectSelection")})</span></li>)}</ul> : t("noAnswer")}</dd></div><div><dt className="font-bold">{t("correctAnswer")}</dt><dd className="muted mt-1">{answerText(item.question.correctAnswers)}</dd></div></dl><div className="mt-4 rounded-lg bg-slate-50 p-4 leading-7">{item.question.explanation}</div><div className="muted mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs"><span>{t("domain", {value: item.question.domain})}</span><span>{t("topic", {value: item.question.topic})}</span><span className="capitalize">{t("difficulty", {value: item.question.difficulty})}</span><span>{t("bank", {value: item.question.bankTitle})}</span></div>{item.question.learnReference && <a className="mt-4 inline-block font-bold text-blue-700 underline" href={item.question.learnReference.url} target="_blank" rel="noreferrer">{item.question.learnReference.title} ↗</a>}</article>;
    })}</div></section>
  </div>;
}

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) { return <div className="card p-5"><div className="muted text-sm">{label}</div><div className={`mt-1 text-2xl font-black ${tone}`}>{value}</div></div>; }
