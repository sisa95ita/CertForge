"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SimulationMode } from "@/lib/types";

interface Catalog {
  banks: { id: string; title: string; certificationName: string; certificationCode: string; version: number; questionCount: number }[];
  facets: { certificationName: string; certificationCode: string; domain: string; topic: string }[];
  inventory: { bankId: string; certificationCode: string; domain: string; topic: string }[];
}

export function NewSimulationForm({ catalog }: { catalog: Catalog }) {
  const router = useRouter();
  const [mode, setMode] = useState<SimulationMode>("training");
  const [bankIds, setBankIds] = useState<string[]>([]);
  const [certification, setCertification] = useState(""); const [domain, setDomain] = useState(""); const [topic, setTopic] = useState("");
  const [questionCount, setQuestionCount] = useState(10); const [duration, setDuration] = useState(15);
  const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const matching = useMemo(() => catalog.inventory.filter((item) => (!bankIds.length || bankIds.includes(item.bankId)) && (!certification || item.certificationCode === certification) && (!domain || item.domain === domain) && (!topic || item.topic === topic)), [catalog.inventory, bankIds, certification, domain, topic]);
  const domains = [...new Set(catalog.inventory.filter((item) => (!bankIds.length || bankIds.includes(item.bankId)) && (!certification || item.certificationCode === certification)).map((item) => item.domain))].sort();
  const topics = [...new Set(catalog.inventory.filter((item) => (!bankIds.length || bankIds.includes(item.bankId)) && (!certification || item.certificationCode === certification) && (!domain || item.domain === domain)).map((item) => item.topic))].sort();
  const certifications = [...new Map(catalog.facets.map((item) => [item.certificationCode, item.certificationName])).entries()];
  const max = matching.length;
  const actualCount = Math.min(Math.max(1, questionCount), Math.max(1, max));

  function toggleBank(id: string) { setBankIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); setDomain(""); setTopic(""); }
  async function start(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      if (!max) throw new Error("No questions match these filters");
      const response = await fetch("/api/simulations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, bankIds, certification: certification || undefined, domain: domain || undefined, topic: topic || undefined, questionCount: actualCount, durationMinutes: mode === "exam" ? duration : undefined }) });
      const body = await response.json() as { id?: string; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error ?? "Could not create simulation");
      router.push(`/simulations/${body.id}`);
    } catch (value) { setError(value instanceof Error ? value.message : "Could not create simulation"); setLoading(false); }
  }
  if (!catalog.banks.length) return <div className="card mt-7 p-7 text-center"><p className="font-bold">No question banks are installed.</p><a className="btn btn-primary mt-4" href="/import">Import a question bank</a></div>;
  return <form onSubmit={start} className="mt-7 space-y-6">
    <fieldset><legend className="label">Mode</legend><div className="grid gap-3 sm:grid-cols-2"><ModeCard active={mode === "training"} title="Training" text="Study at your own pace. Get feedback and explanations after confirming each answer." onClick={() => setMode("training")} /><ModeCard active={mode === "exam"} title="Exam" text="Simulate exam conditions. Review answers only after final submission." onClick={() => setMode("exam")} /></div></fieldset>
    <div className="card p-6"><fieldset><legend className="font-extrabold">Question banks</legend><p className="muted mt-1 text-sm">Leave every box clear to use all banks.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{catalog.banks.map((bank) => <label className="flex gap-3 rounded-lg border border-slate-200 p-3" key={bank.id}><input type="checkbox" checked={bankIds.includes(bank.id)} onChange={() => toggleBank(bank.id)} /><span><strong className="block">{bank.title}</strong><span className="muted text-xs">{bank.certificationCode} · v{bank.version} · {bank.questionCount} questions</span></span></label>)}</div></fieldset></div>
    <div className="card grid gap-4 p-6 sm:grid-cols-3"><div><label className="label" htmlFor="cert">Certification</label><select id="cert" className="field" value={certification} onChange={(e) => { setCertification(e.target.value); setDomain(""); setTopic(""); }}><option value="">All</option>{certifications.map(([code, name]) => <option value={code} key={code}>{code} — {name}</option>)}</select></div><div><label className="label" htmlFor="domain">Domain</label><select id="domain" className="field" value={domain} onChange={(e) => { setDomain(e.target.value); setTopic(""); }}><option value="">All</option>{domains.map((item) => <option key={item}>{item}</option>)}</select></div><div><label className="label" htmlFor="topic">Topic</label><select id="topic" className="field" value={topic} onChange={(e) => setTopic(e.target.value)}><option value="">All</option>{topics.map((item) => <option key={item}>{item}</option>)}</select></div></div>
    <div className="card grid gap-5 p-6 sm:grid-cols-2"><div><label className="label" htmlFor="count">Question count <span className="muted font-normal">({max} available)</span></label><input id="count" className="field" type="number" min={1} max={Math.max(1, max)} value={actualCount} onChange={(e) => setQuestionCount(Number(e.target.value))} /></div>{mode === "exam" && <div><label className="label" htmlFor="duration">Duration (minutes)</label><input id="duration" className="field" type="number" min={1} max={1440} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></div>}</div>
    {error && <p role="alert" className="bad">{error}</p>}<button disabled={loading || !max} className="btn btn-primary" type="submit">{loading ? "Starting…" : `Start ${mode === "exam" ? "Exam" : "Training"}`}</button>
  </form>;
}

function ModeCard({ active, title, text, onClick }: { active: boolean; title: string; text: string; onClick: () => void }) { return <button type="button" onClick={onClick} className={`card p-5 text-left ${active ? "border-2 border-blue-600 bg-blue-50" : ""}`}><span className="block text-lg font-extrabold">{title}</span><span className="muted mt-1 block text-sm leading-6">{text}</span></button>; }
