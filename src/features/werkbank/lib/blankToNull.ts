/** Trims string values; empty strings become `null`. Non-strings pass through. */
export function blankToNull<T extends Record<string, unknown>>(
  values: T,
): { [K in keyof T]: T[K] extends string ? string | null : T[K] } {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      out[key] = trimmed === "" ? null : trimmed;
    } else {
      out[key] = value;
    }
  }
  return out as { [K in keyof T]: T[K] extends string ? string | null : T[K] };
}
