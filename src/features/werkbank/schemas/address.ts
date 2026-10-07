import type { TFunction } from "i18next";
import { z } from "zod";

const COUNTRY = /^[A-Z]{2}$/;
const DE_POSTAL_CODE = /^[0-9]{5}$/;

/** The address fields shared by customers and properties; same non-blank rules as the SQL checks. */
export const addressFields = (t: TFunction) => ({
  street: z.string().trim().min(1, t("customers.errors.street")),
  postal_code: z.string().trim().min(1, t("customers.errors.postalCode")),
  city: z.string().trim().min(1, t("customers.errors.city")),
  country_code: z.string().trim().regex(COUNTRY, t("customers.errors.country")),
});

/** `superRefine` callback: country code is two capital letters, and a German postal code has
 *  five digits. `prefix` addresses the billing address ("billing_postal_code", ...). */
export function refineAddress(t: TFunction, prefix: "" | "billing_" = "") {
  return (value: Record<string, unknown>, ctx: z.RefinementCtx) => {
    const country = String(value[`${prefix}country_code`] ?? "").trim();
    const postal = String(value[`${prefix}postal_code`] ?? "").trim();
    if (!COUNTRY.test(country)) {
      ctx.addIssue({ code: "custom", path: [`${prefix}country_code`], message: t("customers.errors.country") });
    } else if (country === "DE" && postal !== "" && !DE_POSTAL_CODE.test(postal)) {
      ctx.addIssue({ code: "custom", path: [`${prefix}postal_code`], message: t("customers.errors.postalCodeDe") });
    }
  };
}
