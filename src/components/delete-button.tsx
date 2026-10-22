"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { translateError } from "@/i18n/errors";
import { ConfirmationDialog } from "./confirmation-dialog";

export function DeleteButton({ kind, id, name }: { kind: "bank" | "simulation"; id: string; name?: string }) {
  const t = useTranslations("Management");
  const c = useTranslations("Common");
  const errors = useTranslations("Errors");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setBusy(true); setError("");
    try {
      const response = await fetch(kind === "bank" ? `/api/catalog/${encodeURIComponent(id)}` : `/api/simulations/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error ?? "deleteFailed");
      }
      setOpen(false); router.refresh();
    } catch (value) { setError(value instanceof Error ? value.message : "deleteFailed"); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className="ml-3 font-bold text-red-700" onClick={() => { setError(""); setOpen(true); }}>{c("delete")}</button>
    {open && <ConfirmationDialog title={t(kind === "bank" ? "deleteBank" : "deleteSimulation")}
      cancelLabel={c("cancel")} confirmLabel={c("delete")} busy={busy} onCancel={() => setOpen(false)} onConfirm={remove}>
      <p>{kind === "bank" ? t("deleteBankDescription", { title: name ?? "" }) : t("deleteSimulationDescription")}</p>
      {error && <p role="alert" className="bad mt-3">{translateError(errors, error, "deleteFailed")}</p>}
    </ConfirmationDialog>}
  </>;
}
