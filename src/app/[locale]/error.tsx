"use client";

import { useTranslations } from "next-intl";

export default function ErrorPage({ reset }: { reset: () => void }) {
  const t = useTranslations("Errors");
  return <div role="alert" className="card mx-auto max-w-xl p-8 text-center"><h1 className="text-2xl font-black">{t("unexpected")}</h1><p className="muted mt-3">{t("unexpectedDescription")}</p><button type="button" className="btn mt-5" onClick={reset}>{t("tryAgain")}</button></div>;
}
