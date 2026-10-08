import type { DunningBlocker } from "./dunningDefaults";

export type DunningBlockerInput = {
  invoice: { status: string; type: string; due_date: string | null };
  openAmount: number | null | undefined;
  hold: { until: string | null } | null | undefined;
  notices: { stage: number; pdf_path: string | null; delivery: string; sent_at: string | null }[];
  /** Berlin today, YYYY-MM-DD. */
  today: string;
};

/** Why the next notice cannot be created, in the order the tooltip names them. The names and rules
 *  are those of the SQL guard (`dunning_not_allowed`); the server stays the authority. */
export function dunningBlockers({ invoice, openAmount, hold, notices, today }: DunningBlockerInput): DunningBlocker[] {
  const latest = notices.reduce<DunningBlockerInput["notices"][number] | null>((a, n) => (!a || n.stage > a.stage ? n : a), null);
  const out: DunningBlocker[] = [];
  if (invoice.status !== "issued" || invoice.type !== "invoice") out.push("not_issued");
  if (!invoice.due_date || invoice.due_date >= today) out.push("not_overdue");
  if ((openAmount ?? 0) <= 0) out.push("nothing_open");
  if (hold && (hold.until === null || hold.until >= today)) out.push("on_hold");
  if (latest && (!latest.pdf_path || (latest.delivery === "email" && !latest.sent_at))) out.push("previous_stage_open");
  if (latest && latest.stage >= 3) out.push("max_stage");
  return out;
}

/** The stage the next notice gets (1 to 3); 3 when the last stage already exists. */
export const nextDunningStage = (notices: { stage: number }[]): 1 | 2 | 3 =>
  Math.min(Math.max(0, ...notices.map((n) => n.stage)) + 1, 3) as 1 | 2 | 3;

/** `key` (YYYY-MM-DD) plus `days` calendar days. */
export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
