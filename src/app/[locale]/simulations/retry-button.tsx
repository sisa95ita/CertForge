"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { translateError } from "@/i18n/errors";

export function RetryButton({ simulationId }: { simulationId: string }) {
  const router = useRouter();
  const t = useTranslations("Common");
  const errors = useTranslations("Errors");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function retry() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/simulations/${simulationId}/retry`, { method: "POST" });
      const body = await response.json() as { id?: string; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error ?? "retryFailed");
      router.push(`/simulations/${body.id}`);
      router.refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "retryFailed");
      setBusy(false);
    }
  }
  return <span className="ml-4 inline-block"><button type="button" disabled={busy} onClick={() => void retry()} className="font-bold text-blue-700">{busy ? t("starting") : t("retry")}</button>{error && <span role="alert" className="bad mt-1 block text-xs">{translateError(errors, error, "retryFailed")}</span>}</span>;
}
