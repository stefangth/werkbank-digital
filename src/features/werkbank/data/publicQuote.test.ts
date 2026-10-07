import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import { decidePublicQuote, fetchPublicQuote, PublicQuoteError } from "./publicQuote";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) => fake as unknown as SupabaseClient<Database>;
const FN = "fn:werkbank-quotes";
const TOKEN = "a".repeat(64);
const fail = (status: number, body: unknown) => ({ data: null, error: { context: new Response(JSON.stringify(body), { status }) } });

describe("fetchPublicQuote", () => {
  it("posts the view action with the token and returns the open view", async () => {
    const view = { quote: { quote_no: "A-1", version: 1, number: "A-1" }, consent_text: "Ich nehme an" };
    const fake = createFakeSupabase({ [FN]: { data: view, error: null } });
    expect(await fetchPublicQuote(asClient(fake), TOKEN)).toEqual({ kind: "open", view });
    expect(fake.calls).toContainEqual({ table: FN, method: "invoke", args: [{ action: "view", token: TOKEN }] });
  });

  it.each(["not_found", "superseded", "revoked", "expired"])("maps %s to a closed state", async (code) => {
    const fake = createFakeSupabase({ [FN]: fail(code === "not_found" ? 404 : 410, { error: code }) });
    expect(await fetchPublicQuote(asClient(fake), TOKEN)).toEqual({ kind: "closed", reason: code });
  });

  it("keeps decision and pdf url of a decided link", async () => {
    const fake = createFakeSupabase({ [FN]: fail(410, { error: "decided", decision: "accepted", pdf_url: "https://x/y.pdf" }) });
    expect(await fetchPublicQuote(asClient(fake), TOKEN)).toEqual({ kind: "closed", reason: "decided", decision: "accepted", pdfUrl: "https://x/y.pdf" });
  });

  it("derives a missing number without changing the response object", async () => {
    const data = { quote: { quote_no: "A-0042", version: 2 }, consent_text: "Ich nehme an" };
    const fake = createFakeSupabase({ [FN]: { data, error: null } });
    const state = await fetchPublicQuote(asClient(fake), TOKEN);
    expect(state).toEqual({ kind: "open", view: { ...data, quote: { ...data.quote, number: "A-0042-2" } } });
    expect(data.quote).toEqual({ quote_no: "A-0042", version: 2 });
  });

  it.each([null, {}, { quote: null }])("throws a PublicQuoteError for an answer without a quote (%j)", async (data) => {
    const fake = createFakeSupabase({ [FN]: { data, error: null } });
    await expect(fetchPublicQuote(asClient(fake), TOKEN)).rejects.toMatchObject({ name: "PublicQuoteError", code: "unknown" });
  });

  it("throws a PublicQuoteError for a technical failure", async () => {
    const fake = createFakeSupabase({ [FN]: fail(500, { error: "load_failed" }) });
    await expect(fetchPublicQuote(asClient(fake), TOKEN)).rejects.toMatchObject({ name: "PublicQuoteError", code: "load_failed" });
  });
});

describe("decidePublicQuote", () => {
  const body = { decision: "accepted" as const, signerName: "Anna Muster", signature: { method: "typed" as const, typedName: "Anna Muster" }, consent: true };

  it("posts the decide action and returns the pdf url of an accept", async () => {
    const fake = createFakeSupabase({ [FN]: { data: { ok: true, pdf_url: "https://x/a.pdf" }, error: null } });
    expect(await decidePublicQuote(asClient(fake), TOKEN, body)).toEqual({ kind: "done", pdfUrl: "https://x/a.pdf" });
    expect(fake.calls).toContainEqual({
      table: FN, method: "invoke",
      args: [{ action: "decide", token: TOKEN, decision: "accepted", signer_name: "Anna Muster", signature: body.signature, consent: true }],
    });
  });

  it("sends the comment of a rejection without signature or consent", async () => {
    const fake = createFakeSupabase({ [FN]: { data: { ok: true }, error: null } });
    expect(await decidePublicQuote(asClient(fake), TOKEN, { decision: "rejected", signerName: "Anna", comment: "Zu teuer" })).toEqual({ kind: "done", pdfUrl: null });
    expect(fake.calls).toContainEqual({ table: FN, method: "invoke", args: [{ action: "decide", token: TOKEN, decision: "rejected", signer_name: "Anna", comment: "Zu teuer" }] });
  });

  it("returns the closed state for a 410 superseded", async () => {
    const fake = createFakeSupabase({ [FN]: fail(410, { error: "superseded" }) });
    expect(await decidePublicQuote(asClient(fake), TOKEN, body)).toEqual({ kind: "closed", reason: "superseded" });
  });

  it("throws the 422 code so the form can show it", async () => {
    const fake = createFakeSupabase({ [FN]: fail(422, { error: "invalid_signer_name" }) });
    const err = await decidePublicQuote(asClient(fake), TOKEN, body).catch((e) => e);
    expect(err).toBeInstanceOf(PublicQuoteError);
    expect(err.code).toBe("invalid_signer_name");
  });
});
