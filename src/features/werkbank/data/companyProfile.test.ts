import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchCompanyProfile, logoUrl, saveCompanyProfile, uploadLogo } from "./companyProfile";
import type { CompanyProfileRow } from "../schemas/companyProfile";

const asClient = (fake: unknown) => fake as SupabaseClient<Database>;

function withStorage(result: { error: unknown; data?: unknown } = { error: null }, profile: { data: null; error: unknown } = { data: null, error: null }) {
  const fake = createFakeSupabase({ "werkbank.company_profiles": profile });
  const upload = vi.fn().mockResolvedValue(result);
  const remove = vi.fn().mockResolvedValue({ data: [], error: null });
  const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed" }, error: null });
  const from = vi.fn(() => ({ upload, createSignedUrl, remove }));
  return { fake, client: asClient({ ...fake, storage: { from } }), upload, createSignedUrl, remove, from };
}

const row = { company_name: "Muster Bau GmbH", street: "Hauptstr. 1", postal_code: "01067", city: "Dresden", country_code: "DE", quote_validity_days: 30 } as CompanyProfileRow;

describe("fetchCompanyProfile", () => {
  it("reads the org's row", async () => {
    const fake = createFakeSupabase({ "werkbank.company_profiles": { data: { org_id: "org-1" }, error: null } });
    await expect(fetchCompanyProfile(asClient(fake), "org-1")).resolves.toEqual({ org_id: "org-1" });
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: "werkbank.company_profiles", method: "eq", args: ["org_id", "org-1"] }));
  });
  it("returns null without a row and throws a database error", async () => {
    const none = createFakeSupabase({ "werkbank.company_profiles": { data: null, error: null } });
    await expect(fetchCompanyProfile(asClient(none), "org-1")).resolves.toBeNull();
    const error = { code: "42501" };
    const bad = createFakeSupabase({ "werkbank.company_profiles": { data: null, error } });
    await expect(fetchCompanyProfile(asClient(bad), "org-1")).rejects.toBe(error);
  });
});

describe("saveCompanyProfile", () => {
  it("upserts on org_id with the org id in the payload", async () => {
    const fake = createFakeSupabase({ "werkbank.company_profiles": { data: null, error: null } });
    await saveCompanyProfile(asClient(fake), "org-1", row);
    expect(fake.calls).toContainEqual(expect.objectContaining({
      method: "upsert",
      args: [{ ...row, org_id: "org-1" }, { onConflict: "org_id" }],
    }));
  });
  it("throws a database error", async () => {
    const error = { code: "42501" };
    const fake = createFakeSupabase({ "werkbank.company_profiles": { data: null, error } });
    await expect(saveCompanyProfile(asClient(fake), "org-1", row)).rejects.toBe(error);
  });
});

describe("saveCompanyProfile logo cleanup", () => {
  const withLogo = { ...row, logo_path: "org-1/logo-2.png" } as CompanyProfileRow;

  it("removes the previous logo object after the save succeeded", async () => {
    const { client, remove, from } = withStorage();
    await saveCompanyProfile(client, "org-1", withLogo, "org-1/logo-1.png");
    expect(from).toHaveBeenCalledWith("werkbank-assets");
    expect(remove).toHaveBeenCalledWith(["org-1/logo-1.png"]);
  });
  it("removes it when the logo was taken away", async () => {
    const { client, remove } = withStorage();
    await saveCompanyProfile(client, "org-1", { ...row, logo_path: null } as CompanyProfileRow, "org-1/logo-1.png");
    expect(remove).toHaveBeenCalledWith(["org-1/logo-1.png"]);
  });
  it("never removes the current logo, nothing when there was none, nothing from another org", async () => {
    const { client, remove } = withStorage();
    await saveCompanyProfile(client, "org-1", withLogo, "org-1/logo-2.png");
    await saveCompanyProfile(client, "org-1", withLogo, null);
    await saveCompanyProfile(client, "org-1", withLogo, "org-2/logo-1.png");
    expect(remove).not.toHaveBeenCalled();
  });
  it("keeps the previous logo when the save fails", async () => {
    const { client, remove } = withStorage({ error: null }, { data: null, error: { code: "42501" } });
    await expect(saveCompanyProfile(client, "org-1", withLogo, "org-1/logo-1.png")).rejects.toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
  });
  it("ignores a failing cleanup: the save has succeeded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client, remove } = withStorage();
    remove.mockRejectedValue(new Error("network"));
    await expect(saveCompanyProfile(client, "org-1", withLogo, "org-1/logo-1.png")).resolves.toBeUndefined();
    remove.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(saveCompanyProfile(client, "org-1", withLogo, "org-1/logo-1.png")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("uploadLogo", () => {
  it("uploads under the org id prefix with upsert and returns the path", async () => {
    const { client, upload, from } = withStorage();
    const file = new File(["x"], "logo.png", { type: "image/png" });
    const path = await uploadLogo(client, "org-1", file);
    expect(from).toHaveBeenCalledWith("werkbank-assets");
    expect(path).toMatch(/^org-1\/logo-\d+\.png$/);
    expect(upload).toHaveBeenCalledWith(path, file, { upsert: true });
  });
  it("uses jpg for a JPEG", async () => {
    const { client } = withStorage();
    const path = await uploadLogo(client, "org-1", new File(["x"], "a.jpeg", { type: "image/jpeg" }));
    expect(path).toMatch(/^org-1\/logo-\d+\.jpg$/);
  });
  it("throws a storage error", async () => {
    const error = new Error("denied");
    const { client } = withStorage({ error });
    await expect(uploadLogo(client, "org-1", new File(["x"], "a.png", { type: "image/png" }))).rejects.toBe(error);
  });
});

describe("logoUrl", () => {
  it("returns a signed url valid for 600 seconds", async () => {
    const { client, createSignedUrl } = withStorage();
    await expect(logoUrl(client, "org-1/logo-1.png")).resolves.toBe("https://signed");
    expect(createSignedUrl).toHaveBeenCalledWith("org-1/logo-1.png", 600);
  });
});
