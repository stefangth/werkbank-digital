import { assertEquals } from "../test-asserts.ts";
import { makeFakeDeps } from "../testing.ts";
import { handle } from "../../exchange-invitation/index.ts";

Deno.test("exchange-invitation: an invitation into a handwerk org returns the werkbank brand", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      org_invitations: { data: { org_id: "org-1" }, error: null },
      organizations: { data: { org_kind: "handwerk" }, error: null },
    },
    rpcs: {
      claim_invitation_auth_exchange: {
        data: { status: "ok", email: "claimed@example.com", claimed_at: "2026-08-12T09:00:00Z" },
        error: null,
      },
    },
    authUsersByEmail: { "claimed@example.com": { id: "u2" } },
    generateLinkResult: { data: { properties: { action_link: "https://auth.example/action" } }, error: null },
  });
  const response = await handle(
    new Request("http://local", {
      method: "POST",
      body: JSON.stringify({ token: "tok", app_origin: "https://app.showflow.pro" }),
    }),
    deps,
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { action_url: "https://auth.example/action", brand: "werkbank" });
});
