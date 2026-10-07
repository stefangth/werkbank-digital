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

/** What the settings tab saves. `next_value` is left out when the admin did not change it, so a
 *  prefix-only save never moves the counter (numbers assigned since the page loaded stay counted). */
export type NumberRangeSave = { prefix: string; padding: number; next_value?: number };

export async function saveNumberRange(client: Client, orgId: string, key: NumberRangeKey, values: NumberRangeSave): Promise<void> {
  if (values.next_value !== undefined) {
    const { error } = await client.schema("werkbank").from("number_ranges")
      .upsert({ org_id: orgId, key, prefix: values.prefix, next_value: values.next_value, padding: values.padding }, { onConflict: "org_id,key" });
    if (error) throw error;
    return;
  }
  // Without a row nothing has been numbered yet, so the default next value is still right; an existing
  // row is left alone here (do nothing on conflict) and only its prefix and padding are updated.
  const { error: insertError } = await client.schema("werkbank").from("number_ranges")
    .upsert({ org_id: orgId, key, prefix: values.prefix, next_value: DEFAULTS[key].next_value, padding: values.padding }, { onConflict: "org_id,key", ignoreDuplicates: true });
  if (insertError) throw insertError;
  const { error } = await client.schema("werkbank").from("number_ranges").update({ prefix: values.prefix, padding: values.padding }).eq("org_id", orgId).eq("key", key);
  if (error) throw error;
}
