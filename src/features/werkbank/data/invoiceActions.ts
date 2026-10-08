import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { edgeResponseContext } from "@/lib/edgeErrors";
import type { InvoiceBlocker } from "../lib/invoicePreflight";

type Client = SupabaseClient<Database>;

export type InvoiceSendBody = { to: string[]; cc: string[]; message: string };

/** A failed werkbank-invoices call: the edge function's `{ error: code }` plus the blockers of a
 *  `preflight_failed`, and `issued` when the invoice was already issued before the failure
 *  (`render_failed`, `send_failed`), so the caller can say "issued, but ...". `reason` is the
 *  finalize reason of an `invalid_state` (`invalid_transition`, `order_not_done`). */
export class InvoiceActionError extends Error {
  constructor(
    readonly code: string,
    readonly blockers: InvoiceBlocker[] = [],
    readonly issued = false,
    readonly reason?: string,
  ) {
    super(code);
    this.name = "InvoiceActionError";
  }
}

/** The i18n key (werkbank namespace) for an edge error code. Technical failures share one
 *  retry message; blockers are listed separately by the caller. */
export function invoiceActionErrorKey(code: string, reason?: string): string {
  if (code === "invalid_state" && reason === "order_not_done") return "errors.orderNotDone";
  switch (code) {
    case "forbidden":
    case "unauthorized":
    case "not_handwerk":
      return "invoices.send.errors.forbidden";
    case "not_found":
      return "invoices.send.errors.notFound";
    case "invalid_state":
      return "invoices.send.errors.invalidState";
    case "invalid_recipient":
    case "no_recipient":
      return "invoices.send.errors.invalidRecipient";
    case "too_many_recipients":
      return "invoices.send.errors.tooManyRecipients";
    case "pdf_missing":
      return "invoices.send.errors.pdfMissing";
    case "preflight_failed":
      return "invoices.send.errors.preflight";
    case "send_failed":
      return "invoices.send.errors.sendFailed";
    default:
      // load_failed, render_failed, upload_failed, update_failed, unknown_action, bad_request, unknown
      return "invoices.send.errors.generic";
  }
}

async function readError(error: unknown): Promise<InvoiceActionError> {
  const res = edgeResponseContext(error);
  if (!res) return new InvoiceActionError("unknown");
  try {
    const body = (await res.clone().json()) as { error?: unknown; blockers?: unknown; issued?: unknown; reason?: unknown };
    const code = typeof body.error === "string" ? body.error : "unknown";
    return new InvoiceActionError(
      code,
      Array.isArray(body.blockers) ? (body.blockers as InvoiceBlocker[]) : [],
      body.issued === true,
      typeof body.reason === "string" ? body.reason : undefined,
    );
  } catch {
    return new InvoiceActionError("unknown");
  }
}

async function invoke<T>(client: Client, orgId: string, invoiceId: string, action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.functions.invoke("werkbank-invoices", {
    body: { action, org_id: orgId, invoice_id: invoiceId, ...extra },
  });
  if (error) throw await readError(error);
  return data as T;
}

/** Renders the watermarked draft PDF and returns its base64 bytes. */
export async function previewInvoice(client: Client, orgId: string, invoiceId: string): Promise<string> {
  const { pdf_base64 } = await invoke<{ pdf_base64: string }>(client, orgId, invoiceId, "preview");
  return pdf_base64;
}

/** Issues the draft (number, PDF, e-invoice) and optionally mails it in the same call. */
export async function issueInvoice(
  client: Client,
  orgId: string,
  invoiceId: string,
  send?: InvoiceSendBody,
): Promise<{ invoiceNo: string; emailSent?: boolean }> {
  const res = await invoke<{ invoice_no: string; email_sent?: boolean }>(client, orgId, invoiceId, "issue", send ? { send } : {});
  return { invoiceNo: res.invoice_no, emailSent: res.email_sent };
}

/** Mails the stored PDF of an issued invoice. */
export async function sendInvoice(client: Client, orgId: string, invoiceId: string, body: InvoiceSendBody): Promise<{ emailSent: boolean }> {
  const res = await invoke<{ email_sent: boolean }>(client, orgId, invoiceId, "send", body);
  return { emailSent: res.email_sent };
}

export async function invoiceDownloadUrl(client: Client, orgId: string, invoiceId: string): Promise<string> {
  const res = await invoke<{ url: string }>(client, orgId, invoiceId, "download-url");
  return res.url;
}
