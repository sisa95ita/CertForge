import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations("Errors");
  return <div className="card mx-auto max-w-xl p-8 text-center"><h1 className="text-2xl font-black">{t("notFound")}</h1><p className="muted mt-3">{t("notFoundDescription")}</p><Link className="btn mt-5" href="/simulations">{t("back")}</Link></div>;
}
