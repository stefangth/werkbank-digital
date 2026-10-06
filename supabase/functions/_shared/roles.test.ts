import { assertEquals } from "./test-asserts.ts";
import { inviteRoleLabel } from "./roles.ts";

Deno.test("inviteRoleLabel: staffing email keeps today's English label in German", () => {
  assertEquals(inviteRoleLabel("producer", "staffing", "de"), "Production Team");
});

Deno.test("inviteRoleLabel: production email is unchanged in both locales", () => {
  assertEquals(inviteRoleLabel("producer", "production", "en"), "Production Team");
  assertEquals(inviteRoleLabel("producer", "production", "de"), "Production Team");
  assertEquals(inviteRoleLabel("artist", "production", "de"), "Artist");
  assertEquals(inviteRoleLabel("admin", "staffing", "de"), "Admin");
});
