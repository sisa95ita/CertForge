import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { getDataSource } from "@/lib/db";
import { getSimulation } from "@/lib/simulation-service";
import { SimulationRunner } from "./simulation-runner";

export const dynamic = "force-dynamic";

export default async function SimulationPage({ params }: { params: Promise<{ id: string; locale: string }> }) {
  const { id, locale } = await params;
  const simulation = await getSimulation(await getDataSource(), id);
  if (!simulation) notFound();
  if (simulation.status === "completed") redirect({ href: `/simulations/${id}/results`, locale });
  return <SimulationRunner initial={simulation} />;
}
