// Brand registry for the edge runtime. The block between the sentinels is GENERATED from
// src/lib/brand.ts by `npm run sync:mirrors`; edit the source and regenerate, never
// hand-edit the block. Imports sit above the block because each runtime resolves them
// differently.
import { ORG_KIND_DEFS, type OrgKind } from "./orgKind.ts";
import { MODULE_BRANDS } from "./modules.ts";

// >>> BRAND REGISTRY MIRROR (keep byte-identical with the twin file) >>>
export interface BrandDef {
  key: string;
  name: string;
  /** null: render the built-in StageMark. */
  markSvgPath: string | null;
  emailMarkPath: string;
  faviconPath: string;
  /** Absolute app origin for links in emails; null: use the deployment's own. */
  appUrl: string | null;
  /** Hostnames that identify this brand before sign-in. */
  hosts: readonly string[];
  /** Default From header for transactional email, used when the org has no
   *  `resend_from_address` row of its own. When set, it
   *  deliberately replaces the platform-level default sender (a brand never inherits the
   *  ShowFlow sender); when null, the existing org-then-platform resolution applies. */
  defaultFrom: string | null;
}

export const DEFAULT_BRAND_KEY = "showflow";

const CORE_BRANDS: readonly BrandDef[] = [
  {
    key: DEFAULT_BRAND_KEY,
    name: "ShowFlow",
    markSvgPath: null,
    emailMarkPath: "/email/showflow-mark.png",
    faviconPath: "/favicon.svg",
    appUrl: null,
    hosts: [],
    defaultFrom: null,
  },
];

/** Core brands first, then module brands in manifest order. A key may be defined once. */
export function composeBrands(
  core: readonly BrandDef[],
  modules: readonly BrandDef[],
): Record<string, BrandDef> {
  const out: Record<string, BrandDef> = {};
  for (const def of [...core, ...modules]) {
    if (Object.prototype.hasOwnProperty.call(out, def.key)) {
      throw new Error(`Duplicate brand: ${def.key}`);
    }
    out[def.key] = def;
  }
  return out;
}

export const BRANDS: Record<string, BrandDef> = composeBrands(CORE_BRANDS, MODULE_BRANDS);

function ownBrand(brands: Record<string, BrandDef>, key: string | null): BrandDef | null {
  return key !== null && Object.prototype.hasOwnProperty.call(brands, key) ? brands[key] : null;
}

/** The brand an org kind renders under; showflow when the kind or its brand is unknown. */
export function brandForKind(kind: OrgKind): BrandDef {
  const def = Object.prototype.hasOwnProperty.call(ORG_KIND_DEFS, kind) ? ORG_KIND_DEFS[kind] : undefined;
  return ownBrand(BRANDS, def?.brand ?? null) ?? BRANDS[DEFAULT_BRAND_KEY];
}

/**
 * Resolution order: the signed-in org's kind brand, then the stored brand hint (pre-auth
 * invite and magic-link flows), then a hostname match, then showflow. Exported with the
 * registry as a parameter so tests can exercise a composed map; resolveBrand uses BRANDS.
 */
export function resolveBrandIn(
  brands: Record<string, BrandDef>,
  kindBrandKey: string | null,
  input: { hint: string | null; hostname: string },
): BrandDef {
  const byKind = ownBrand(brands, kindBrandKey);
  if (byKind) return byKind;
  const byHint = ownBrand(brands, input.hint);
  if (byHint) return byHint;
  const host = input.hostname.toLowerCase();
  if (host) {
    for (const brand of Object.values(brands)) {
      if (brand.hosts.some((h) => h.toLowerCase() === host)) return brand;
    }
  }
  return brands[DEFAULT_BRAND_KEY];
}

export function resolveBrand(input: { orgKind: OrgKind | null; hint: string | null; hostname: string }): BrandDef {
  const kindBrandKey =
    input.orgKind !== null && Object.prototype.hasOwnProperty.call(ORG_KIND_DEFS, input.orgKind)
      ? ORG_KIND_DEFS[input.orgKind].brand
      : null;
  return resolveBrandIn(BRANDS, kindBrandKey, input);
}

export function brandAppUrl(brand: BrandDef, fallback: string): string {
  return brand.appUrl ?? fallback;
}
// <<< BRAND REGISTRY MIRROR <<<
