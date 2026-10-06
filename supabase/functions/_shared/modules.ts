// Module manifest for the edge runtime: org kinds that plugins add on top of the core
// kinds. Twin of src/modules/registry.ts (keep the two lists in step); the two
// runtimes cannot share an import. Type-only import: orgKind.ts imports this file at
// runtime, so no runtime cycle.
import type { BrandDef } from "./brand.ts";
import type { OrgKindDef } from "./orgKind.ts";

export const MODULE_ORG_KINDS = [] as const satisfies readonly OrgKindDef[];

/** Brands that plugins add on top of the core showflow brand (see src/lib/brand.ts). */
export const MODULE_BRANDS: readonly BrandDef[] = [];

export type ModuleOrgKind = (typeof MODULE_ORG_KINDS)[number]["kind"];
