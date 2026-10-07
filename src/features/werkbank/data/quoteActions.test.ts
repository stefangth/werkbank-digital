import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  previewQuote, QuoteActionError, quoteActionErrorKey, quoteDownloadUrl, resendQuote, sendQuote,
} from "./quoteActions";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) => fake as unknown as SupabaseClient<Database>;
const FN = "fn:werkbank-quotes";
const body = { to: ["a@example.de"], cc: [], message: "Hallo" };

afterEach(() => vi.unstubAllGlobals());

describe("sendQuote", () => {
  it("posts the send action and maps email_sent", async () => {
    const fake = createFakeSupabase({ [FN]: { data: { ok: true, email_sent: false }, error: null } });
    expect(await sendQuote(asClient(fake), "org-1", "q1", body)).toEqual({ emailSent: false });
    expect(fake.calls).toContainEqual({ table: FN, method: "invoke", args: [{ action: "send", org_id: "org-1", quote_id: "q1", ...body }] });
  });

  it("throws a QuoteActionError with the code and blockers of the response body", async () => {
    const error = { context: new Response(JSON.stringify({ error: "preflight_failed", blockers: ["no_items"] }), { status: 422 }) };
    const fake = createFakeSupabase({ [FN]: { data: null, error } });
    const err = await sendQuote(asClient(fake), "org-1", "q1", body).catch((e) => e);
    expect(err).toBeInstanceOf(QuoteActionError);
    expect(err).toMatchObject({ code: "preflight_failed", blockers: ["no_items"] });
  });

  it("falls back to the code unknown when the error has no readable body", async () => {
    const fake = createFakeSupabase({ [FN]: { data: null, error: new Error("boom") } });
    await expect(sendQuote(asClient(fake), "org-1", "q1", body)).rejects.toMatchObject({ code: "unknown" });
  });
});

describe("resendQuote", () => {
  it("posts the resend action", async () => {
    const fake = createFakeSupabase({ [FN]: { data: { ok: true, email_sent: true }, error: null } });
    expect(await resendQuote(asClient(fake), "org-1", "q1", body)).toEqual({ emailSent: true });
    expect(fake.calls).toContainEqual(expect.objectContaining({ args: [expect.objectContaining({ action: "resend" })] }));
  });
});

describe("previewQuote", () => {
  it("opens the decoded PDF from a blob url in a new tab", async () => {
    const open = vi.fn();
    const createObjectURL = vi.fn((_blob: Blob) => "blob:pdf");
    vi.stubGlobal("open", open);
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const fake = createFakeSupabase({ [FN]: { data: { pdf_base64: btoa("%PDF-1.4") }, error: null } });
    await previewQuote(asClient(fake), "org-1", "q1");
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBe(8);
    expect(open).toHaveBeenCalledWith("blob:pdf", "_blank");
    expect(fake.calls).toContainEqual({ table: FN, method: "invoke", args: [{ action: "preview", org_id: "org-1", quote_id: "q1" }] });
  });
});

describe("quoteDownloadUrl", () => {
  it("returns the signed url for the kind", async () => {
    const fake = createFakeSupabase({ [FN]: { data: { url: "https://signed" }, error: null } });
    expect(await quoteDownloadUrl(asClient(fake), "org-1", "q1", "accepted")).toBe("https://signed");
    expect(fake.calls).toContainEqual({ table: FN, method: "invoke", args: [{ action: "download-url", org_id: "org-1", quote_id: "q1", kind: "accepted" }] });
  });
});

describe("quoteActionErrorKey", () => {
  it("groups the technical failures under one generic key", () => {
    const technical = ["load_failed", "render_failed", "upload_failed", "update_failed", "sign_failed", "unknown_action", "bad_request", "unknown"];
    expect(new Set(technical.map(quoteActionErrorKey))).toEqual(new Set(["quotes.send.errors.generic"]));
  });
  it("maps the specific codes", () => {
    expect(quoteActionErrorKey("forbidden")).toBe("quotes.send.errors.forbidden");
    expect(quoteActionErrorKey("not_handwerk")).toBe("quotes.send.errors.forbidden");
    expect(quoteActionErrorKey("unauthorized")).toBe("quotes.send.errors.forbidden");
    expect(quoteActionErrorKey("not_found")).toBe("quotes.send.errors.notFound");
    expect(quoteActionErrorKey("invalid_state")).toBe("quotes.send.errors.invalidState");
    expect(quoteActionErrorKey("invalid_recipient")).toBe("quotes.send.errors.invalidRecipient");
    expect(quoteActionErrorKey("too_many_recipients")).toBe("quotes.send.errors.tooManyRecipients");
    expect(quoteActionErrorKey("pdf_missing")).toBe("quotes.send.errors.pdfMissing");
    expect(quoteActionErrorKey("preflight_failed")).toBe("quotes.send.errors.preflight");
  });
});
