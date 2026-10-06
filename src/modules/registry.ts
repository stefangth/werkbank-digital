// Module manifest: org kinds that plugins add on top of the core kinds. The core never
// names a module kind; src/lib/orgKind.ts composes these after production and staffing.
// Edge twin: supabase/functions/_shared/modules.ts (keep the two lists in step).
// Type-only import: orgKind.ts imports this file at runtime, so no runtime cycle.
import type { OrgKindDef } from "@/lib/orgKind";

export const MODULE_ORG_KINDS = [] as const satisfies readonly OrgKindDef[];

export type ModuleOrgKind = (typeof MODULE_ORG_KINDS)[number]["kind"];
