import { describe, it, expect, vi } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import { fetchQuoteAcceptances, signatureUrl } from "./quoteAcceptances";

describe("quote acceptances data", () => {
  it("reads the decisions of one quote, oldest first", async () => {
    const fake = createFakeSupabase({ "werkbank.quote_acceptances": { data: [{ id: "a1" }], error: null } });
    expect(await fetchQuoteAcceptances(asSupabase(fake), "q1")).toEqual([{ id: "a1" }]);
    expect(fake.calls).toContainEqual({ table: "werkbank.quote_acceptances", method: "eq", args: ["quote_id", "q1"] });
    expect(fake.calls).toContainEqual({ table: "werkbank.quote_acceptances", method: "order", args: ["decided_at", { ascending: true }] });
  });
  it("throws a read error", async () => {
    const fake = createFakeSupabase({ "werkbank.quote_acceptances": { data: null, error: new Error("boom") } });
    await expect(fetchQuoteAcceptances(asSupabase(fake), "q1")).rejects.toThrow("boom");
  });
  it("signs a signature image for 600 seconds from the documents bucket", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: "https://x/s" }, error: null });
    const from = vi.fn().mockReturnValue({ createSignedUrl });
    expect(await signatureUrl({ storage: { from } } as never, "o/q/sig.png")).toBe("https://x/s");
    expect(from).toHaveBeenCalledWith("werkbank-documents");
    expect(createSignedUrl).toHaveBeenCalledWith("o/q/sig.png", 600);
  });
});
