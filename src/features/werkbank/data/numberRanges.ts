import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

export type NumberRangeKey = "customer";
export type NumberRange = { prefix: string; next_value: number; padding: number };

/** What the database applies for a key without a row (Task 2: next_number creates it on first use). */
const DEFAULTS: Record<NumberRangeKey, NumberRange> = {
  customer: { prefix: "K-", next_value: 10001, padding: 0 },
};

/** Mirrors the SQL `prefix || lpad(v::text, greatest(padding, length(v::text)), '0')`:
 *  a padding below the digit count never truncates. */
export function formatNumber(prefix: string, value: number, padding: number): string {
  return prefix + String(value).padStart(padding, "0");
}

/** The org's range for `key`; a missing row means the defaults apply. The `.from(...)` and the
 *  `org_id` filter stay in one statement: src/test/orgScoping.test.ts scans for it. */
export async function fetchNumberRange(client: Client, orgId: string, key: NumberRangeKey): Promise<NumberRange> {
  const { data, error } = await client.schema("werkbank").from("number_ranges").select("prefix, next_value, padding").eq("org_id", orgId).eq("key", key).maybeSingle();
  if (error) throw error;
  if (!data) return { ...DEFAULTS[key] };
  return { prefix: data.prefix, next_value: Number(data.next_value), padding: data.padding };
}

export async function saveNumberRange(client: Client, orgId: string, key: NumberRangeKey, values: NumberRange): Promise<void> {
  const { error } = await client.schema("werkbank").from("number_ranges")
    .upsert({ org_id: orgId, key, prefix: values.prefix, next_value: values.next_value, padding: values.padding }, { onConflict: "org_id,key" });
  if (error) throw error;
}
