import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { edgeResponseContext } from "@/lib/edgeErrors";
import { invoiceActionErrorKey } from "./invoiceActions";

type Client = SupabaseClient<Database>;

export type DunningRecipients = { to?: string[]; cc?: string[]; message?: string };

/** A failed werkbank-dunning call: the edge function's `{ error: code }` plus the `blockers` of a
 *  `not_allowed`, and `issued` when the notice already exists (`render_failed`, `send_failed`), so
 *  the caller can say "created, but ...". */
export class DunningActionError extends Error {
  constructor(
    readonly code: string,
    readonly blockers: string[] = [],
    readonly issued = false,
  ) {
    super(code);
    this.name = "DunningActionError";
  }
}

/** The `werkbank` i18n key for a werkbank-dunning error code (not_allowed is shown as its blockers). */
export function dunningActionErrorKey(code: string): string {
  if (code === "no_recipient") return "dunning.errors.noRecipient";
  if (code === "invoice_file_missing") return "dunning.errors.invoiceFileMissing";
  if (code === "not_latest_notice") return "dunning.errors.notLatestNotice";
  return invoiceActionErrorKey(code);
}

async function readError(error: unknown): Promise<DunningActionError> {
  const res = edgeResponseContext(error);
  if (!res) return new DunningActionError("unknown");
  try {
    const body = (await res.clone().json()) as { error?: unknown; blockers?: unknown; issued?: unknown };
    return new DunningActionError(
      typeof body.error === "string" ? body.error : "unknown",
      Array.isArray(body.blockers) ? body.blockers.filter((b): b is string => typeof b === "string") : [],
      body.issued === true,
    );
  } catch {
    return new DunningActionError("unknown");
  }
}

async function invoke<T>(client: Client, action: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke("werkbank-dunning", { body: { action, ...body } });
  if (error) throw await readError(error);
  return data as T;
}

/** Renders the watermarked next notice of an invoice; resolves to the PDF bytes (nothing is stored). */
export async function previewDunning(client: Client, a: { orgId: string; invoiceId: string; paymentDeadline?: string }): Promise<Blob> {
  return invoke<Blob>(client, "preview", { org_id: a.orgId, invoice_id: a.invoiceId, payment_deadline: a.paymentDeadline });
}

/** Creates the next notice, renders it and, for email delivery, sends it in the same call. */
export async function issueDunning(
  client: Client,
  a: { orgId: string; invoiceId: string; delivery: "email" | "print"; paymentDeadline?: string; send?: DunningRecipients },
): Promise<{ noticeId: string; stage: number; emailSent?: boolean }> {
  const res = await invoke<{ notice_id: string; stage: number; email_sent?: boolean }>(client, "issue", {
    org_id: a.orgId, invoice_id: a.invoiceId, delivery: a.delivery, payment_deadline: a.paymentDeadline, send: a.send,
  });
  return { noticeId: res.notice_id, stage: res.stage, emailSent: res.email_sent };
}

/** Mails (or re-mails) the stored PDF of an existing notice. */
export async function sendDunning(client: Client, a: { orgId: string; noticeId: string } & DunningRecipients): Promise<void> {
  await invoke(client, "send", { org_id: a.orgId, notice_id: a.noticeId, to: a.to, cc: a.cc, message: a.message });
}

export async function dunningDownloadUrl(client: Client, orgId: string, noticeId: string): Promise<string> {
  const res = await invoke<{ url: string }>(client, "download-url", { org_id: orgId, notice_id: noticeId });
  return res.url;
}
