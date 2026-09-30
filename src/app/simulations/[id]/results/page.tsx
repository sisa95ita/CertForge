import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSimulation } from "@/lib/simulation-service";
import { formatDuration, simulationStatistics } from "@/lib/statistics";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const simulation = getSimulation(getDb(), id);
  if (!simulation) notFound();
  if (simulation.status !== "completed") redirect(`/simulations/${id}`);
  const stats = simulationStatistics(simulation);
  return <div className="mx-auto max-w-5xl">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><span className="badge capitalize">{simulation.mode} results</span><h1 className="mt-2 text-4xl font-black tracking-tight">{stats.percent.toFixed(0)}%</h1><p className="muted mt-1">Completed {simulation.completedAt ? new Date(simulation.completedAt).toLocaleString() : ""}</p></div><Link className="btn" href="/simulations">Back to simulations</Link></div>
    <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="Correct" value={String(stats.correct)} tone="good" /><Stat label="Incorrect" value={String(stats.incorrect)} tone="bad" /><Stat label="Questions" value={String(stats.total)} /><Stat label="Duration" value={formatDuration(stats.durationSeconds)} /></div>
    <div className="mt-7 grid gap-4 md:grid-cols-2"><Breakdown title="Performance by domain" items={stats.byDomain} /><Breakdown title="Performance by topic" items={stats.byTopic} /></div>
    <section className="mt-10"><h2 className="text-2xl font-black">Question review</h2><div className="mt-4 space-y-4">{simulation.questions.map((item) => {
      const answerText = (ids: string[]) => ids.length ? ids.map((id) => item.question.answers.find((option) => option.id === id)?.text ?? id).join("; ") : "No answer";
      return <article className={`card border-l-4 p-6 ${item.correct ? "border-l-green-500" : "border-l-red-500"}`} key={item.position}><div className="flex flex-wrap items-center justify-between gap-2"><span className={`font-extrabold ${item.correct ? "good" : "bad"}`}>{item.correct ? "Correct" : "Incorrect"}</span><span className="muted text-sm">Question {item.position + 1}</span></div><h3 className="mt-3 text-lg font-extrabold leading-7">{item.question.question}</h3><dl className="mt-4 grid gap-3 text-sm"><div><dt className="font-bold">Your answer</dt><dd className="muted mt-1">{answerText(item.selectedAnswers)}</dd></div><div><dt className="font-bold">Correct answer</dt><dd className="muted mt-1">{answerText(item.question.correctAnswers)}</dd></div></dl><div className="mt-4 rounded-lg bg-slate-50 p-4 leading-7">{item.question.explanation}</div><div className="muted mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs"><span>Domain: {item.question.domain}</span><span>Topic: {item.question.topic}</span><span className="capitalize">Difficulty: {item.question.difficulty}</span><span>Bank: {item.question.bankTitle}</span></div>{item.question.learnReference && <a className="mt-4 inline-block font-bold text-blue-700 underline" href={item.question.learnReference.url} target="_blank" rel="noreferrer">{item.question.learnReference.title} ↗</a>}</article>;
    })}</div></section>
  </div>;
}

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) { return <div className="card p-5"><div className="muted text-sm">{label}</div><div className={`mt-1 text-2xl font-black ${tone}`}>{value}</div></div>; }
function Breakdown({ title, items }: { title: string; items: { name: string; correct: number; total: number; percent: number }[] }) { return <div className="card p-5"><h2 className="font-extrabold">{title}</h2><div className="mt-4 space-y-3">{items.map((item) => <div key={item.name}><div className="flex justify-between gap-3 text-sm"><span>{item.name}</span><span className="muted">{item.correct}/{item.total} · {item.percent.toFixed(0)}%</span></div><div className="mt-1 h-2 overflow-hidden rounded bg-slate-100"><div className="h-full bg-blue-600" style={{ width: `${item.percent}%` }} /></div></div>)}</div></div>; }
