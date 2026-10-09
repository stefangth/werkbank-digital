import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { phoneAppPwaOptions } from "./phoneAppPwa";

const app = { name: "App", shortName: "A", iconDir: "/icons", themeColor: "#000000", lang: "de" };

describe("phoneAppPwaOptions", () => {
  const options = phoneAppPwaOptions("/einsaetze", app);
  const allow = options.workbox?.navigateFallbackAllowlist?.[0] as RegExp;

  it("uses the scope without a trailing slash for registration, manifest scope and start_url", () => {
    expect(options.scope).toBe("/einsaetze");
    expect(options.manifest).toMatchObject({ scope: "/einsaetze", start_url: "/einsaetze", display: "standalone" });
    expect(options.injectRegister).toBe(false);
  });

  it("serves the shell offline for the list page and the detail pages only", () => {
    for (const path of ["/einsaetze", "/einsaetze/", "/einsaetze/abc"]) expect(allow.test(path)).toBe(true);
    for (const path of ["/einsaetzeX", "/orders", "/"]) expect(allow.test(path)).toBe(false);
  });

  it("rejects a trailing slash, which would leave the start page uncontrolled", () => {
    expect(() => phoneAppPwaOptions("/einsaetze/", app)).toThrow(/trailing slash/);
  });

  it("is what vite.config.ts uses, with the scope /einsaetze", () => {
    const config = readFileSync(path.resolve(__dirname, "../vite.config.ts"), "utf8");
    expect(config).toContain('export const PHONE_APP_SCOPE = "/einsaetze";');
    expect(config).toContain("VitePWA(phoneAppPwaOptions(PHONE_APP_SCOPE,");
  });
});
