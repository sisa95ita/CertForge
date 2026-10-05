import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import proxy, { config } from "@/proxy";

describe("CertForge locale routing", () => {
  it("redirects the root to Italian even with English browser preferences and cookie", () => {
    const request = new NextRequest("http://localhost/", { headers: { "accept-language": "en-US,en;q=0.9", cookie: "NEXT_LOCALE=en" } });
    const response = proxy(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/it");
  });
  it.each(["it", "en"])("keeps %s simulation routes and IDs", (locale) => {
    const response = proxy(new NextRequest(`http://localhost/${locale}/simulations/abc123/results`));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-next-intl-locale")).toBe(locale);
  });
  it("localizes old unprefixed routes and excludes APIs and static assets", () => {
    const response = proxy(new NextRequest("http://localhost/simulations/abc123?view=question"));
    expect(response.headers.get("location")).toBe("http://localhost/it/simulations/abc123?view=question");
    const matcher = new RegExp(`^${config.matcher}$`);
    for (const path of ["/api/import", "/api/simulations/abc123", "/_next/static/chunk.js", "/favicon.ico"]) expect(matcher.test(path)).toBe(false);
    expect(matcher.test("/en/simulations/abc123")).toBe(true);
  });
});
