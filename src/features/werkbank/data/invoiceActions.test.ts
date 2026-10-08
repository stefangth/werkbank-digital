import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import { InvoiceActionError, invoiceActionErrorKey, invoiceDownloadUrl, issueInvoice, previewInvoice, sendInvoice } from "./invoiceActions";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) => fake as unknown as SupabaseClient<Database>;
const FN = "fn:werkbank-invoices";
const body = { to: ["a@example.de"], cc: [], message: "Hallo" };
const failure = (status: number, json: unknown) => ({ [FN]: { data: null, error: { context: new Response(JSON.stringify(json), { status }) } } });

describe("previewInvoice", () => {
  it("returns the base64 pdf", async () => {
    const fake = createFakeSupabase({ [FN]: { data: { pdf_base64: "JVBERg==" }, error: null } });
    expect(await previewInvoice(asClient(fake), "org-1", "i1")).toBe("JVBERg==");
    expect(fake.calls).toContainEqual({ table: FN, method: "invoke", args: [{ action: "preview", org_id: "org-1", invoice_id: "i1" }] });
  });
});

describe("issueInvoice", () => {
  it("invokes the issue action and maps the result", async () => {
    const fake = createFakeSupabase({ [FN]: { data: { ok: true, invoice_no: "RE-0001" }, error: null } });
    expect(await issueInvoice(asClient(fake), "org-1", "i1")).toEqual({ invoiceNo: "RE-0001", emailSent: undefined });
    expect(fake.calls).toContainEqual({ table: FN, method: "invoke", args: [{ action: "issue", org_id: "org-1", invoice_id: "i1" }] });
  });
  it("passes the send payload along", async () => {
    const fake = createFakeSupabase({ [FN]: { data: { ok: true, invoice_no: "RE-0001", email_sent: true }, error: null } });
    expect(await issueInvoice(asClient(fake), "org-1", "i1", body)).toEqual({ invoiceNo: "RE-0001", emailSent: true });
    expect(fake.calls).toContainEqual({ table: FN, method: "invoke", args: [{ action: "issue", org_id: "org-1", invoice_id: "i1", send: body }] });
  });
  it("turns a 422 into an error carrying the blockers", async () => {
    const fake = createFakeSupabase(failure(422, { error: "preflight_failed", blockers: ["no_items", "profile_incomplete"] }));
    const err = await issueInvoice(asClient(fake), "org-1", "i1").catch((e) => e);
    expect(err).toBeInstanceOf(InvoiceActionError);
    expect(err).toMatchObject({ code: "preflight_failed", blockers: ["no_items", "profile_incomplete"], issued: false });
  });
  it("carries issued for a failure after the invoice was issued", async () => {
    const fake = createFakeSupabase(failure(502, { error: "send_failed", issued: true }));
    await expect(issueInvoice(asClient(fake), "org-1", "i1", body)).rejects.toMatchObject({ code: "send_failed", issued: true, blockers: [] });
  });
  it("falls back to unknown without a readable body", async () => {
    const fake = createFakeSupabase({ [FN]: { data: null, error: new Error("boom") } });
    await expect(issueInvoice(asClient(fake), "org-1", "i1")).rejects.toMatchObject({ code: "unknown", issued: false });
  });
});

describe("sendInvoice", () => {
  it("posts the send action", async () => {
    const fake = createFakeSupabase({ [FN]: { data: { ok: true, email_sent: true }, error: null } });
    expect(await sendInvoice(asClient(fake), "org-1", "i1", body)).toEqual({ emailSent: true });
    expect(fake.calls).toContainEqual({ table: FN, method: "invoke", args: [{ action: "send", org_id: "org-1", invoice_id: "i1", ...body }] });
  });
  it("surfaces invalid_state", async () => {
    const fake = createFakeSupabase(failure(409, { error: "invalid_state" }));
    await expect(sendInvoice(asClient(fake), "org-1", "i1", body)).rejects.toMatchObject({ code: "invalid_state" });
  });
  it("surfaces the server's recipient errors with their own copy", async () => {
    for (const [code, key] of [
      ["invalid_recipient", "invoices.send.errors.invalidRecipient"],
      ["too_many_recipients", "invoices.send.errors.tooManyRecipients"],
    ] as const) {
      const fake = createFakeSupabase(failure(422, { error: code }));
      const err = await sendInvoice(asClient(fake), "org-1", "i1", body).catch((e: unknown) => e);
      expect(err).toMatchObject({ code });
      expect(invoiceActionErrorKey((err as InvoiceActionError).code)).toBe(key);
    }
  });
  it("carries the reason of an invalid_state", async () => {
    const fake = createFakeSupabase(failure(409, { error: "invalid_state", reason: "order_not_done" }));
    await expect(sendInvoice(asClient(fake), "org-1", "i1", body)).rejects.toMatchObject({ code: "invalid_state", reason: "order_not_done" });
  });
});

describe("invoiceDownloadUrl", () => {
  it("returns the signed url", async () => {
    const fake = createFakeSupabase({ [FN]: { data: { url: "https://signed" }, error: null } });
    expect(await invoiceDownloadUrl(asClient(fake), "org-1", "i1")).toBe("https://signed");
    expect(fake.calls).toContainEqual({ table: FN, method: "invoke", args: [{ action: "download-url", org_id: "org-1", invoice_id: "i1" }] });
  });
});

describe("invoiceActionErrorKey", () => {
  it("groups technical failures under one generic key and maps the specific codes", () => {
    for (const c of ["load_failed", "render_failed", "upload_failed", "update_failed", "unknown_action", "bad_request", "unknown"]) {
      expect(invoiceActionErrorKey(c)).toBe("invoices.send.errors.generic");
    }
    expect(invoiceActionErrorKey("preflight_failed")).toBe("invoices.send.errors.preflight");
    expect(invoiceActionErrorKey("send_failed")).toBe("invoices.send.errors.sendFailed");
    expect(invoiceActionErrorKey("invalid_state")).toBe("invoices.send.errors.invalidState");
    expect(invoiceActionErrorKey("forbidden")).toBe("invoices.send.errors.forbidden");
    expect(invoiceActionErrorKey("invalid_state", "order_not_done")).toBe("errors.orderNotDone");
    expect(invoiceActionErrorKey("invalid_state", "invalid_transition")).toBe("invoices.send.errors.invalidState");
  });
});
