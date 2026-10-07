import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Metric } from "@/components/ui/metric";
import { Textarea } from "@/components/ui/textarea";
import { formatDateDMY } from "@/lib/dates";
import type { Quote, QuotePatch } from "../data/quotes";
import { toNumber } from "../schemas/catalogItem";
import { ContactSelect } from "./ContactSelect";
import { CustomerPicker } from "./CustomerPicker";
import { DatePopover } from "./DatePopover";
import { PropertyPicker } from "./PropertyPicker";

type TextField = "subject" | "location_note" | "intro_text" | "closing_text" | "payment_terms_text";
const PERCENT = /^\d+([.,]\d{1,2})?$/;

/** Read-only value of a field, in the label/value grid of the sent state. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 whitespace-pre-line">{children}</dd>
    </div>
  );
}

/** The quote's header fields. A draft saves on its own: text on leaving the field, pickers and
 *  the date at once. Anything else shows the values as plain text. */
export function QuoteHeaderForm({
  quote, readOnly, names, onPatch,
}: {
  quote: Quote;
  readOnly: boolean;
  /** Display names for the read-only view. */
  names: { customer: string | null; property: string | null };
  onPatch: (patch: QuotePatch) => void;
}) {
  const { t } = useTranslation("werkbank");
  const none = t("quotes.header.none");

  const [text, setText] = useState<Record<TextField, string>>({
    subject: quote.subject ?? "",
    location_note: quote.location_note ?? "",
    intro_text: quote.intro_text ?? "",
    closing_text: quote.closing_text ?? "",
    payment_terms_text: quote.payment_terms_text ?? "",
  });
  const [discount, setDiscount] = useState(String(quote.discount_percent).replace(".", ","));

  if (readOnly) {
    return (
      <dl className="m-0 grid gap-x-6 gap-y-3 text-sm md:grid-cols-2">
        <Fact label={t("quotes.header.customer")}>{names.customer ?? none}</Fact>
        <Fact label={t("quotes.header.property")}>{names.property ?? none}</Fact>
        <Fact label={t("quotes.header.subject")}>{quote.subject ?? none}</Fact>
        <Fact label={t("quotes.header.locationNote")}>{quote.location_note ?? none}</Fact>
        <Fact label={t("quotes.header.validUntil")}>
          <Metric size="body">{formatDateDMY(quote.valid_until)}</Metric>
        </Fact>
        <Fact label={t("quotes.header.discount")}>
          <Metric size="body">{String(quote.discount_percent).replace(".", ",")}</Metric>
        </Fact>
        <Fact label={t("quotes.header.intro")}>{quote.intro_text ?? none}</Fact>
        <Fact label={t("quotes.header.closing")}>{quote.closing_text ?? none}</Fact>
        <Fact label={t("quotes.header.paymentTerms")}>{quote.payment_terms_text ?? none}</Fact>
      </dl>
    );
  }

  const saveText = (field: TextField) => {
    const value = text[field].trim();
    if (value === (quote[field] ?? "")) return;
    onPatch({ [field]: value === "" ? null : value });
  };
  const textProps = (field: TextField) => ({
    id: `quote-${field}`,
    value: text[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText((s) => ({ ...s, [field]: e.target.value })),
    onBlur: () => saveText(field),
  });
  const saveDiscount = () => {
    const raw = discount.trim();
    if (!PERCENT.test(raw) || toNumber(raw) > 100) {
      setDiscount(String(quote.discount_percent).replace(".", ","));
      return;
    }
    if (toNumber(raw) !== quote.discount_percent) onPatch({ discount_percent: toNumber(raw) });
  };

  const field = (id: string, label: string, control: React.ReactNode) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {control}
    </div>
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {field("quote-customer", t("quotes.header.customer"),
        <CustomerPicker
          id="quote-customer"
          value={quote.customer_id}
          onChange={(customerId) => customerId !== quote.customer_id && onPatch({ customer_id: customerId, property_id: null, contact_id: null })}
        />)}
      {field("quote-property", t("quotes.header.property"),
        <PropertyPicker
          id="quote-property"
          customerId={quote.customer_id}
          value={quote.property_id ?? ""}
          onChange={(propertyId) => onPatch({ property_id: propertyId || null, contact_id: null })}
        />)}
      {field("quote-contact", t("quotes.header.contact"),
        <ContactSelect
          id="quote-contact"
          customerId={quote.customer_id}
          propertyId={quote.property_id}
          value={quote.contact_id ?? ""}
          onChange={(contactId) => onPatch({ contact_id: contactId || null })}
        />)}
      {field("quote-subject", t("quotes.header.subject"), <Input {...textProps("subject")} />)}
      {field("quote-location_note", t("quotes.header.locationNote"), <Input {...textProps("location_note")} />)}
      {field("quote-valid-until", t("quotes.header.validUntil"),
        <DatePopover value={quote.valid_until} onSelect={(validUntil) => onPatch({ valid_until: validUntil })}>
          <Button id="quote-valid-until" variant="secondary" className="w-full justify-start gap-2">
            <CalendarDays className="h-4 w-4" aria-hidden />
            <Metric size="body">{formatDateDMY(quote.valid_until)}</Metric>
          </Button>
        </DatePopover>)}
      {field("quote-discount", t("quotes.header.discount"),
        <Input
          id="quote-discount"
          inputMode="decimal"
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          onBlur={saveDiscount}
        />)}
      <div className="md:col-span-2 space-y-4">
        {field("quote-intro_text", t("quotes.header.intro"), <Textarea rows={3} {...textProps("intro_text")} />)}
        {field("quote-closing_text", t("quotes.header.closing"), <Textarea rows={3} {...textProps("closing_text")} />)}
        {field("quote-payment_terms_text", t("quotes.header.paymentTerms"), <Textarea rows={2} {...textProps("payment_terms_text")} />)}
      </div>
    </div>
  );
}
