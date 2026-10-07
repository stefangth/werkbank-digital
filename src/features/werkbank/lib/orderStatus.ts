import type { Tone } from "@/components/ui/tones";

export type OrderStatus = "open" | "in_progress" | "done" | "cancelled";
export type OrderAction = "start" | "complete" | "reopen" | "cancel";

/** Amber is waiting on the business to start, accent is under way. */
export const ORDER_STATUS_TONES: Record<OrderStatus, Tone> = {
  open: "waiting",
  in_progress: "accent",
  done: "confirmed",
  cancelled: "neutral",
};

/** The actions the database transition trigger allows from a status. */
export function nextOrderActions(status: OrderStatus): OrderAction[] {
  switch (status) {
    case "open": return ["start", "cancel"];
    case "in_progress": return ["complete", "cancel"];
    case "done": return ["reopen"];
    default: return [];
  }
}

/** The status an action moves an order to. */
export const ORDER_ACTION_TARGET: Record<OrderAction, OrderStatus> = {
  start: "in_progress",
  complete: "done",
  reopen: "in_progress",
  cancel: "cancelled",
};

/** An order that is still to be done but has no date yet: what "Aufträge ohne Termin" counts. */
export function needsSchedule(o: { status: string | null; scheduled_date: string | null }): boolean {
  return !o.scheduled_date && (o.status === "open" || o.status === "in_progress");
}
