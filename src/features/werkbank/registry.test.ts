import { describe, it, expect } from "vitest";
import { ORG_KINDS, ORG_KIND_LABELS, VOCABULARY, isSwitchableByOrgAdmin, isOrgKind, coerceOrgKind } from "@/lib/orgKind";
import { BRANDS, brandForKind, resolveBrand } from "@/lib/brand";
import { roleLabel, roleDescription } from "@/config/app.config";
import { MODULE_ORG_KINDS, MODULE_BRANDS } from "@/modules/registry";
import { readFileSync } from "node:fs";
import { WERKBANK_ORG_KIND, WERKBANK_BRAND, WERKBANK_INVITATION_COPY, WERKBANK_PROVISIONING } from "./registry";

describe("werkbank org kind", () => {
  it("is registered after the core kinds", () => {
    expect(ORG_KINDS).toContain("handwerk");
    expect(ORG_KINDS.slice(0, 2)).toEqual(["production", "staffing"]);
    expect(isOrgKind("handwerk")).toBe(true);
    expect(coerceOrgKind("handwerk")).toBe("handwerk");
  });

  it("is locked against org admins and seeds no starter catalog", () => {
    expect(isSwitchableByOrgAdmin("handwerk")).toBe(false);
    expect(WERKBANK_ORG_KIND.seedsStarterCatalog).toBe(false);
  });

  it("labels roles in the UI language", () => {
    expect(roleLabel("artist", "handwerk", "de")).toBe("Monteur");
    expect(roleLabel("artist", "handwerk", "en")).toBe("Technician");
    expect(roleLabel("producer", "handwerk", "de")).toBe("Büro");
    expect(roleLabel("producer", "handwerk", "en")).toBe("Office");
    expect(roleLabel("admin", "handwerk", "de")).toBe("Admin");
    expect(roleLabel("admin", "handwerk", "en")).toBe("Admin");
  });

  it("describes the roles in full sentences per language", () => {
    expect(roleDescription("artist", "handwerk", "de")).toBe("Sieht die eigenen Aufträge, schreibt Einsatzberichte und meldet die Arbeit als erledigt.");
    expect(roleDescription("producer", "handwerk", "de")).toBe(
      "Erstellt Angebote, Aufträge und Rechnungen und plant die Monteure ein.",
    );
    expect(roleDescription("admin", "handwerk", "de")).toBe(
      "Volle Kontrolle über den Betrieb, inklusive Personen und Einstellungen.",
    );
    expect(roleDescription("artist", "handwerk", "en")).toBe("Sees their own jobs, writes visit reports and marks the work as done.");
    expect(roleDescription("producer", "handwerk", "en")).toBe(
      "Creates quotes, jobs and invoices and schedules the technicians.",
    );
    expect(roleDescription("admin", "handwerk", "en")).toBe("Full control of the business, including people and settings.");
  });

  it("carries the approved vocabulary and picker labels", () => {
    const de = VOCABULARY.handwerk.de;
    expect(de.show).toBe("Auftrag");
    expect(de.Shows).toBe("Aufträge");
    expect(de.showDates).toBe("Einsätze");
    expect(de.artist).toBe("Monteur");
    expect(de.production).toBe("Kunde");
    expect(de.productions).toBe("Kunden");
    expect(de.cast).toBe("Team");
    expect(de.understudy).toBe("Vertretung");
    expect(de.skills).toBe("Qualifikationen");
    expect(de.hireOrders).toBe("Auftragsbestätigungen");
    expect(de.kind).toBe("handwerk");
    const en = VOCABULARY.handwerk.en;
    expect(en.shows).toBe("jobs");
    expect(en.ShowDate).toBe("Assignment");
    expect(en.artists).toBe("technicians");
    expect(en.Productions).toBe("Customers");
    expect(en.hireOrder).toBe("order confirmation");
    expect(en.kind).toBe("handwerk");
    expect(ORG_KIND_LABELS.handwerk.de).toEqual({
      title: "Handwerksbetrieb",
      desc: "Kunden, Aufträge, Monteure und Rechnungen.",
    });
    expect(ORG_KIND_LABELS.handwerk.en).toEqual({
      title: "Trade business",
      desc: "Customers, jobs, technicians and invoices.",
    });
  });
});

describe("werkbank brand", () => {
  it("maps the kind to the werkbank brand", () => {
    expect(brandForKind("handwerk").key).toBe("werkbank");
    expect(BRANDS.werkbank).toBe(WERKBANK_BRAND);
    expect(resolveBrand({ orgKind: "handwerk", hint: null, hostname: "example.test" }).name).toBe("Werkbank Digital");
    expect(brandForKind("production").key).toBe("showflow");
  });

  it("has no domain yet", () => {
    expect(WERKBANK_BRAND).toEqual({
      key: "werkbank",
      name: "Werkbank Digital",
      markSvgPath: "/werkbank/mark.svg",
      emailMarkPath: "/werkbank/email-mark.png",
      faviconPath: "/werkbank/favicon.svg",
      appUrl: null,
      hosts: [],
      defaultFrom: null,
    });
  });
});

describe("werkbank provisioning defaults", () => {
  it("turns off booking and hire orders, defaults the org language to German and seeds the invitation copy", () => {
    expect(WERKBANK_PROVISIONING).toEqual({
      handwerk: {
        entitlements: { booking_flow: false, hire_orders: false, language_packages: true },
        settings: { org_language: "de", email_copy: WERKBANK_INVITATION_COPY },
        skipBookingFlowSeed: true,
      },
    });
  });
});

// The edge manifest imports Deno-only modules, so it cannot be loaded here. Its registrations
// are compared as source text instead; the Deno test next to the mirrored registry
// (supabase/functions/_shared/werkbank/registry.test.ts) loads it for real and checks the
// registered objects against the mirrored data.
function registered(file: string, name: string): string[] {
  const text = readFileSync(new URL(file, import.meta.url), "utf8");
  const match = new RegExp(`export const ${name}\\b[^=]*=\\s*\\[([^\\]]*)\\]`).exec(text);
  if (!match) throw new Error(`${name} not found in ${file}`);
  return match[1].split(",").map((id) => id.trim()).filter(Boolean);
}

describe("client and edge manifests stay in step (R8)", () => {
  const client = "../../modules/registry.ts";
  const edge = "../../../supabase/functions/_shared/modules.ts";

  it("register the same org kinds and brands", () => {
    expect(registered(client, "MODULE_ORG_KINDS")).toEqual(["WERKBANK_ORG_KIND"]);
    expect(registered(edge, "MODULE_ORG_KINDS")).toEqual(registered(client, "MODULE_ORG_KINDS"));
    expect(registered(edge, "MODULE_BRANDS")).toEqual(registered(client, "MODULE_BRANDS"));
  });

  it("register the data the plugin exports", () => {
    expect(MODULE_ORG_KINDS).toEqual([WERKBANK_ORG_KIND]);
    expect(MODULE_BRANDS).toEqual([WERKBANK_BRAND]);
  });

  it("every registered kind points at a registered brand", () => {
    for (const def of MODULE_ORG_KINDS) {
      expect(BRANDS[def.brand]).toBeDefined();
    }
  });
});
