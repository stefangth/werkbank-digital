import { assertEquals } from "../test-asserts.ts";
import { MODULE_BRANDS, MODULE_ORG_KINDS, MODULE_PROVISIONING } from "../modules.ts";
import { WERKBANK_BRAND, WERKBANK_ORG_KIND, WERKBANK_PROVISIONING } from "./registry.ts";
import { brandForKind } from "../brand.ts";
import { ORG_KINDS, isOrgKind } from "../orgKind.ts";
import { inviteRoleLabel } from "../roles.ts";

Deno.test("werkbank manifest: the edge manifest registers the plugin's data", () => {
  assertEquals(MODULE_ORG_KINDS.map((d) => d.kind), ["handwerk"]);
  assertEquals(MODULE_ORG_KINDS[0], WERKBANK_ORG_KIND);
  assertEquals(MODULE_BRANDS, [WERKBANK_BRAND]);
  assertEquals(MODULE_PROVISIONING, WERKBANK_PROVISIONING);
  assertEquals(isOrgKind("handwerk"), true);
  assertEquals(ORG_KINDS.slice(0, 2), ["production", "staffing"]);
  assertEquals(brandForKind("handwerk").key, "werkbank");
});

Deno.test("werkbank manifest: invitation role labels follow the org language", () => {
  assertEquals(inviteRoleLabel("artist", "handwerk", "de"), "Monteur");
  assertEquals(inviteRoleLabel("producer", "handwerk", "de"), "Büro");
  assertEquals(inviteRoleLabel("producer", "handwerk", "en"), "Office");
  assertEquals(inviteRoleLabel("admin", "handwerk", "de"), "Admin");
});
