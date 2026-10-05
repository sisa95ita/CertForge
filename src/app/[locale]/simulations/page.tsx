import { Link } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { presentation } from "@/i18n/format";
import { Breakdown } from "./breakdown";
import { RetryButton } from "./retry-button";
import { getDb } from "@/lib/db";
import { listSimulations, progressOverview } from "@/lib/history-service";

export const dynamic = "force-dynamic";

export default async function SimulationsPage() {
  const t = await getTranslations("Simulation");
  const n = await getTranslations("NewSimulation");
  const c = await getTranslations("Common");
  const h = await getTranslations("History");
  const p = await getTranslations("Progress");
  const f = presentation(await getLocale());
  const db = getDb();
  const simulations = listSimulations(db);
  const active = simulations.filter((item) => item.status === "in-progress");
  const history = simulations.filter((item) => item.status === "completed");
  const overview = progressOverview(db);
  return <div>
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-black tracking-tight">{t("title")}</h1><p className="muted mt-2">{t("description")}</p></div><Link className="btn btn-primary" href="/simulations/new">{n("title")}</Link></div>

    {active.length > 0 && <section className="mt-8"><h2 className="text-xl font-extrabold">{t("continue")}</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">{active.map((item) => <Link className="card flex items-center justify-between p-5 hover:border-blue-300" href={`/simulations/${item.id}`} key={item.id}><div><div className="font-bold">{item.certifications.join(", ") || t("mixed")}</div><div className="muted mt-1 text-sm capitalize">{t("activeDetails", {mode: c(item.mode), count: item.questionCount, date: f.dateTime(item.createdAt)})}</div></div><span aria-hidden>→</span></Link>)}</div></section>}

    {overview.completed > 0 && <section className="mt-9"><h2 className="text-xl font-extrabold">{p("title")}</h2><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="card p-5"><div className="muted text-sm">{p("average")}</div><div className="mt-1 text-3xl font-black">{f.percent(overview.average)}</div></div><div className="card p-5"><div className="muted text-sm">{p("recentAverage")}</div><div className="mt-1 text-3xl font-black">{f.percent(overview.recentAverage)}</div><div className="muted text-xs">{p("recent", {count: overview.recent.length})}</div></div>{overview.byMode.map((item) => <div className="card p-5" key={item.mode}><div className="muted text-sm capitalize">{p(item.mode === "exam" ? "examAverage" : "trainingAverage")}</div><div className="mt-1 text-3xl font-black">{item.count ? f.percent(item.average) : "—"}</div><div className="muted text-xs">{p("completed", {count: item.count})}</div></div>)}</div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">{await Breakdown({title: p("byDomain"), items: overview.byDomain, limit: 8})}{await Breakdown({title: p("byTopic"), items: overview.byTopic, limit: 8})}</div>
    </section>}

    <section className="mt-9"><h2 className="text-xl font-extrabold">{h("title")}</h2>{history.length === 0 ? <div className="card muted mt-3 p-7 text-center">{h("empty")}</div> : <div className="card mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50"><tr>{[h("date"), c("certification"), h("mode"), h("score"), c("questionsLabel"), c("duration"), h("actions")].map((label) => <th className="p-3 font-bold" key={label}>{label}</th>)}</tr></thead><tbody>{history.map((item) => <tr className="border-b border-slate-100 last:border-0" key={item.id}><td className="whitespace-nowrap p-3">{f.date(item.createdAt)}</td><td className="p-3">{item.certifications.join(", ")}</td><td className="p-3 capitalize">{c(item.mode)}</td><td className="p-3 font-bold">{item.scorePercent === null ? "—" : f.percent(item.scorePercent)}</td><td className="p-3">{f.number(item.questionCount)}</td><td className="whitespace-nowrap p-3">{f.duration(item.durationSeconds)}</td><td className="p-3"><Link className="font-bold text-blue-700" href={`/simulations/${item.id}/results`}>{h("review")}</Link><RetryButton simulationId={item.id} /></td></tr>)}</tbody></table></div>}</section>
  </div>;
}

