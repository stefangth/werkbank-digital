import type { Tone } from "@/components/ui/tones";

export const INVOICE_STATUSES = ["draft", "issued", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Amber is waiting, red is risk: a draft waits to be issued, an issued invoice is settled paper. */
export const INVOICE_STATUS_TONES: Record<InvoiceStatus, Tone> = {
  draft: "neutral",
  issued: "confirmed",
  cancelled: "neutral",
};

/** The amount as it counts: a cancellation reverses the invoice, so it is negative. */
export function signedGross(row: { type: string | null; gross_total: number | null }): number {
  const gross = row.gross_total ?? 0;
  return row.type === "cancellation" ? -Math.abs(gross) : gross;
}
