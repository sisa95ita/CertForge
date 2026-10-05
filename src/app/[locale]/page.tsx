import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

export default async function Home() {
  const t = await getTranslations("Home");
  return (
    <div className="mx-auto max-w-3xl py-16 text-center">
      <p className="mb-3 text-sm font-bold uppercase tracking-[.22em] text-blue-700">{t("eyebrow")}</p>
      <h1 className="text-5xl font-black tracking-tight">CertForge</h1>
      <p className="muted mx-auto mt-5 max-w-xl text-lg leading-8">{t("description")}</p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Link className="card p-7 text-left transition hover:-translate-y-0.5 hover:border-blue-300" href="/import">
          <span className="text-xl font-extrabold">{t("importTitle")}</span>
          <span className="muted mt-2 block">{t("importDescription")}</span>
        </Link>
        <Link className="card p-7 text-left transition hover:-translate-y-0.5 hover:border-blue-300" href="/simulations">
          <span className="text-xl font-extrabold">{t("simulationsTitle")}</span>
          <span className="muted mt-2 block">{t("simulationsDescription")}</span>
        </Link>
      </div>
    </div>
  );
}
