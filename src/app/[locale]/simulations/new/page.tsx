import { getTranslations } from "next-intl/server";
import { getDataSource } from "@/lib/db";
import { getCatalog } from "@/lib/simulation-service";
import { NewSimulationForm } from "./new-simulation-form";

export const dynamic = "force-dynamic";

export default async function NewSimulationPage() {
  const t = await getTranslations("NewSimulation");
  const catalog = (await getCatalog(await getDataSource())) as Parameters<typeof NewSimulationForm>[0]["catalog"];
  return <div className="mx-auto max-w-4xl"><h1 className="text-3xl font-black tracking-tight">{t("title")}</h1><p className="muted mt-2">{t("description")}</p><NewSimulationForm catalog={catalog} /></div>;
}
