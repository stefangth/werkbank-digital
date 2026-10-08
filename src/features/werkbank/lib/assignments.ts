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

/** Ids of the orders whose details are kept for offline use. */
export function offlineOrderIds(rows: Pick<AssignmentRow, "id" | "group_key">[]): Set<string> {
  return new Set(rows.filter((r) => isOfflineGroup(r.group_key as GroupKey)).map((r) => r.id));
}

/** Which queries the offline cache keeps: the list `["werkbank", "assignments", user, org]` and
 *  the details `[..., orderId]` of offline-group orders. Nothing else, signed URLs least of all. */
export function shouldPersistQuery(query: { queryKey: readonly unknown[] }, offlineIds: Set<string>): boolean {
  const k = query.queryKey;
  if (k[0] !== "werkbank" || k[1] !== "assignments") return false;
  if (k.length === 4) return true;
  return k.length === 5 && typeof k[4] === "string" && offlineIds.has(k[4]);
}
