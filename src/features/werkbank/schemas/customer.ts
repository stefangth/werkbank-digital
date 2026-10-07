import type { TFunction } from "i18next";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { blankToNull } from "../lib/blankToNull";
import { addressFields, refineAddress } from "./address";

type CustomerInsert = Database["werkbank"]["Tables"]["customers"]["Insert"];

/** The generated Insert type requires `customer_no`, but a database trigger assigns it when
 *  it is left out. */
export type CustomerRow = Omit<CustomerInsert, "org_id" | "customer_no"> & { customer_no?: string };

// Same patterns as the check constraints on werkbank.customers.
const EMAIL = /^[^@\s]+@[^@\s]+$/;
const VAT_ID = /^[A-Z]{2}[0-9A-Za-z+*.]{2,12}$/;
const DIGITS = /^\d+$/;

/** An optional text field: blank is fine, anything else must match `pattern`. */
const optionalPattern = (pattern: RegExp, message: string) =>
  z.string().trim().refine((v) => v === "" || pattern.test(v), message);

export const customerSchema = (t: TFunction) =>
  z
    .object({
      kind: z.enum(["property_manager", "private"], t("customers.errors.kind")),
      company_name: z.string(),
      first_name: z.string(),
      last_name: z.string(),
      ...addressFields(t),
      email: optionalPattern(EMAIL, t("customers.errors.email")),
      invoice_email: optionalPattern(EMAIL, t("customers.errors.email")),
      phone: z.string(),
      vat_id: optionalPattern(VAT_ID, t("customers.errors.vatId")),
      payment_terms_days: z
        .string()
        .trim()
        .refine((v) => DIGITS.test(v) && Number(v) <= 365, t("customers.errors.paymentTerms")),
      notes: z.string(),
      customer_no: z.string().optional(),
    })
    .superRefine((value, ctx) => {
      if (value.kind === "property_manager" && value.company_name.trim() === "") {
        ctx.addIssue({ code: "custom", path: ["company_name"], message: t("customers.errors.companyName") });
      }
      if (value.kind === "private" && value.last_name.trim() === "") {
        ctx.addIssue({ code: "custom", path: ["last_name"], message: t("customers.errors.lastName") });
      }
      refineAddress(t)(value, ctx);
    });

export type CustomerForm = z.infer<ReturnType<typeof customerSchema>>;

/** Form values as a table row: blank text as `null`, payment terms as a number, a private
 *  customer never carries a company name. A blank `customer_no` is left out so the database
 *  trigger assigns the next number. `org_id` is added by the caller. */
export function toCustomerRow(form: CustomerForm): CustomerRow {
  const text = blankToNull({
    company_name: form.company_name,
    first_name: form.first_name,
    last_name: form.last_name,
    street: form.street,
    postal_code: form.postal_code,
    city: form.city,
    country_code: form.country_code,
    email: form.email,
    invoice_email: form.invoice_email,
    phone: form.phone,
    vat_id: form.vat_id,
    notes: form.notes,
  });
  const customerNo = form.customer_no?.trim();
  return {
    kind: form.kind,
    company_name: form.kind === "private" ? null : text.company_name,
    first_name: text.first_name,
    last_name: text.last_name,
    street: form.street.trim(),
    postal_code: form.postal_code.trim(),
    city: form.city.trim(),
    country_code: form.country_code.trim(),
    email: text.email,
    invoice_email: text.invoice_email,
    phone: text.phone,
    vat_id: text.vat_id,
    payment_terms_days: Number(form.payment_terms_days),
    notes: text.notes,
    ...(customerNo ? { customer_no: customerNo } : {}),
  };
}
