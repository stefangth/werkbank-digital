import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import { DunningActionError, dunningActionErrorKey, dunningDownloadUrl, issueDunning, previewDunning, sendDunning } from "./dunningActions";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) => fake as unknown as SupabaseClient<Database>;
const FN = "fn:werkbank-dunning";
const failure = (status: number, json: unknown) => ({ [FN]: { data: null, error: { context: new Response(JSON.stringify(json), { status }) } } });

describe("previewDunning", () => {
  it("returns the pdf blob", async () => {
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    const fake = createFakeSupabase({ [FN]: { data: blob, error: null } });
    expect(await previewDunning(asClient(fake), { orgId: "org-1", invoiceId: "i1", paymentDeadline: "2026-11-01" })).toBe(blob);
    expect(fake.calls).toContainEqual({ table: FN, method: "invoke", args: [{ action: "preview", org_id: "org-1", invoice_id: "i1", payment_deadline: "2026-11-01" }] });
  });
});

describe("issueDunning", () => {
  it("sends the issue body and maps the result", async () => {
    const fake = createFakeSupabase({ [FN]: { data: { notice_id: "n1", stage: 2, email_sent: true }, error: null } });
    const send = { to: ["a@example.de"] };
    expect(await issueDunning(asClient(fake), { orgId: "org-1", invoiceId: "i1", delivery: "email", paymentDeadline: "2026-11-01", send }))
      .toEqual({ noticeId: "n1", stage: 2, emailSent: true });
    expect(fake.calls).toContainEqual({ table: FN, method: "invoke", args: [{ action: "issue", org_id: "org-1", invoice_id: "i1", delivery: "email", payment_deadline: "2026-11-01", send }] });
  });
  it("maps a 409 not_allowed to blockers", async () => {
    const fake = createFakeSupabase(failure(409, { error: "not_allowed", blockers: ["hold_active"] }));
    const err = await issueDunning(asClient(fake), { orgId: "o", invoiceId: "i", delivery: "print" }).catch((e) => e);
    expect(err).toBeInstanceOf(DunningActionError);
    expect(err).toMatchObject({ code: "not_allowed", blockers: ["hold_active"], issued: false });
  });
  it("maps a 502 to issued", async () => {
    const fake = createFakeSupabase(failure(502, { error: "send_failed", issued: true }));
    await expect(issueDunning(asClient(fake), { orgId: "o", invoiceId: "i", delivery: "email" }))
      .rejects.toMatchObject({ code: "send_failed", issued: true, blockers: [] });
  });
  it("falls back to unknown", async () => {
    const fake = createFakeSupabase({ [FN]: { data: null, error: new Error("boom") } });
    await expect(issueDunning(asClient(fake), { orgId: "o", invoiceId: "i", delivery: "print" })).rejects.toMatchObject({ code: "unknown" });
  });
});

describe("sendDunning and dunningDownloadUrl", () => {
  it("posts send", async () => {
    const fake = createFakeSupabase({ [FN]: { data: { sent: true }, error: null } });
    await sendDunning(asClient(fake), { orgId: "org-1", noticeId: "n1", to: ["a@example.de"], message: "Hallo" });
    expect(fake.calls).toContainEqual({ table: FN, method: "invoke", args: [{ action: "send", org_id: "org-1", notice_id: "n1", to: ["a@example.de"], message: "Hallo" }] });
  });
  it("returns the signed url", async () => {
    const fake = createFakeSupabase({ [FN]: { data: { url: "https://x/y.pdf" }, error: null } });
    expect(await dunningDownloadUrl(asClient(fake), "org-1", "n1")).toBe("https://x/y.pdf");
    expect(fake.calls).toContainEqual({ table: FN, method: "invoke", args: [{ action: "download-url", org_id: "org-1", notice_id: "n1" }] });
  });
});

describe("dunningActionErrorKey", () => {
  it("names a missing recipient and a missing invoice file", () => {
    expect(dunningActionErrorKey("no_recipient")).toBe("dunning.errors.noRecipient");
    expect(dunningActionErrorKey("invoice_file_missing")).toBe("dunning.errors.invoiceFileMissing");
  });
  it("falls back to the invoice action keys", () => {
    expect(dunningActionErrorKey("invalid_recipient")).toBe("invoices.send.errors.invalidRecipient");
    expect(dunningActionErrorKey("unknown")).toBe("invoices.send.errors.generic");
  });
});
