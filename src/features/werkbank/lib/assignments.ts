import type { AssignmentRow } from "../data/technicianApp";

export type GroupKey = "overdue" | "today" | "upcoming" | "unscheduled" | "done";
export const GROUP_ORDER: GroupKey[] = ["overdue", "today", "upcoming", "unscheduled", "done"];

/** Open work is kept for offline use; unscheduled and done orders are online only. */
export function isOfflineGroup(key: GroupKey): boolean {
  return key === "overdue" || key === "today" || key === "upcoming";
}

const cmp = (a: string | null, b: string | null): number => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);

/** The list groups in display order, empty groups dropped, rows by date, time, then order number. */
export function groupAssignments(rows: AssignmentRow[]): { key: GroupKey; rows: AssignmentRow[] }[] {
  return GROUP_ORDER.map((key) => ({
    key,
    rows: rows.filter((r) => r.group_key === key).sort((a, b) =>
      cmp(a.scheduled_date, b.scheduled_date) || cmp(a.scheduled_time, b.scheduled_time) || cmp(a.order_no, b.order_no)),
  })).filter((g) => g.rows.length > 0);
}
