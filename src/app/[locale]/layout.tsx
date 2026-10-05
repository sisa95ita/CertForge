import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { LanguageSwitcher } from "./language-switcher";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: "Home" });
  return { title: "CertForge", description: t("metadata") };
}

export default async function LocaleLayout({ children, params }: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations("Navigation");
  return <html lang={locale}><body><NextIntlClientProvider>
    <header className="border-b border-slate-200 bg-white"><div className="shell flex h-16 items-center justify-between gap-3">
      <Link href="/" className="text-xl font-extrabold tracking-tight">CertForge</Link>
      <nav aria-label={t("main")} className="flex items-center gap-3 text-sm font-semibold sm:gap-5"><Link href="/import">{t("import")}</Link><Link href="/simulations">{t("simulations")}</Link><LanguageSwitcher /></nav>
    </div></header>
    <main className="shell py-8">{children}</main>
  </NextIntlClientProvider></body></html>;
}
