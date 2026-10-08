import type { TFunction } from "i18next";
import { z } from "zod";
import { parseEuroInput } from "../lib/money";

export type RecordEntryMode = "payment" | "write_off" | "refund";
export const WRITE_OFF_REASONS = ["skonto", "goodwill", "bad_debt", "other"] as const;

/** A payment, write-off or refund. The amount is typed text (German or plain euro input); a
 *  write-off has no typed amount (it is always the open amount), a refund may not exceed the
 *  credit (`max`). A payment above the open amount is allowed: the rest becomes credit. */
export const recordEntrySchema = (t: TFunction, mode: RecordEntryMode, max?: number) =>
  z.object({
    amount: z.string(),
    bookedOn: z.string().min(1, t("payments.errors.date")),
    note: z.string(),
    writeOffReason: z.enum(["", ...WRITE_OFF_REASONS]),
  }).superRefine((v, ctx) => {
    const fail = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (mode === "write_off") {
      if (!v.writeOffReason) fail("writeOffReason", t("payments.errors.reason"));
      else if (v.writeOffReason === "other" && !v.note.trim()) fail("note", t("payments.errors.noteRequired"));
      return;
    }
    const amount = parseEuroInput(v.amount);
    if (amount === null) fail("amount", t("payments.errors.amount"));
    else if (mode === "refund" && max !== undefined && Math.round(amount * 100) > Math.round(max * 100)) {
      fail("amount", t("payments.errors.refundMax"));
    }
  });
export type RecordEntryForm = z.infer<ReturnType<typeof recordEntrySchema>>;

export const reverseEntrySchema = (t: TFunction) =>
  z.object({ reason: z.string().trim().min(1, t("payments.errors.reversalReason")) });
export type ReverseEntryForm = z.infer<ReturnType<typeof reverseEntrySchema>>;

export const transferEntrySchema = (t: TFunction) =>
  z.object({
    targetInvoiceId: z.string().min(1, t("payments.errors.target")),
    reason: z.string().trim().min(1, t("payments.errors.transferReason")),
  });
export type TransferEntryForm = z.infer<ReturnType<typeof transferEntrySchema>>;
