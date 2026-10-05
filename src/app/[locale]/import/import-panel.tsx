"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { translateError } from "@/i18n/errors";
import { presentation } from "@/i18n/format";
import type { ImportResult } from "@/lib/import-service";

export function ImportPanel() {
  const t = useTranslations("Import");
  const errors = useTranslations("Errors");
  const f = presentation(useLocale());
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [error, setError] = useState("");

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((current) => {
      const next = [...current];
      for (const file of Array.from(list)) if (!next.some((item) => item.name === file.name && item.size === file.size)) next.push(file);
      return next;
    });
    setResults(null); setError("");
  }

  async function submit() {
    setLoading(true); setError("");
    const data = new FormData();
    files.forEach((file) => data.append("files", file));
    try {
      const response = await fetch("/api/import", { method: "POST", body: data });
      const body = await response.json() as { results?: ImportResult[]; error?: string };
      if (!response.ok || !body.results) throw new Error(body.error ?? "importFailed");
      setResults(body.results); setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
    } catch (value) { setError(value instanceof Error ? value.message : "importFailed"); }
    finally { setLoading(false); }
  }

  const imported = results?.filter((result) => result.status === "imported").reduce((sum, result) => sum + result.questions, 0) ?? 0;
  const updated = results?.filter((result) => result.status === "updated").length ?? 0;
  const skipped = results?.filter((result) => result.status === "skipped").length ?? 0;
  const failed = results?.filter((result) => result.status === "failed").length ?? 0;

  return (
    <div className="mt-7 space-y-5">
      <div
        className={`card flex min-h-52 flex-col items-center justify-center border-2 border-dashed p-7 text-center ${dragging ? "border-blue-500 bg-blue-50" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
      >
        <div className="text-lg font-extrabold">{t("drop")}</div>
        <div className="muted my-2 text-sm">{t("or")}</div>
        <button className="btn" type="button" onClick={() => inputRef.current?.click()}>{t("choose")}</button>
        <input ref={inputRef} aria-label={t("choose")} className="sr-only" type="file" accept="application/json,.json" multiple onChange={(event) => addFiles(event.target.files)} />
      </div>
      {files.length > 0 && <div className="card p-5"><div className="font-bold">{t("ready")}</div><ul className="muted mt-2 list-inside list-disc text-sm">{files.map((file) => <li key={`${file.name}-${file.size}`}>{file.name}</li>)}</ul><button disabled={loading} className="btn btn-primary mt-4" onClick={submit}>{loading ? t("importing") : t("importFiles", {count: files.length})}</button></div>}
      {error && <div role="alert" className="card border-red-300 bg-red-50 p-4 bad">{translateError(errors, error, "importFailed")}</div>}
      {results && <section className="card p-6" aria-live="polite">
        <h2 className="text-xl font-extrabold">{t("completed")}</h2>
        <div className="mt-4 space-y-3">{results.map((result, index) => <div key={index} className="border-b border-slate-100 pb-3 last:border-0">
          <div><span aria-hidden>{result.status === "imported" ? "✓" : result.status === "updated" ? "↑" : result.status === "skipped" ? "—" : "✕"}</span> <strong>{result.status === "failed" && result.title === "Invalid question bank" ? t("invalidTitle") : result.title}</strong> — {result.status === "imported" ? t("imported", {count: result.questions}) : result.status === "updated" ? t("updated", {previous: f.number(result.previousVersion), version: f.number(result.version)}) : result.status === "skipped" ? t(result.reason === "same-version" ? "sameVersion" : "newerInstalled") : t("failed")}</div>
          {result.status === "failed" && <ul className="bad mt-1 list-inside list-disc text-sm">{result.errors.map((item) => <li key={item}>{translateError(errors, item, "validationFailed")}</li>)}</ul>}
        </div>)}</div>
        <div className="muted mt-4 text-sm">{t("summary", {imported, updated, skipped, failed})}</div>
      </section>}
    </div>
  );
}
