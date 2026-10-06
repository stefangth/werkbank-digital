// Workspace type (org_kind) for the edge runtime. The block between the sentinels is
// GENERATED from src/lib/orgKind.ts by `npm run sync:mirrors`; edit the source and
// regenerate, never hand-edit the block. `resolveOrgKind` below is edge-only.
import type { TypedClient } from "./deps.ts";
import { MODULE_ORG_KINDS, type ModuleOrgKind } from "./modules.ts";

// >>> ORG KIND REGISTRY MIRROR (keep byte-identical with the twin file) >>>
export type CoreOrgKind = "production" | "staffing";
export type OrgKind = CoreOrgKind | ModuleOrgKind;
export type OrgKindLang = "en" | "de";

/**
 * Vocabulary variables. Four forms per noun because i18next interpolation is plain
 * substitution and sentences start with capitals: lower singular, lower plural,
 * Capital singular, Capital plural. Every (kind, lang) table has the same keys
 * (orgKind.test.ts). PR 2 extends this list during the copy audit.
 */
export type VocabKey =
  | "show" | "shows" | "Show" | "Shows"
  | "showDate" | "showDates" | "ShowDate" | "ShowDates"
  | "artist" | "artists" | "Artist" | "Artists"
  | "production" | "productions" | "Production" | "Productions"
  | "cast" | "casts" | "Cast" | "Casts"
  | "understudy" | "understudies" | "Understudy" | "Understudies"
  | "skill" | "skills" | "Skill" | "Skills"
  | "hireOrder" | "hireOrders" | "HireOrder" | "HireOrders"
  | "roleProducer" | "roleArtist"
  | "kind";

export type Vocabulary = Record<VocabKey, string>;

/**
 * One workspace type. Core kinds are defined below; modules contribute more through the
 * manifest and are appended after the core kinds by composeOrgKinds.
 */
export interface OrgKindDef<K extends string = string> {
  kind: K;
  /** Brand key the workspace renders under. */
  brand: string;
  /** Picker labels. Neutral, plain language; the vocabulary carries the nouns. */
  labels: Record<OrgKindLang, { title: string; desc: string }>;
  vocabulary: Record<OrgKindLang, Vocabulary>;
  switchableByOrgAdmin: boolean;
  seedsStarterCatalog: boolean;
  /** False: role labels stay English in every UI language (today's core behaviour). */
  roleLabelsFollowUiLanguage: boolean;
  /** Role descriptions in full sentences, per language. Absent: the English templates in
   *  app.config.ts are resolved against the vocabulary (today's core behaviour). */
  roleDescriptions?: Record<OrgKindLang, Record<"admin" | "producer" | "artist", string>>;
}

const CORE_ORG_KIND_DEFS: readonly OrgKindDef<CoreOrgKind>[] = [
  {
    kind: "production",
    brand: "showflow",
    labels: {
      en: { title: "Live production", desc: "Shows, dates, artists and casts." },
      de: { title: "Live-Produktion", desc: "Shows, Termine, Artists und Besetzungen." },
    },
    vocabulary: {
      en: {
        show: "show", shows: "shows", Show: "Show", Shows: "Shows",
        showDate: "date", showDates: "dates", ShowDate: "Date", ShowDates: "Dates",
        artist: "artist", artists: "artists", Artist: "Artist", Artists: "Artists",
        production: "production", productions: "productions", Production: "Production", Productions: "Productions",
        cast: "cast", casts: "casts", Cast: "Cast", Casts: "Casts",
        understudy: "understudy", understudies: "understudies", Understudy: "Understudy", Understudies: "Understudies",
        skill: "skill", skills: "skills", Skill: "Skill", Skills: "Skills",
        hireOrder: "contract", hireOrders: "contracts", HireOrder: "Contract", HireOrders: "Contracts",
        roleProducer: "Production Team", roleArtist: "Artist", kind: "production",
      },
      de: {
        show: "Show", shows: "Shows", Show: "Show", Shows: "Shows",
        showDate: "Termin", showDates: "Termine", ShowDate: "Termin", ShowDates: "Termine",
        artist: "Artist", artists: "Artists", Artist: "Artist", Artists: "Artists",
        production: "Produktion", productions: "Produktionen", Production: "Produktion", Productions: "Produktionen",
        cast: "Besetzung", casts: "Besetzungen", Cast: "Besetzung", Casts: "Besetzungen",
        understudy: "Zweitbesetzung", understudies: "Zweitbesetzungen", Understudy: "Zweitbesetzung", Understudies: "Zweitbesetzungen",
        skill: "Skill", skills: "Skills", Skill: "Skill", Skills: "Skills",
        hireOrder: "Engagementvertrag", hireOrders: "Engagementverträge", HireOrder: "Engagementvertrag", HireOrders: "Engagementverträge",
        roleProducer: "Production Team", roleArtist: "Artist", kind: "production",
      },
    },
    switchableByOrgAdmin: true,
    seedsStarterCatalog: true,
    roleLabelsFollowUiLanguage: false,
  },
  {
    kind: "staffing",
    brand: "showflow",
    labels: {
      en: { title: "Staffing agency", desc: "Clients, shifts, staff and teams." },
      de: { title: "Personalagentur", desc: "Kunden, Schichten, Teammitglieder und Teams." },
    },
    vocabulary: {
      en: {
        show: "project", shows: "projects", Show: "Project", Shows: "Projects",
        showDate: "shift", showDates: "shifts", ShowDate: "Shift", ShowDates: "Shifts",
        artist: "staff member", artists: "people", Artist: "Staff member", Artists: "People",
        production: "client", productions: "clients", Production: "Client", Productions: "Clients",
        cast: "team", casts: "teams", Cast: "Team", Casts: "Teams",
        understudy: "standby", understudies: "standbys", Understudy: "Standby", Understudies: "Standbys",
        skill: "qualification", skills: "qualifications", Skill: "Qualification", Skills: "Qualifications",
        hireOrder: "work order", hireOrders: "work orders", HireOrder: "Work order", HireOrders: "Work orders",
        roleProducer: "Booking team", roleArtist: "Artist", kind: "staffing",
      },
      de: {
        show: "Projekt", shows: "Projekte", Show: "Projekt", Shows: "Projekte",
        showDate: "Schicht", showDates: "Schichten", ShowDate: "Schicht", ShowDates: "Schichten",
        artist: "Teammitglied", artists: "Personen", Artist: "Teammitglied", Artists: "Personen",
        production: "Kunde", productions: "Kunden", Production: "Kunde", Productions: "Kunden",
        cast: "Team", casts: "Teams", Cast: "Team", Casts: "Teams",
        understudy: "Ersatz", understudies: "Ersatzkräfte", Understudy: "Ersatz", Understudies: "Ersatzkräfte",
        skill: "Qualifikation", skills: "Qualifikationen", Skill: "Qualifikation", Skills: "Qualifikationen",
        hireOrder: "Arbeitsauftrag", hireOrders: "Arbeitsaufträge", HireOrder: "Arbeitsauftrag", HireOrders: "Arbeitsaufträge",
        roleProducer: "Buchungsteam", roleArtist: "Artist", kind: "staffing",
      },
    },
    switchableByOrgAdmin: true,
    seedsStarterCatalog: true,
    roleLabelsFollowUiLanguage: false,
  },
];

