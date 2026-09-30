import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSimulation } from "@/lib/simulation-service";
import { SimulationRunner } from "./simulation-runner";

export const dynamic = "force-dynamic";

export default async function SimulationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const simulation = getSimulation(getDb(), id);
  if (!simulation) notFound();
  if (simulation.status === "completed") redirect(`/simulations/${id}/results`);
  return <SimulationRunner initial={simulation} />;
}
