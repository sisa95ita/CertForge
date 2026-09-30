import { getDb } from "@/lib/db";
import { getCatalog } from "@/lib/simulation-service";
import { NewSimulationForm } from "./new-simulation-form";

export const dynamic = "force-dynamic";

export default function NewSimulationPage() {
  const catalog = getCatalog(getDb()) as Parameters<typeof NewSimulationForm>[0]["catalog"];
  return <div className="mx-auto max-w-4xl"><h1 className="text-3xl font-black tracking-tight">New Simulation</h1><p className="muted mt-2">Choose a mode and narrow the question pool if needed.</p><NewSimulationForm catalog={catalog} /></div>;
}
