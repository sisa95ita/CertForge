import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["it", "en"],
  defaultLocale: "it",
  localePrefix: "always",
  // Unprefixed URLs always enter the primary Italian UI.
  localeDetection: false,
});
