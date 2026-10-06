import { useAuth } from "@/features/auth/AuthContext";
import { resolveBrand, type BrandDef } from "@/lib/brand";
import type { OrgKind } from "@/lib/orgKind";

export const BRAND_HINT_KEY = "showflow.brandHint.v1";

function readBrandHint(): string | null {
  try {
    return sessionStorage.getItem(BRAND_HINT_KEY);
  } catch {
    return null;
  }
}

/**
 * The signed-in org's kind, or null when signed out. Pre-auth screens render outside an
 * AuthProvider in some trees (and in isolated tests), so a missing provider counts as signed
 * out instead of crashing the brand surface.
 */
function useCurrentOrgKind(): OrgKind | null {
  try {
    // useAuth reads its context before it throws, so the hook order is identical whether or
    // not a provider is mounted.
    return useAuth()?.currentOrg?.org_kind ?? null;
  } catch {
    return null;
  }
}

/**
 * The brand the current surface renders under: the signed-in org's kind, else the pre-auth
 * brand hint (sessionStorage), else the hostname, else showflow.
 */
export function useBrand(): BrandDef {
  const orgKind = useCurrentOrgKind();
  // Cheap and not memoised on purpose: the hint may be written after mount (invite and
  // magic-link flows), and resolveBrand returns stable registry objects either way.
  return resolveBrand({
    orgKind,
    hint: orgKind ? null : readBrandHint(),
    hostname: typeof window === "undefined" ? "" : window.location.hostname,
  });
}
