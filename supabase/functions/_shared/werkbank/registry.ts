// GENERATED FILE. Do not edit.
// Source: src/features/werkbank/registry.ts
// Regenerate: npm run sync:mirrors
// Werkbank plugin data: the handwerk org kind, the werkbank brand and the provisioning
// defaults for new handwerk orgs. Pure data with ZERO imports, so this file can be
// mirrored byte for byte to the edge runtime (supabase/functions/_shared/werkbank/registry.ts,
// see scripts/mirrors.manifest.json). The manifests (src/modules/registry.ts and
// supabase/functions/_shared/modules.ts) register these objects and check their shape with
// `satisfies`; this file cannot import the core types without breaking the mirror.
// Spec: docs/superpowers/specs/2026-10-06-werkbank-fundament-design.md (R3, R4, R6).

export const WERKBANK_ORG_KIND = {
  kind: "handwerk",
  brand: "werkbank",
  labels: {
    en: { title: "Trade business", desc: "Customers, jobs, technicians and invoices." },
    de: { title: "Handwerksbetrieb", desc: "Kunden, Aufträge, Monteure und Rechnungen." },
  },
  vocabulary: {
    en: {
      show: "job", shows: "jobs", Show: "Job", Shows: "Jobs",
      showDate: "assignment", showDates: "assignments", ShowDate: "Assignment", ShowDates: "Assignments",
      artist: "technician", artists: "technicians", Artist: "Technician", Artists: "Technicians",
      production: "customer", productions: "customers", Production: "Customer", Productions: "Customers",
      cast: "team", casts: "teams", Cast: "Team", Casts: "Teams",
      understudy: "substitute", understudies: "substitutes", Understudy: "Substitute", Understudies: "Substitutes",
      skill: "qualification", skills: "qualifications", Skill: "Qualification", Skills: "Qualifications",
      hireOrder: "order confirmation", hireOrders: "order confirmations",
      HireOrder: "Order confirmation", HireOrders: "Order confirmations",
      roleProducer: "Office", roleArtist: "Technician", kind: "handwerk",
    },
    de: {
      show: "Auftrag", shows: "Aufträge", Show: "Auftrag", Shows: "Aufträge",
      showDate: "Einsatz", showDates: "Einsätze", ShowDate: "Einsatz", ShowDates: "Einsätze",
      artist: "Monteur", artists: "Monteure", Artist: "Monteur", Artists: "Monteure",
      production: "Kunde", productions: "Kunden", Production: "Kunde", Productions: "Kunden",
      cast: "Team", casts: "Teams", Cast: "Team", Casts: "Teams",
      understudy: "Vertretung", understudies: "Vertretungen", Understudy: "Vertretung", Understudies: "Vertretungen",
      skill: "Qualifikation", skills: "Qualifikationen", Skill: "Qualifikation", Skills: "Qualifikationen",
      hireOrder: "Auftragsbestätigung", hireOrders: "Auftragsbestätigungen",
      HireOrder: "Auftragsbestätigung", HireOrders: "Auftragsbestätigungen",
      roleProducer: "Büro", roleArtist: "Monteur", kind: "handwerk",
    },
  },
  roleDescriptions: {
    en: {
      admin: "Full control of the business, including people and settings.",
      producer: "Creates quotes, jobs and invoices and schedules the technicians.",
      artist: "Sees their assigned jobs and marks them as done.",
    },
    de: {
      admin: "Volle Kontrolle über den Betrieb, inklusive Personen und Einstellungen.",
      producer: "Erstellt Angebote, Aufträge und Rechnungen und plant die Monteure ein.",
      artist: "Sieht die eigenen Aufträge und meldet sie als erledigt.",
    },
  },
  switchableByOrgAdmin: false,
  seedsStarterCatalog: false,
  roleLabelsFollowUiLanguage: true,
} as const;

/** No domain yet: appUrl, hosts and defaultFrom stay empty until the go-live checklist. */
export const WERKBANK_BRAND = {
  key: "werkbank",
  name: "Werkbank Digital",
  markSvgPath: "/werkbank/mark.svg",
  emailMarkPath: "/werkbank/email-mark.png",
  faviconPath: "/werkbank/favicon.svg",
  appUrl: null,
  hosts: [],
  defaultFrom: null,
} as const;

/** Edge provisioning defaults per kind (read by supabase/functions/provision-org). */
export const WERKBANK_PROVISIONING = {
  handwerk: {
    entitlements: { booking_flow: false, hire_orders: false, language_packages: true },
    settings: { org_language: "de" },
    skipBookingFlowSeed: true,
  },
} as const;
