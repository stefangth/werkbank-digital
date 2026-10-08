import type { TFunction } from "i18next";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { blankToNull } from "../lib/blankToNull";
import { addressFields, refineAddress } from "./address";

export type CompanyProfileRow = Omit<Database["werkbank"]["Tables"]["company_profiles"]["Insert"], "org_id">;

// Same patterns as the check constraints on werkbank.company_profiles.
// Dotted domain, like REPLY_TO_RE in send-transactional-email (the address becomes the reply-to).
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const VAT_ID = /^[A-Z]{2}[0-9A-Za-z+*.]{2,12}$/;
const IBAN = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;
const DIGITS = /^\d+$/;

/** An optional text field: blank is fine, anything else must match `pattern`. */
const optionalPattern = (pattern: RegExp, message: string) =>
  z.string().trim().refine((v) => v === "" || pattern.test(v), message);

/** IBANs are typed in groups of four; the database stores them without spaces. */
export const normalizeIban = (v: string): string => v.replace(/\s+/g, "").toUpperCase();

/** VAT ids are typed in any case and in groups; the database wants them compact and uppercase. */
export const normalizeVatId = (v: string): string => v.replace(/\s+/g, "").toUpperCase();

export const companyProfileSchema = (t: TFunction) =>
  z
    .object({
      company_name: z.string().trim().min(1, t("company.errors.companyName")),
      legal_form: z.string(),
      ...addressFields(t),
      phone: z.string(),
      email: optionalPattern(EMAIL, t("customers.errors.email")),
      website: z.string(),
      tax_number: z.string(),
      vat_id: z.string().transform(normalizeVatId).refine((v) => v === "" || VAT_ID.test(v), t("company.errors.vatId")),
      register_court: z.string(),
      register_number: z.string(),
      iban: z.string().transform(normalizeIban).refine((v) => v === "" || IBAN.test(v), t("company.errors.iban")),
      bic: z.string(),
      bank_name: z.string(),
      logo_path: z.string(),
      quote_intro: z.string(),
      quote_closing: z.string(),
      payment_terms_text: z.string(),
      invoice_intro: z.string(),
      invoice_closing: z.string(),
      payment_due_days: z
        .string()
        .trim()
        .refine((v) => DIGITS.test(v) && Number(v) >= 0 && Number(v) <= 365, t("company.errors.paymentDueDays")),
      quote_validity_days: z
        .string()
        .trim()
        .refine((v) => DIGITS.test(v) && Number(v) >= 1 && Number(v) <= 365, t("company.errors.validity")),
    })
    .superRefine(refineAddress(t));

export type CompanyProfileForm = z.infer<ReturnType<typeof companyProfileSchema>>;

/** Form values as a table row: blank text as `null`, the validity as a number. `org_id` is
 *  added by the data layer. */
export function toCompanyProfileRow(form: CompanyProfileForm): CompanyProfileRow {
  const text = blankToNull({
    legal_form: form.legal_form,
    phone: form.phone,
    email: form.email,
    website: form.website,
    tax_number: form.tax_number,
    vat_id: form.vat_id,
    register_court: form.register_court,
    register_number: form.register_number,
    iban: form.iban,
    bic: form.bic,
    bank_name: form.bank_name,
    logo_path: form.logo_path,
    quote_intro: form.quote_intro,
    quote_closing: form.quote_closing,
    payment_terms_text: form.payment_terms_text,
    invoice_intro: form.invoice_intro,
    invoice_closing: form.invoice_closing,
  });
  return {
    company_name: form.company_name.trim(),
    street: form.street.trim(),
    postal_code: form.postal_code.trim(),
    city: form.city.trim(),
    country_code: form.country_code.trim(),
    ...text,
    quote_validity_days: Number(form.quote_validity_days),
    payment_due_days: Number(form.payment_due_days),
  };
}
