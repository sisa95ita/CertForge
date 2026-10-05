import * as rootParams from "next/root-params";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ locale }) => {
  const value = locale ?? await rootParams.locale();
  if (!hasLocale(routing.locales, value)) notFound();
  return {
    locale: value,
    messages: (await import(`../../messages/${value}.json`)).default,
  };
});
