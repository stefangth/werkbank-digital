import type { TFunction } from "i18next";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { blankToNull } from "../lib/blankToNull";
import { addressFields, refineAddress } from "./address";

type PropertyInsert = Database["werkbank"]["Tables"]["properties"]["Insert"];

/** A property as a table row (`org_id` is added by the caller). */
export type PropertyRow = Omit<PropertyInsert, "org_id">;

export const propertySchema = (t: TFunction) =>
  z
    .object({
      customer_id: z.string().uuid(t("properties.errors.customer")),
      name: z.string().trim().min(1, t("properties.errors.name")),
      object_no: z.string(),
      ...addressFields(t),
      has_billing: z.boolean(),
      billing_name: z.string(),
      billing_street: z.string(),
      billing_postal_code: z.string(),
      billing_city: z.string(),
      billing_country_code: z.string(),
      access_notes: z.string(),
      notes: z.string(),
    })
    .superRefine((value, ctx) => {
      refineAddress(t)(value, ctx);
      if (!value.has_billing) return; // an unticked billing address is not validated and not stored
      const required = [
        ["billing_name", "billingName"],
        ["billing_street", "street"],
        ["billing_postal_code", "postalCode"],
        ["billing_city", "city"],
      ] as const;
      for (const [field, key] of required) {
        if (value[field].trim() === "") {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: t(field === "billing_name" ? `properties.errors.${key}` : `customers.errors.${key}`),
          });
        }
      }
      refineAddress(t, "billing_")(value, ctx);
    });

export type PropertyForm = z.infer<ReturnType<typeof propertySchema>>;

/** Form values as a table row: blank text as `null`. Without `has_billing` every `billing_*`
 *  column is `null` (leftover input is dropped); the `has_billing` flag itself is never sent. */
export function toPropertyRow(form: PropertyForm): PropertyRow {
  const text = blankToNull({
    object_no: form.object_no,
    billing_name: form.billing_name,
    billing_street: form.billing_street,
    billing_postal_code: form.billing_postal_code,
    billing_city: form.billing_city,
    billing_country_code: form.billing_country_code,
    access_notes: form.access_notes,
    notes: form.notes,
  });
  const billing = form.has_billing;
  return {
    customer_id: form.customer_id,
    name: form.name.trim(),
    object_no: text.object_no,
    street: form.street.trim(),
    postal_code: form.postal_code.trim(),
    city: form.city.trim(),
    country_code: form.country_code.trim(),
    billing_name: billing ? text.billing_name : null,
    billing_street: billing ? text.billing_street : null,
    billing_postal_code: billing ? text.billing_postal_code : null,
    billing_city: billing ? text.billing_city : null,
    billing_country_code: billing ? text.billing_country_code : null,
    access_notes: text.access_notes,
    notes: text.notes,
  };
}
