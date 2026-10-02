"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RetryButton({ simulationId }: { simulationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function retry() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/simulations/${simulationId}/retry`, { method: "POST" });
      const body = await response.json() as { id?: string; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error ?? "Could not retry simulation");
      router.push(`/simulations/${body.id}`);
      router.refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not retry simulation");
      setBusy(false);
    }
  }
  return <span className="ml-4 inline-block"><button type="button" disabled={busy} onClick={() => void retry()} className="font-bold text-blue-700">{busy ? "Starting..." : "Retry"}</button>{error && <span role="alert" className="bad mt-1 block text-xs">{error}</span>}</span>;
}
