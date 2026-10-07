import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { edgeResponseContext } from "@/lib/edgeErrors";
import type { QuoteBlocker } from "../lib/quotePreflight";

type Client = SupabaseClient<Database>;

export type SendBody = { to: string[]; cc: string[]; message: string };

/** A failed werkbank-quotes call: the edge function's `{ error: code }` plus, for
 *  `preflight_failed`, the blockers it found. */
export class QuoteActionError extends Error {
  constructor(readonly code: string, readonly blockers: QuoteBlocker[] = []) {
    super(code);
    this.name = "QuoteActionError";
  }
}

/** The i18n key (werkbank namespace) for an edge error code. Technical failures share one
 *  retry message; preflight blockers are listed separately by the caller. */
export function quoteActionErrorKey(code: string): string {
  switch (code) {
    case "forbidden":
    case "unauthorized":
    case "not_handwerk":
      return "quotes.send.errors.forbidden";
    case "not_found":
      return "quotes.send.errors.notFound";
    case "invalid_state":
      return "quotes.send.errors.invalidState";
    case "invalid_recipient":
      return "quotes.send.errors.invalidRecipient";
    case "too_many_recipients":
      return "quotes.send.errors.tooManyRecipients";
    case "pdf_missing":
      return "quotes.send.errors.pdfMissing";
    case "preflight_failed":
      return "quotes.send.errors.preflight";
    default:
      // load_failed, render_failed, upload_failed, update_failed, sign_failed, unknown_action, bad_request, unknown
      return "quotes.send.errors.generic";
  }
}

async function readError(error: unknown): Promise<QuoteActionError> {
  const res = edgeResponseContext(error);
  if (!res) return new QuoteActionError("unknown");
  try {
    const body = (await res.clone().json()) as { error?: unknown; blockers?: unknown };
    const code = typeof body.error === "string" ? body.error : "unknown";
    return new QuoteActionError(code, Array.isArray(body.blockers) ? (body.blockers as QuoteBlocker[]) : []);
  } catch {
    return new QuoteActionError("unknown");
  }
}

async function invoke<T>(orgId: string, quoteId: string, client: Client, action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.functions.invoke("werkbank-quotes", {
    body: { action, org_id: orgId, quote_id: quoteId, ...extra },
  });
  if (error) throw await readError(error);
  return data as T;
}

/** Renders the watermarked draft PDF and returns a blob URL for it. The caller shows it in a
 *  tab it opened before the call (see lib/pdfTab.ts). The URL is freed when the page unloads. */
export async function previewQuote(client: Client, orgId: string, quoteId: string): Promise<string> {
  const { pdf_base64 } = await invoke<{ pdf_base64: string }>(orgId, quoteId, client, "preview");
  const bytes = Uint8Array.from(atob(pdf_base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  window.addEventListener("pagehide", () => URL.revokeObjectURL(url), { once: true });
  return url;
}

export async function sendQuote(client: Client, orgId: string, quoteId: string, body: SendBody): Promise<{ emailSent: boolean }> {
  const res = await invoke<{ email_sent: boolean }>(orgId, quoteId, client, "send", body);
  return { emailSent: res.email_sent };
}

/** Mails the stored PDF again with a new link; links sent earlier stop working. */
export async function resendQuote(client: Client, orgId: string, quoteId: string, body: SendBody): Promise<{ emailSent: boolean }> {
  const res = await invoke<{ email_sent: boolean }>(orgId, quoteId, client, "resend", body);
  return { emailSent: res.email_sent };
}

export async function quoteDownloadUrl(client: Client, orgId: string, quoteId: string, kind: "sent" | "accepted"): Promise<string> {
  const res = await invoke<{ url: string }>(orgId, quoteId, client, "download-url", { kind });
  return res.url;
}
