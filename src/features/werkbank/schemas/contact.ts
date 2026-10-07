import type { TFunction } from "i18next";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { blankToNull } from "../lib/blankToNull";

type ContactInsert = Database["werkbank"]["Tables"]["contacts"]["Insert"];

/** The editable columns of a contact; parent ids and `org_id` are added by the data layer. */
export type ContactRow = Pick<ContactInsert, "first_name" | "last_name" | "role" | "phone" | "mobile" | "email" | "notes" | "is_primary">;

// Same pattern as the check constraint on werkbank.contacts.
const EMAIL = /^[^@\s]+@[^@\s]+$/;

export const contactSchema = (t: TFunction) =>
  z.object({
    first_name: z.string(),
    last_name: z.string().trim().min(1, t("contacts.errors.lastName")),
    role: z.string(),
    phone: z.string(),
    mobile: z.string(),
    email: z.string().trim().refine((v) => v === "" || EMAIL.test(v), t("contacts.errors.email")),
    notes: z.string(),
    is_primary: z.boolean(),
  });

export type ContactForm = z.infer<ReturnType<typeof contactSchema>>;

/** Form values as a table row: blank text as `null`. */
export function toContactRow(form: ContactForm): ContactRow {
  const text = blankToNull({
    first_name: form.first_name,
    role: form.role,
    phone: form.phone,
    mobile: form.mobile,
    email: form.email,
    notes: form.notes,
  });
  return { ...text, last_name: form.last_name.trim(), is_primary: form.is_primary };
}
