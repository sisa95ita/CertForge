import Link from "next/link";
import { RetryButton } from "./retry-button";
import { getDb } from "@/lib/db";
import { listSimulations, progressOverview } from "@/lib/history-service";
import { formatDuration } from "@/lib/statistics";

export const dynamic = "force-dynamic";

export default function SimulationsPage() {
  const db = getDb();
  const simulations = listSimulations(db);
  const active = simulations.filter((item) => item.status === "in-progress");
  const history = simulations.filter((item) => item.status === "completed");
  const overview = progressOverview(db);
  return <div>
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-black tracking-tight">Simulations</h1><p className="muted mt-2">Practice, resume, and review your progress.</p></div><Link className="btn btn-primary" href="/simulations/new">New Simulation</Link></div>

    {active.length > 0 && <section className="mt-8"><h2 className="text-xl font-extrabold">Continue Simulation</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">{active.map((item) => <Link className="card flex items-center justify-between p-5 hover:border-blue-300" href={`/simulations/${item.id}`} key={item.id}><div><div className="font-bold">{item.certifications.join(", ") || "Mixed certification"}</div><div className="muted mt-1 text-sm capitalize">{item.mode} · {item.questionCount} questions · started {new Date(item.createdAt).toLocaleString()}</div></div><span aria-hidden>→</span></Link>)}</div></section>}

    {overview.completed > 0 && <section className="mt-9"><h2 className="text-xl font-extrabold">Progress overview</h2><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="card p-5"><div className="muted text-sm">Average score</div><div className="mt-1 text-3xl font-black">{overview.average.toFixed(1)}%</div></div><div className="card p-5"><div className="muted text-sm">Recent average</div><div className="mt-1 text-3xl font-black">{overview.recentAverage.toFixed(1)}%</div><div className="muted text-xs">Last {overview.recent.length} completed attempts</div></div>{overview.byMode.map((item) => <div className="card p-5" key={item.mode}><div className="muted text-sm capitalize">{item.mode} average</div><div className="mt-1 text-3xl font-black">{item.count ? `${item.average.toFixed(1)}%` : "—"}</div><div className="muted text-xs">{item.count} completed</div></div>)}</div>
      <div className="mt-3 grid gap-3 md:grid-cols-2"><Breakdown title="By domain" items={overview.byDomain} /><Breakdown title="By topic" items={overview.byTopic} /></div>
    </section>}

    <section className="mt-9"><h2 className="text-xl font-extrabold">History</h2>{history.length === 0 ? <div className="card muted mt-3 p-7 text-center">Completed simulations will appear here.</div> : <div className="card mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50"><tr>{["Date", "Certification", "Mode", "Score", "Questions", "Duration", ""].map((label) => <th className="p-3 font-bold" key={label}>{label}</th>)}</tr></thead><tbody>{history.map((item) => <tr className="border-b border-slate-100 last:border-0" key={item.id}><td className="whitespace-nowrap p-3">{new Date(item.createdAt).toLocaleDateString()}</td><td className="p-3">{item.certifications.join(", ")}</td><td className="p-3 capitalize">{item.mode}</td><td className="p-3 font-bold">{item.scorePercent?.toFixed(1)}%</td><td className="p-3">{item.questionCount}</td><td className="whitespace-nowrap p-3">{formatDuration(item.durationSeconds)}</td><td className="p-3"><Link className="font-bold text-blue-700" href={`/simulations/${item.id}/results`}>Review</Link><RetryButton simulationId={item.id} /></td></tr>)}</tbody></table></div>}</section>
  </div>;
}

function Breakdown({ title, items }: { title: string; items: { name: string; percent: number; correct: number; credit: number; total: number }[] }) {
  return <div className="card p-5"><h3 className="font-extrabold">{title}</h3>{items.length === 0 ? <p className="muted mt-3 text-sm">No results yet.</p> : <div className="mt-3 space-y-3">{items.slice(0, 8).map((item) => <div key={item.name}><div className="mb-1 flex justify-between gap-4 text-sm"><span>{item.name}</span><span className="muted">{item.credit.toFixed(1)}/{item.total} credit · {item.percent.toFixed(1)}%</span></div><div className="h-2 overflow-hidden rounded bg-slate-100"><div className="h-full bg-blue-600" style={{ width: `${item.percent}%` }} /></div></div>)}</div>}</div>;
}
