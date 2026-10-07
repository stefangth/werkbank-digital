import type { TFunction } from "i18next";
import { z } from "zod";
import { catalogItemSchema, toCatalogItemRow, type CatalogItemForm } from "../schemas/catalogItem";
import { customerSchema, toCustomerRow, type CustomerForm } from "../schemas/customer";
import { propertySchema, toPropertyRow, type PropertyForm } from "../schemas/property";
import type { ImportField, ImportSpecDefinition } from "./types";

// Header aliases are compared after normalizeHeader (case, spaces, punctuation and umlauts ignored),
// so "Straße" also covers "Strasse" and "STRASSE", and "Kundennr" covers "Kundennr.".
const CUSTOMER_NO = ["Kundennummer", "Kundennr", "Kd-Nr", "Kunden-Nr", "Customer No", "Customer Number", "customer_no"];
const STREET = ["Straße", "Str", "Straße und Hausnummer", "Adresse", "Anschrift", "Street", "Address"];
const POSTAL_CODE = ["PLZ", "Postleitzahl", "Postal Code", "Zip", "Zip Code", "Postcode", "postal_code"];
const CITY = ["Ort", "Stadt", "Wohnort", "City", "Town"];
const COUNTRY = ["Land", "Ländercode", "Country", "Country Code", "country_code"];
const NOTES = ["Notizen", "Notiz", "Bemerkung", "Bemerkungen", "Notes", "Comment", "Comments"];

const addressFields = (prefix: "" | "billing_", labels: { street: string; postal: string; city: string; country: string }, aliases: {
  street: string[];
  postal: string[];
  city: string[];
  country: string[];
}, required: boolean): ImportField[] => [
  { key: `${prefix}street`, labelKey: labels.street, required, aliases: aliases.street, kind: "text" },
  { key: `${prefix}postal_code`, labelKey: labels.postal, required, aliases: aliases.postal, kind: "postal_code" },
  { key: `${prefix}city`, labelKey: labels.city, required, aliases: aliases.city, kind: "text" },
  { key: `${prefix}country_code`, labelKey: labels.country, required: false, aliases: aliases.country, kind: "country", defaultValue: "DE" },
];

const ADDRESS = addressFields(
  "",
  { street: "customers.dialog.street", postal: "customers.dialog.postalCode", city: "customers.dialog.city", country: "customers.dialog.country" },
  { street: STREET, postal: POSTAL_CODE, city: CITY, country: COUNTRY },
  true,
);

/** customerSchema with an optional kind (Ruling R16): a blank or unmapped kind becomes a property
 *  manager when the row has a company name, otherwise private. A filled kind is kept as normalized, so
 *  an unknown label is still rejected. */
export const customerImportSchema = (t: TFunction) =>
  z.preprocess((input) => {
    const raw = input as Record<string, string>;
    if ((raw.kind ?? "").trim() !== "") return raw;
    return { ...raw, kind: (raw.company_name ?? "").trim() !== "" ? "property_manager" : "private" };
  }, customerSchema(t));

export const CUSTOMER_IMPORT: ImportSpecDefinition<CustomerForm> = {
  entity: "customers",
  fields: [
    { key: "customer_no", labelKey: "customers.dialog.customerNo", required: false, aliases: CUSTOMER_NO, kind: "text" },
    { key: "kind", labelKey: "customers.dialog.kind", required: false, aliases: ["Art", "Kundenart", "Typ", "Kundentyp", "Kind", "Type", "Customer Type"], kind: "enum" },
    { key: "company_name", labelKey: "customers.dialog.companyName", required: false, aliases: ["Firma", "Firmenname", "Unternehmen", "Company", "Company Name"], kind: "text" },
    { key: "first_name", labelKey: "customers.dialog.firstName", required: false, aliases: ["Vorname", "First Name", "Given Name"], kind: "text" },
    { key: "last_name", labelKey: "customers.dialog.lastName", required: false, aliases: ["Nachname", "Familienname", "Last Name", "Surname", "Family Name"], kind: "text" },
    ...ADDRESS,
    { key: "email", labelKey: "customers.dialog.email", required: false, aliases: ["E-Mail", "Mail", "E-Mail-Adresse", "Email Address"], kind: "text" },
    { key: "invoice_email", labelKey: "customers.dialog.invoiceEmail", required: false, aliases: ["Rechnungs-E-Mail", "Rechnungsmail", "E-Mail Rechnung", "Invoice Email", "Billing Email"], kind: "text" },
    { key: "phone", labelKey: "customers.dialog.phone", required: false, aliases: ["Telefon", "Tel", "Telefonnummer", "Phone", "Phone Number"], kind: "text" },
    { key: "vat_id", labelKey: "customers.dialog.vatId", required: false, aliases: ["USt-IdNr", "USt-ID", "UStId", "Umsatzsteuer-ID", "VAT ID", "VAT Number"], kind: "vat_id" },
    { key: "payment_terms_days", labelKey: "customers.dialog.paymentTerms", required: false, aliases: ["Zahlungsziel", "Zahlungsziel Tage", "Zahlungsziel in Tagen", "Payment Terms", "Payment Terms Days"], kind: "integer", defaultValue: "14" },
    { key: "notes", labelKey: "customers.dialog.notes", required: false, aliases: NOTES, kind: "text" },
  ],
  schema: customerImportSchema,
  toRpcRow: toCustomerRow,
};

/** A property row of an import: it names its customer by `customer_no` instead of `customer_id`. */
export type PropertyImportForm = Omit<PropertyForm, "customer_id"> & { customer_no: string };

// Only satisfies the uuid check of propertySchema; toRpcRow drops it.
const PLACEHOLDER_CUSTOMER_ID = "00000000-0000-4000-8000-000000000000";

