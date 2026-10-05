import { getTranslations } from "next-intl/server";
import { ImportPanel } from "./import-panel";

export default async function ImportPage() {
  const t = await getTranslations("Import");
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-black tracking-tight">{t("title")}</h1>
      <p className="muted mt-2">{t("description")}</p>
      <ImportPanel />
    </div>
  );
}
