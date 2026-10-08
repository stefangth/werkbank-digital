import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Metric } from "@/components/ui/metric";
import { Textarea } from "@/components/ui/textarea";
import { formatDateDMY } from "@/lib/dates";
import type { Quote, QuotePatch } from "../data/quotes";
import { DatePopover } from "./DatePopover";
import { hintId } from "./DefaultHint";
import { DocumentHeaderFields, Fact, FormField } from "./DocumentHeaderFields";

type TextField = "intro_text" | "closing_text" | "payment_terms_text";

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
    intro_text: quote.intro_text ?? "",
    closing_text: quote.closing_text ?? "",
    payment_terms_text: quote.payment_terms_text ?? "",
  });

  if (readOnly) {
    return (
      <dl className="m-0 grid gap-x-6 gap-y-3 text-sm md:grid-cols-2">
        <DocumentHeaderFields
          doc={quote}
          readOnly
          idPrefix="quote"
          names={names}
          onPatch={onPatch}
          afterLocation={
            <Fact label={t("quotes.header.validUntil")}>
              <Metric size="body">{formatDateDMY(quote.valid_until)}</Metric>
            </Fact>
          }
        />
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
    "aria-describedby": hintId(`quote-${field}`),
    value: text[field],
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setText((s) => ({ ...s, [field]: e.target.value })),
    onBlur: () => saveText(field),
  });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <DocumentHeaderFields
        doc={quote}
        readOnly={false}
        idPrefix="quote"
        names={names}
        onPatch={onPatch}
        afterLocation={
          <FormField id="quote-valid-until" label={t("quotes.header.validUntil")} hint={t("hints.quoteValidUntil")}>
            <DatePopover value={quote.valid_until} onSelect={(validUntil) => onPatch({ valid_until: validUntil })}>
              <Button id="quote-valid-until" variant="secondary" className="w-full justify-start gap-2" aria-describedby={hintId("quote-valid-until")}>
                <CalendarDays className="h-4 w-4" aria-hidden />
                <Metric size="body">{formatDateDMY(quote.valid_until)}</Metric>
              </Button>
            </DatePopover>
          </FormField>
        }
      />
      <div className="md:col-span-2 space-y-4">
        <FormField id="quote-intro_text" label={t("quotes.header.intro")} hint={t("hints.quoteIntro")}><Textarea rows={3} {...textProps("intro_text")} /></FormField>
        <FormField id="quote-closing_text" label={t("quotes.header.closing")} hint={t("hints.quoteClosing")}><Textarea rows={3} {...textProps("closing_text")} /></FormField>
        <FormField id="quote-payment_terms_text" label={t("quotes.header.paymentTerms")} hint={t("hints.quotePaymentTerms")}><Textarea rows={2} {...textProps("payment_terms_text")} /></FormField>
      </div>
    </div>
  );
}
