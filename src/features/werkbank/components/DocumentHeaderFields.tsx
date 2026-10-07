import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Metric } from "@/components/ui/metric";
import type { Quote } from "../data/quotes";
import { toNumber } from "../schemas/catalogItem";
import { ContactSelect } from "./ContactSelect";
import { CustomerPicker } from "./CustomerPicker";
import { PropertyPicker } from "./PropertyPicker";

/** The header columns quotes and orders share. */
export type HeaderDoc = Pick<Quote, "customer_id" | "property_id" | "contact_id" | "subject" | "location_note" | "discount_percent">;
export type HeaderPatch = Partial<HeaderDoc>;

type TextField = "subject" | "location_note";
const PERCENT = /^\d+([.,]\d{1,2})?$/;

/** Read-only value of a field, in the label/value grid of the locked state. */
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 whitespace-pre-line">{children}</dd>
    </div>
  );
}

export function FormField({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** Customer, property, contact, subject, location note and discount of a quote or an order, as
 *  cells for the caller's grid (`<dl>` when read only, a form grid otherwise). `afterLocation`
 *  is the caller's own cell between location note and discount. Text saves on leaving the
 *  field, pickers at once; the caller remounts it (key) when the document changes. */
export function DocumentHeaderFields({
  doc, readOnly, idPrefix, names, onPatch, afterLocation,
}: {
  doc: HeaderDoc;
  readOnly: boolean;
  idPrefix: string;
  /** Display names for the read-only view. */
  names: { customer: string | null; property: string | null };
  onPatch: (patch: HeaderPatch) => void;
  afterLocation?: React.ReactNode;
}) {
  const { t } = useTranslation("werkbank");
  const none = t("quotes.header.none");
  const [text, setText] = useState<Record<TextField, string>>({
    subject: doc.subject ?? "",
    location_note: doc.location_note ?? "",
  });
  const [discount, setDiscount] = useState(String(doc.discount_percent).replace(".", ","));

  if (readOnly) {
    return (
      <>
        <Fact label={t("quotes.header.customer")}>{names.customer ?? none}</Fact>
        <Fact label={t("quotes.header.property")}>{names.property ?? none}</Fact>
        <Fact label={t("quotes.header.subject")}>{doc.subject ?? none}</Fact>
        <Fact label={t("quotes.header.locationNote")}>{doc.location_note ?? none}</Fact>
        {afterLocation}
        <Fact label={t("quotes.header.discount")}>
          <Metric size="body">{`${String(doc.discount_percent).replace(".", ",")} %`}</Metric>
        </Fact>
      </>
    );
  }

  const saveText = (field: TextField) => {
    const value = text[field].trim();
    if (value === (doc[field] ?? "")) return;
    onPatch({ [field]: value === "" ? null : value });
  };
  const textProps = (field: TextField) => ({
    id: `${idPrefix}-${field}`,
    value: text[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setText((s) => ({ ...s, [field]: e.target.value })),
    onBlur: () => saveText(field),
  });
  const saveDiscount = () => {
    const raw = discount.trim();
    if (!PERCENT.test(raw) || toNumber(raw) > 100) {
      setDiscount(String(doc.discount_percent).replace(".", ","));
      return;
    }
    if (toNumber(raw) !== doc.discount_percent) onPatch({ discount_percent: toNumber(raw) });
  };

  return (
    <>
      <FormField id={`${idPrefix}-customer`} label={t("quotes.header.customer")}>
        <CustomerPicker
          id={`${idPrefix}-customer`}
          value={doc.customer_id}
          onChange={(customerId) => customerId !== doc.customer_id && onPatch({ customer_id: customerId, property_id: null, contact_id: null })}
        />
      </FormField>
      <FormField id={`${idPrefix}-property`} label={t("quotes.header.property")}>
        <PropertyPicker
          id={`${idPrefix}-property`}
          customerId={doc.customer_id}
          value={doc.property_id ?? ""}
          onChange={(propertyId) => onPatch({ property_id: propertyId || null, contact_id: null })}
        />
      </FormField>
      <FormField id={`${idPrefix}-contact`} label={t("quotes.header.contact")}>
        <ContactSelect
          id={`${idPrefix}-contact`}
          customerId={doc.customer_id}
          propertyId={doc.property_id}
          value={doc.contact_id ?? ""}
          onChange={(contactId) => onPatch({ contact_id: contactId || null })}
        />
      </FormField>
      <FormField id={`${idPrefix}-subject`} label={t("quotes.header.subject")}><Input {...textProps("subject")} /></FormField>
      <FormField id={`${idPrefix}-location_note`} label={t("quotes.header.locationNote")}><Input {...textProps("location_note")} /></FormField>
      {afterLocation}
      <FormField id={`${idPrefix}-discount`} label={t("quotes.header.discount")}>
        <Input
          id={`${idPrefix}-discount`}
          inputMode="decimal"
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          onBlur={saveDiscount}
        />
      </FormField>
    </>
  );
}
