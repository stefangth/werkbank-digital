// Module manifest for the edge runtime: org kinds that plugins add on top of the core
// kinds. Twin of src/modules/registry.ts (keep the two lists in step); the two
// runtimes cannot share an import. Type-only import: orgKind.ts imports this file at
// runtime, so no runtime cycle.
import type { BrandDef } from "./brand.ts";
import type { OrgKind, OrgKindDef } from "./orgKind.ts";
import type { FeatureKey } from "./entitlements.ts";
import type { Json } from "./database.types.ts";
import { WERKBANK_BRAND, WERKBANK_ORG_KIND, WERKBANK_PROVISIONING } from "./werkbank/registry.ts";

export const MODULE_ORG_KINDS = [WERKBANK_ORG_KIND] as const satisfies readonly OrgKindDef[];

/** Brands that plugins add on top of the core showflow brand (see src/lib/brand.ts). */
export const MODULE_BRANDS: readonly BrandDef[] = [WERKBANK_BRAND];

export type ModuleOrgKind = (typeof MODULE_ORG_KINDS)[number]["kind"];

/**
 * What provision-org seeds for a new organization of a given kind, on top of the
 * platform defaults. `entitlements` win over both the platform default and an explicit
 * request; `settings` are upserted into app_settings; `skipBookingFlowSeed` leaves out
 * the "off" booking-flow seed for kinds that have no booking flow.
 */
export interface ProvisioningDefaults {
  entitlements: Partial<Record<FeatureKey, boolean>>;
  settings: Record<string, Json>;
  skipBookingFlowSeed: boolean;
}

/** Per-kind provisioning defaults that plugins add. Core kinds provision unchanged. */
export const MODULE_PROVISIONING: Partial<Record<OrgKind, ProvisioningDefaults>> = WERKBANK_PROVISIONING;
