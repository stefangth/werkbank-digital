import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { edgeResponseContext } from "@/lib/edgeErrors";
import type { SignatureValue } from "@/components/common/SignaturePad";

type Client = SupabaseClient<Database>;

export type PublicQuoteRow =
  | { kind: "item"; number: string; name: string; description?: string | null; quantity: number; unit: string; unitPrice: number; lineNet: number }
  | { kind: "text"; name: string; description?: string | null };

export type PublicQuoteView = {
  quote: {
    /** The display number the PDF prints: `A-0042`, from version 2 `A-0042-2`. */
    quote_no: string; version: number; number: string; status: string; date: string; valid_until: string;
    subject: string; intro: string; closing: string; payment_terms: string;
    recipient_lines: string[]; location_lines: string[];
  };
  seller: {
    company_name: string; legal_form: string | null; street: string; postal_code: string; city: string;
    phone: string | null; email: string | null; website: string | null; logo_url: string | null;
  };
  items: { title: string; number: string; subtotal: number; rows: PublicQuoteRow[] }[];
  totals: {
    net: number; discount: number; discountPercent: number;
    vat: { rate: number; net: number; vat: number }[]; gross: number; labour?: number;
  };
  pdf_url: string;
  consent_text: string;
};

export type ClosedReason = "not_found" | "superseded" | "revoked" | "expired" | "decided";
export type ClosedState = { kind: "closed"; reason: ClosedReason; decision?: "accepted" | "rejected"; pdfUrl?: string | null };
export type PublicQuoteState = { kind: "open"; view: PublicQuoteView } | ClosedState;

/** A technical or validation failure of a public call (everything that is not a link state). */
export class PublicQuoteError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PublicQuoteError";
  }
}

const CLOSED: ReadonlySet<string> = new Set(["not_found", "superseded", "revoked", "expired", "decided"]);

type ErrorBody = { error?: unknown; decision?: unknown; pdf_url?: unknown };

async function readBody(error: unknown): Promise<ErrorBody> {
  const res = edgeResponseContext(error);
  if (!res) return {};
  try {
    return (await res.clone().json()) as ErrorBody;
  } catch {
    return {};
  }
}

/** A link state answer (404/410) as a closed state, or a PublicQuoteError for anything else. */
async function toClosedOrThrow(error: unknown): Promise<ClosedState> {
  const body = await readBody(error);
  const code = typeof body.error === "string" ? body.error : "unknown";
  if (!CLOSED.has(code)) throw new PublicQuoteError(code);
  const closed: ClosedState = { kind: "closed", reason: code as ClosedReason };
  if (code === "decided") {
    if (body.decision === "accepted" || body.decision === "rejected") closed.decision = body.decision;
    if (typeof body.pdf_url === "string") closed.pdfUrl = body.pdf_url;
  }
  return closed;
}

export async function fetchPublicQuote(client: Client, token: string): Promise<PublicQuoteState> {
  const { data, error } = await client.functions.invoke("werkbank-quotes", { body: { action: "view", token } });
  if (error) return toClosedOrThrow(error);
  return { kind: "open", view: data as PublicQuoteView };
}

export type DecideBody =
  | { decision: "accepted"; signerName: string; signature: SignatureValue; consent: boolean }
  | { decision: "rejected"; signerName: string; comment?: string };

export type DecideResult = { kind: "done"; pdfUrl: string | null } | ClosedState;

export async function decidePublicQuote(client: Client, token: string, body: DecideBody): Promise<DecideResult> {
  const payload: Record<string, unknown> = { action: "decide", token, decision: body.decision, signer_name: body.signerName };
  if (body.decision === "accepted") {
    payload.signature = body.signature;
    payload.consent = body.consent;
  } else if (body.comment) {
    payload.comment = body.comment;
  }
  const { data, error } = await client.functions.invoke("werkbank-quotes", { body: payload });
  if (error) return toClosedOrThrow(error);
  const pdfUrl = (data as { pdf_url?: unknown } | null)?.pdf_url;
  return { kind: "done", pdfUrl: typeof pdfUrl === "string" ? pdfUrl : null };
}
