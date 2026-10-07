import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { fetchAllPages } from "../lib/fetchAllPages";
import { toContactRow, type ContactForm } from "../schemas/contact";

export type Contact = Database["werkbank"]["Tables"]["contacts"]["Row"];
/** A contact belongs to exactly one customer or one property. */
export type ContactParent = { customerId: string } | { propertyId: string };

type ContactInsert = Database["werkbank"]["Tables"]["contacts"]["Insert"];
type Client = SupabaseClient<Database>;
type Page = PromiseLike<{ data: Contact[] | null; error: unknown }>;

const parentColumns = (parent: ContactParent) =>
  "customerId" in parent
    ? { customer_id: parent.customerId, property_id: null }
    : { customer_id: null, property_id: parent.propertyId };

/** The contacts of one parent, primary first, then by last name. Scoped by the parent's uuid. */
export async function fetchContacts(client: Client, parent: ContactParent): Promise<Contact[]> {
  if ("customerId" in parent) {
    return fetchAllPages<Contact>((from, to) =>
      client.schema("werkbank").from("contacts").select("*").eq("customer_id", parent.customerId).order("is_primary", { ascending: false }).order("last_name").order("id").range(from, to) as unknown as Page,
    );
  }
  return fetchAllPages<Contact>((from, to) =>
    client.schema("werkbank").from("contacts").select("*").eq("property_id", parent.propertyId).order("is_primary", { ascending: false }).order("last_name").order("id").range(from, to) as unknown as Page,
  );
}

/** Makes `id` the primary contact of `parent`: first clears the parent's other primary (the
 *  partial unique index allows only one), then sets this one. */
export async function setPrimaryContact(client: Client, parent: ContactParent, id: string): Promise<void> {
  const clear = client.schema("werkbank").from("contacts").update({ is_primary: false }).neq("id", id).eq("is_primary", true);
  const { error: clearError } = await ("customerId" in parent
    ? clear.eq("customer_id", parent.customerId)
    : clear.eq("property_id", parent.propertyId));
  if (clearError) throw clearError;
  const { error } = await client.schema("werkbank").from("contacts").update({ is_primary: true }).eq("id", id);
  if (error) throw error;
}

/** Creates a contact under exactly one parent. A new primary contact is inserted as a normal
 *  one and then promoted with `setPrimaryContact`, so it never collides with the current primary. */
export async function createContact(client: Client, orgId: string, parent: ContactParent, form: ContactForm): Promise<Contact> {
  const { data, error } = await client.schema("werkbank").from("contacts")
    .insert({ ...toContactRow(form), is_primary: false, ...parentColumns(parent), org_id: orgId } as ContactInsert)
    .select()
    .single();
  if (error) throw error;
  if (!form.is_primary) return data;
  await setPrimaryContact(client, parent, data.id);
  return { ...data, is_primary: true };
}

/** Updates a contact. A primary contact keeps its flag while it is edited: `is_primary` is left
 *  out of the row update and `setPrimaryContact` (idempotent) moves the flag to it. A non-primary
 *  form writes `is_primary: false`. */
export async function updateContact(client: Client, parent: ContactParent, id: string, form: ContactForm): Promise<void> {
  const { is_primary, ...row } = toContactRow(form);
  const { error } = await client.schema("werkbank").from("contacts")
    .update(is_primary ? row : { ...row, is_primary: false })
    .eq("id", id);
  if (error) throw error;
  if (is_primary) await setPrimaryContact(client, parent, id);
}

export async function deleteContact(client: Client, id: string): Promise<void> {
  const { error } = await client.schema("werkbank").from("contacts").delete().eq("id", id);
  if (error) throw error;
}
