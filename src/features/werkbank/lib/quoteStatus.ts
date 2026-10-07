import type { Tone } from "@/components/ui/tones";

export type QuoteDisplayStatus = "draft" | "sent" | "accepted" | "rejected" | "expired" | "superseded";

export const QUOTE_DISPLAY_STATUSES: readonly QuoteDisplayStatus[] = ["draft", "sent", "accepted", "rejected", "expired", "superseded"];

/** The status a person sees: `expired` is derived (a sent quote past its validity), never stored. */
export function quoteDisplayStatus(q: { status: string | null; is_expired: boolean | null }): QuoteDisplayStatus {
  if (q.status === "sent") return q.is_expired ? "expired" : "sent";
  if (q.status === "accepted" || q.status === "rejected" || q.status === "superseded") return q.status;
  return "draft";
}

/** Amber is waiting on the customer, red is risk. */
export const QUOTE_STATUS_TONE: Record<QuoteDisplayStatus, Tone> = {
  draft: "neutral",
  sent: "waiting",
  accepted: "confirmed",
  rejected: "risk",
  expired: "risk",
  superseded: "neutral",
};
