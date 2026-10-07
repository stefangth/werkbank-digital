/** UN/ECE Rec. 20 unit codes used for catalog items and positions. */
export const UNIT_CODES = ["HUR", "H87", "MTR", "MTK", "MTQ", "KGM", "LTR", "LS"] as const;

export type UnitCode = (typeof UNIT_CODES)[number];

export function unitLabelKey(code: UnitCode): string {
  return `units.${code}`;
}
