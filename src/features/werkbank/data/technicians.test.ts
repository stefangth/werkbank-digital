import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import { createTechnician, fetchTechnicians } from "./technicians";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) => fake as unknown as SupabaseClient<Database>;

describe("fetchTechnicians", () => {
  it("marks accounts active, invited or none", async () => {
    const fake = createFakeSupabase({
      artists: {
        data: [
          { id: "a1", name: "Anna", email: "anna@x.de", phone: null, user_id: "u1" },
          { id: "a2", name: "Bernd", email: "bernd@x.de", phone: "123", user_id: null },
          { id: "a3", name: "Carla", email: null, phone: null, user_id: null },
        ],
        error: null,
      },
      "rpc:list_pending_invited_artists": { data: ["a2"], error: null },
    });
    const result = await fetchTechnicians(asClient(fake), "org-1");
    expect(result.map((t) => t.account)).toEqual(["active", "invited", "none"]);
    expect(result[1]).toEqual({ id: "a2", name: "Bernd", email: "bernd@x.de", phone: "123", account: "invited" });
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: "artists", method: "select", args: ["id, name, email, phone, user_id"] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: "artists", method: "eq", args: ["org_id", "org-1"] }));
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: "artists", method: "order", args: ["name"] }));
  });

  it("treats an artist with a login as active even if an invite is still pending", async () => {
    const fake = createFakeSupabase({
      artists: { data: [{ id: "a1", name: "Anna", email: "a@x.de", phone: null, user_id: "u1" }], error: null },
      "rpc:list_pending_invited_artists": { data: ["a1"], error: null },
    });
    const result = await fetchTechnicians(asClient(fake), "org-1");
    expect(result[0].account).toBe("active");
  });
});

describe("createTechnician", () => {
  it("inserts the artists row, then invites it as artist", async () => {
    const fake = createFakeSupabase({
      artists: { data: { id: "new-1" }, error: null },
      "fn:create-invitation": { data: { invitation: { id: "inv-1" } }, error: null },
    });
    const result = await createTechnician(asClient(fake), {
      orgId: "org-1", name: "Dora", email: "dora@x.de", phone: null,
    });
    expect(result).toEqual({ id: "new-1" });
    const insert = fake.calls.find((c) => c.table === "artists" && c.method === "insert");
    expect(insert?.args[0]).toEqual({ name: "Dora", email: "dora@x.de", phone: null, org_id: "org-1" });
    const invite = fake.calls.find((c) => c.table === "fn:create-invitation");
    expect(invite?.args[0]).toMatchObject({ org_id: "org-1", email: "dora@x.de", role: "artist", artist_id: "new-1" });
    const order = fake.calls.map((c) => c.table);
    expect(order.indexOf("artists")).toBeLessThan(order.indexOf("fn:create-invitation"));
  });

  it("rejects and sends no invitation when the insert fails", async () => {
    const fake = createFakeSupabase({
      artists: { data: null, error: new Error("insert failed") },
    });
    await expect(
      createTechnician(asClient(fake), { orgId: "org-1", name: "Dora", email: "dora@x.de", phone: null }),
    ).rejects.toThrow("insert failed");
    expect(fake.calls.some((c) => c.table === "fn:create-invitation")).toBe(false);
  });
});
