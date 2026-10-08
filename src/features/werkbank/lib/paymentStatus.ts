import type { Tone } from "@/components/ui/tones";
import type { InvoiceBalance } from "../data/invoiceEntries";

/** Label key (`werkbank` namespace) and tone of an invoice's payment state. Amber is overdue and
 *  waiting on the customer; red from the second notice on, while something is still open. */
export function paymentStatus(
  row: Pick<InvoiceBalance, "payment_state" | "days_overdue" | "last_stage">,
): { labelKey: string; tone: Tone } {
  const overdue = (row.days_overdue ?? 0) > 0;
  switch (row.payment_state) {
    case "paid": return { labelKey: "openItems.state.paid", tone: "confirmed" };
    case "written_off": return { labelKey: "openItems.state.writtenOff", tone: "confirmed" };
    case "void": return { labelKey: "openItems.state.void", tone: "neutral" };
    case "overpaid": return { labelKey: "openItems.state.overpaid", tone: "accent" };
    case "partial":
    case "open":
      if (overdue) return { labelKey: "openItems.state.overdue", tone: (row.last_stage ?? 0) >= 2 ? "risk" : "waiting" };
      return { labelKey: row.payment_state === "partial" ? "openItems.state.partial" : "openItems.state.open", tone: "neutral" };
    default: return { labelKey: "openItems.state.open", tone: "neutral" };
  }
}