/** propertySchema without customer_id, plus a required customer_no (Ruling R3). A sheet has no
 *  "Abweichender Rechnungsempfänger" tick, so has_billing is on when the billing name is filled. A
 *  billing street, postal code or city without a billing name is an error rather than dropped
 *  silently (Ruling R16).
 *  propertySchema is refined, so it is reused as is with a placeholder customer_id instead of being
 *  rebuilt with `.omit`. */
export const propertyImportSchema = (t: TFunction) =>
  z.record(z.string(), z.string()).transform((raw, ctx): PropertyImportForm => {
    const customerNo = (raw.customer_no ?? "").trim();
    if (customerNo === "") {
      ctx.addIssue({ code: "custom", path: ["customer_no"], message: t("import.errors.customerNo") });
    }
    const blank = (key: string) => (raw[key] ?? "").trim() === "";
    const billingNameMissing =
      blank("billing_name") && !(blank("billing_street") && blank("billing_postal_code") && blank("billing_city"));
    if (billingNameMissing) {
      ctx.addIssue({ code: "custom", path: ["billing_name"], message: t("import.errors.billingName") });
    }
    const parsed = propertySchema(t).safeParse({
      ...raw,
      customer_id: PLACEHOLDER_CUSTOMER_ID,
      has_billing: (raw.billing_name ?? "").trim() !== "",
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
    }
    if (customerNo === "" || billingNameMissing || !parsed.success) return z.NEVER;
    const { customer_id: _placeholder, ...form } = parsed.data;
    return { ...form, customer_no: customerNo };
  });

export const PROPERTY_IMPORT: ImportSpecDefinition<PropertyImportForm> = {
  entity: "properties",
  fields: [
    { key: "customer_no", labelKey: "import.fields.customerNo", required: true, aliases: CUSTOMER_NO, kind: "text" },
    { key: "name", labelKey: "properties.dialog.name", required: true, aliases: ["Name", "Bezeichnung", "Objekt", "Objektname", "Liegenschaft", "Property", "Property Name"], kind: "text" },
    { key: "object_no", labelKey: "properties.dialog.objectNo", required: false, aliases: ["Objektnummer", "Objekt-Nr", "Object No", "Object Number"], kind: "text" },
    ...ADDRESS,
    { key: "billing_name", labelKey: "properties.dialog.billingName", required: false, aliases: ["Rechnungsempfänger", "Rechnungsname", "Rechnung an", "Billing Name", "Bill To"], kind: "text" },
    ...addressFields(
      "billing_",
      { street: "import.fields.billingStreet", postal: "import.fields.billingPostalCode", city: "import.fields.billingCity", country: "import.fields.billingCountry" },
      {
        street: ["Rechnungsstraße", "Rechnung Straße", "Billing Street", "Billing Address"],
        postal: ["Rechnungs-PLZ", "Rechnung PLZ", "Billing Postal Code", "Billing Zip"],
        city: ["Rechnungsort", "Rechnung Ort", "Billing City"],
        country: ["Rechnungsland", "Rechnung Land", "Billing Country"],
      },
      false,
    ),
    { key: "access_notes", labelKey: "properties.dialog.accessNotes", required: false, aliases: ["Zugang", "Zugangshinweise", "Schlüssel", "Access", "Access Notes"], kind: "text" },
    { key: "notes", labelKey: "properties.dialog.notes", required: false, aliases: NOTES, kind: "text" },
  ],
  schema: propertyImportSchema,
  toRpcRow: ({ customer_no, ...form }) => {
    const { customer_id: _placeholder, ...row } = toPropertyRow({ ...form, customer_id: PLACEHOLDER_CUSTOMER_ID });
    return { ...row, customer_no };
  },
};

export const CATALOG_IMPORT: ImportSpecDefinition<CatalogItemForm> = {
  entity: "catalog_items",
  fields: [
    { key: "item_no", labelKey: "catalog.dialog.itemNo", required: false, aliases: ["Artikelnummer", "Artikelnr", "Art-Nr", "Nummer", "Nr", "Item No", "Item Number", "SKU"], kind: "text" },
    { key: "name", labelKey: "catalog.dialog.name", required: true, aliases: ["Bezeichnung", "Name", "Leistung", "Artikel", "Kurztext", "Item", "Title"], kind: "text" },
    { key: "description", labelKey: "catalog.dialog.descriptionField", required: false, aliases: ["Beschreibung", "Langtext", "Description"], kind: "text" },
    { key: "category", labelKey: "catalog.dialog.category", required: false, aliases: ["Kategorie", "Gruppe", "Warengruppe", "Category", "Group"], kind: "text" },
    { key: "unit_code", labelKey: "catalog.dialog.unit", required: true, aliases: ["Einheit", "ME", "Mengeneinheit", "Unit"], kind: "enum" },
    { key: "labour_price", labelKey: "catalog.dialog.labour", required: false, aliases: ["Lohn", "Lohnpreis", "Lohnkosten", "Arbeit", "Labour", "Labor", "Labour Price"], kind: "money", defaultValue: "0" },
    { key: "material_price", labelKey: "catalog.dialog.material", required: false, aliases: ["Material", "Materialpreis", "Materialkosten", "Material Price"], kind: "money", defaultValue: "0" },
    { key: "vat_rate", labelKey: "catalog.dialog.vat", required: false, aliases: ["MwSt", "MwSt-Satz", "USt", "Steuersatz", "Mehrwertsteuer", "VAT", "VAT Rate", "Tax Rate"], kind: "enum", defaultValue: "19" },
  ],
  schema: catalogItemSchema,
  toRpcRow: toCatalogItemRow,
};