/** Core kinds first, then module kinds in manifest order. A kind may be defined once. */
export function composeOrgKinds(
  core: readonly OrgKindDef[],
  modules: readonly OrgKindDef[],
): Record<string, OrgKindDef> {
  const out: Record<string, OrgKindDef> = {};
  for (const def of [...core, ...modules]) {
    if (Object.prototype.hasOwnProperty.call(out, def.kind)) {
      throw new Error(`Duplicate org kind: ${def.kind}`);
    }
    out[def.kind] = def;
  }
  return out;
}

export const ORG_KIND_DEFS = composeOrgKinds(CORE_ORG_KIND_DEFS, MODULE_ORG_KINDS) as Record<OrgKind, OrgKindDef>;

export const ORG_KINDS: readonly OrgKind[] = Object.keys(ORG_KIND_DEFS) as OrgKind[];
export const DEFAULT_ORG_KIND: OrgKind = "production";

export function isOrgKind(v: unknown): v is OrgKind {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ORG_KIND_DEFS, v);
}

/** Narrow any stored value to an OrgKind; anything unknown is production. */
export function coerceOrgKind(v: unknown): OrgKind {
  return isOrgKind(v) ? v : DEFAULT_ORG_KIND;
}

export function isSwitchableByOrgAdmin(kind: OrgKind): boolean {
  return ORG_KIND_DEFS[kind].switchableByOrgAdmin;
}

export function roleLabelsFollowUiLanguage(kind: OrgKind): boolean {
  return ORG_KIND_DEFS[kind].roleLabelsFollowUiLanguage;
}

function byKind<T>(pick: (def: OrgKindDef) => T): Record<OrgKind, T> {
  return Object.fromEntries(ORG_KINDS.map((k) => [k, pick(ORG_KIND_DEFS[k])])) as Record<OrgKind, T>;
}

/** Picker labels per kind, derived from ORG_KIND_DEFS. */
export const ORG_KIND_LABELS: Record<OrgKind, Record<OrgKindLang, { title: string; desc: string }>> =
  byKind((def) => def.labels);

/** Vocabulary tables per kind, derived from ORG_KIND_DEFS. */
export const VOCABULARY: Record<OrgKind, Record<OrgKindLang, Vocabulary>> = byKind((def) => def.vocabulary);

/**
 * Plain {{name}} substitution from a vocabulary table, for copy that does not go through
 * i18next (Help items, glossary, page minis, and in PR 3 the email and PDF copy maps).
 * Unknown tokens (runtime variables like {{count}}) are left verbatim.
 */
export function interpolateVocabulary(text: string, vocab: Vocabulary): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vocab, name) ? vocab[name as VocabKey] : whole,
  );
}
// <<< ORG KIND REGISTRY MIRROR <<<

interface OrgKindRow { org_kind: string | null }

/**
 * The org's workspace type, read from organizations.org_kind. A null org (auth or
 * platform emails with no org context), a missing row, an unknown value, or any read
 * error all resolve to production, so a broken read can never leak the wrong words.
 */
export async function resolveOrgKind(admin: TypedClient, orgId: string | null): Promise<OrgKind> {
  if (!orgId) return DEFAULT_ORG_KIND;
  try {
    const { data, error } = await admin
      .from("organizations")
      .select("org_kind")
      .eq("id", orgId)
      .maybeSingle();
    if (error) return DEFAULT_ORG_KIND;
    return coerceOrgKind((data as OrgKindRow | null)?.org_kind);
  } catch {
    return DEFAULT_ORG_KIND;
  }
}
