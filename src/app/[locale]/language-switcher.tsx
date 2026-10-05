"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations("Navigation");
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <div role="group" aria-label={t("language")} className="flex items-center gap-2 border-l border-slate-200 pl-3">
    {routing.locales.map((value) => <button key={value} type="button" lang={value} aria-label={t(value)} aria-pressed={locale === value} disabled={pending || locale === value} className={locale === value ? "font-extrabold text-blue-700" : "muted"} onClick={() => startTransition(() => router.replace(pathname + window.location.search + window.location.hash, { locale: value, scroll: false }))}>{value.toUpperCase()}</button>)}
  </div>;
}
