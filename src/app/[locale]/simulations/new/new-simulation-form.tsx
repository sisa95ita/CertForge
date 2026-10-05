"use client";

import { useMemo, useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { translateError } from "@/i18n/errors";
import { presentation } from "@/i18n/format";
import type { SimulationMode } from "@/lib/types";

interface Catalog {
  banks: { id: string; title: string; certificationName: string; certificationCode: string; version: number; questionCount: number }[];
  facets: { certificationName: string; certificationCode: string; domain: string; topic: string }[];
  inventory: { bankId: string; certificationCode: string; domain: string; topic: string }[];
}

export function NewSimulationForm({ catalog }: { catalog: Catalog }) {
  const router = useRouter();
  const t = useTranslations("NewSimulation");
  const c = useTranslations("Common");
  const errors = useTranslations("Errors");
  const f = presentation(useLocale());
  const [mode, setMode] = useState<SimulationMode>("training");
  const [bankIds, setBankIds] = useState<string[]>([]);
  const [certification, setCertification] = useState(""); const [domain, setDomain] = useState(""); const [topic, setTopic] = useState("");
  const [countMode, setCountMode] = useState<"all" | "custom">("all");
  const [questionCount, setQuestionCount] = useState(10); const [duration, setDuration] = useState(15);
  const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const matching = useMemo(() => catalog.inventory.filter((item) => (!bankIds.length || bankIds.includes(item.bankId)) && (!certification || item.certificationCode === certification) && (!domain || item.domain === domain) && (!topic || item.topic === topic)), [catalog.inventory, bankIds, certification, domain, topic]);
  const domains = [...new Set(catalog.inventory.filter((item) => (!bankIds.length || bankIds.includes(item.bankId)) && (!certification || item.certificationCode === certification)).map((item) => item.domain))].sort();
  const topics = [...new Set(catalog.inventory.filter((item) => (!bankIds.length || bankIds.includes(item.bankId)) && (!certification || item.certificationCode === certification) && (!domain || item.domain === domain)).map((item) => item.topic))].sort();
  const certifications = [...new Map(catalog.facets.map((item) => [item.certificationCode, item.certificationName])).entries()];
  const max = matching.length;
  const customCount = max ? Math.min(Math.max(1, Number.isFinite(questionCount) ? Math.floor(questionCount) : 1), max) : 0;
  const actualCount = countMode === "all" ? max : customCount;

  function toggleBank(id: string) { setBankIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); setDomain(""); setTopic(""); }
  async function start(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      if (!max) throw new Error("noQuestions");
      const response = await fetch("/api/simulations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, bankIds, certification: certification || undefined, domain: domain || undefined, topic: topic || undefined, questionCount: actualCount, durationMinutes: mode === "exam" ? duration : undefined }) });
      const body = await response.json() as { id?: string; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error ?? "createFailed");
      router.push(`/simulations/${body.id}`);
    } catch (value) { setError(value instanceof Error ? value.message : "createFailed"); setLoading(false); }
  }
  if (!catalog.banks.length) return <div className="card mt-7 p-7 text-center"><p className="font-bold">{t("noBanks")}</p><Link className="btn btn-primary mt-4" href="/import">{t("importBank")}</Link></div>;
  return <form onSubmit={start} className="mt-7 space-y-6">
    <fieldset><legend className="label">{t("mode")}</legend><div className="grid gap-3 sm:grid-cols-2"><ModeCard active={mode === "training"} title={c("training")} text={t("trainingDescription")} onClick={() => setMode("training")} /><ModeCard active={mode === "exam"} title={c("exam")} text={t("examDescription")} onClick={() => setMode("exam")} /></div></fieldset>
    <div className="card p-6"><fieldset><legend className="font-extrabold">{t("banks")}</legend><p className="muted mt-1 text-sm">{t("allBanks")}</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{catalog.banks.map((bank) => <label className="flex gap-3 rounded-lg border border-slate-200 p-3" key={bank.id}><input type="checkbox" checked={bankIds.includes(bank.id)} onChange={() => toggleBank(bank.id)} /><span><strong className="block">{bank.title}</strong><span className="muted text-xs">{t("bankDetails", {code: bank.certificationCode, version: f.number(bank.version), count: bank.questionCount})}</span></span></label>)}</div></fieldset></div>
    <div className="card grid gap-4 p-6 sm:grid-cols-3"><div><label className="label" htmlFor="cert">{c("certification")}</label><select id="cert" className="field" value={certification} onChange={(e) => { setCertification(e.target.value); setDomain(""); setTopic(""); }}><option value="">{c("all")}</option>{certifications.map(([code, name]) => <option value={code} key={code}>{code} — {name}</option>)}</select></div><div><label className="label" htmlFor="domain">{c("domain")}</label><select id="domain" className="field" value={domain} onChange={(e) => { setDomain(e.target.value); setTopic(""); }}><option value="">{c("all")}</option>{domains.map((item) => <option key={item}>{item}</option>)}</select></div><div><label className="label" htmlFor="topic">{c("topic")}</label><select id="topic" className="field" value={topic} onChange={(e) => setTopic(e.target.value)}><option value="">{c("all")}</option>{topics.map((item) => <option key={item}>{item}</option>)}</select></div></div>
    <div className="card grid gap-5 p-6 sm:grid-cols-2"><fieldset><legend className="label">{c("questionsLabel")}</legend><div className="mt-2 space-y-3"><label className="flex items-center gap-3"><input type="radio" name="count-mode" checked={countMode === "all"} onChange={() => setCountMode("all")} />{t("allAvailable", {count: f.number(max)})}</label><div className="flex items-center gap-3"><label className="flex items-center gap-3"><input type="radio" name="count-mode" checked={countMode === "custom"} onChange={() => setCountMode("custom")} />{t("custom")}</label><input aria-label={t("customCount")} id="count" className="field max-w-28" type="number" min={1} max={Math.max(1, max)} disabled={countMode !== "custom" || !max} value={customCount} onChange={(e) => setQuestionCount(Number(e.target.value))} /></div></div></fieldset>{mode === "exam" && <div><label className="label" htmlFor="duration">{t("duration")}</label><input id="duration" className="field" type="number" min={1} max={1440} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></div>}</div>
    {error && <p role="alert" className="bad">{translateError(errors, error, "createFailed")}</p>}<button disabled={loading || !max} className="btn btn-primary" type="submit">{loading ? c("starting") : t(mode === "exam" ? "startExam" : "startTraining")}</button>
  </form>;
}

function ModeCard({ active, title, text, onClick }: { active: boolean; title: string; text: string; onClick: () => void }) { return <button type="button" onClick={onClick} className={`card p-5 text-left ${active ? "border-2 border-blue-600 bg-blue-50" : ""}`}><span className="block text-lg font-extrabold">{title}</span><span className="muted mt-1 block text-sm leading-6">{text}</span></button>; }
