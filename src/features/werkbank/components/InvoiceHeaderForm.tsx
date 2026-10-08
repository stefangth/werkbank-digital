import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Metric } from "@/components/ui/metric";
import { Textarea } from "@/components/ui/textarea";
import { formatDateDMY } from "@/lib/dates";
import type { Invoice, InvoicePatch } from "../data/invoices";
import { DatePopover } from "./DatePopover";
import { hintId } from "./DefaultHint";
import { DocumentHeaderFields, Fact, FormField } from "./DocumentHeaderFields";

type TextField = "intro_text" | "closing_text" | "payment_terms_text";
const DAYS = /^\d{1,3}$/;

/** The invoice's header fields: the shared document fields plus the service period and the
 *  payment term. A draft saves on its own (text on leaving the field, pickers and dates at once);
 *  anything else shows plain values. On a cancellation draft the database keeps customer,
 *  property, contact and discount from the original, so those stay read only. */
export function InvoiceHeaderForm({
  invoice, readOnly, names, onPatch,
}: {
  invoice: Invoice;
  readOnly: boolean;
  /** Display names for the read-only cells. */
  names: { customer: string | null; property: string | null };
  onPatch: (patch: InvoicePatch) => void;
}) {
  const { t } = useTranslation("werkbank");
  const none = t("quotes.header.none");
  const [text, setText] = useState<Record<TextField, string>>({
    intro_text: invoice.intro_text ?? "",
    closing_text: invoice.closing_text ?? "",
    payment_terms_text: invoice.payment_terms_text ?? "",
  });
  const [days, setDays] = useState(String(invoice.payment_due_days));

  const from = invoice.service_date_from;
  const to = invoice.service_date_to;
  const period = from
    ? to ? t("invoices.header.servicePeriodRange", { from: formatDateDMY(from), to: formatDateDMY(to) }) : formatDateDMY(from)
    : none;

  if (readOnly) {
    return (
      <dl className="m-0 grid gap-x-6 gap-y-3 text-sm md:grid-cols-2">
        <DocumentHeaderFields doc={invoice} readOnly idPrefix="invoice" names={names} onPatch={onPatch} />
        <Fact label={t("invoices.header.servicePeriod")}><Metric size="body">{period}</Metric></Fact>
        <Fact label={t("invoices.header.paymentDueDays")}>
          <Metric size="body">{t("invoices.header.paymentDueDaysValue", { count: invoice.payment_due_days })}</Metric>
        </Fact>
        <Fact label={t("quotes.header.intro")}>{invoice.intro_text ?? none}</Fact>
        <Fact label={t("quotes.header.closing")}>{invoice.closing_text ?? none}</Fact>
        <Fact label={t("quotes.header.paymentTerms")}>{invoice.payment_terms_text ?? none}</Fact>
      </dl>
    );
  }

  const saveText = (field: TextField) => {
    const value = text[field].trim();
    if (value === (invoice[field] ?? "")) return;
    onPatch({ [field]: value === "" ? null : value });
  };
  const textProps = (field: TextField) => ({
    id: `invoice-${field}`,
    "aria-describedby": hintId(`invoice-${field}`),
    value: text[field],
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setText((s) => ({ ...s, [field]: e.target.value })),
    onBlur: () => saveText(field),
  });
  const saveDays = () => {
    const raw = days.trim();
    if (!DAYS.test(raw) || Number(raw) > 365) {
      setDays(String(invoice.payment_due_days));
      return;
    }
    if (Number(raw) !== invoice.payment_due_days) onPatch({ payment_due_days: Number(raw) });
  };
  // The period may not end before it starts: a later start drops the end.
  const pickFrom = (date: string) =>
    onPatch(to && to < date ? { service_date_from: date, service_date_to: null } : { service_date_from: date });

  const dateButton = (id: string, value: string | null, described = false) => (
    <Button id={id} variant="secondary" className="w-full justify-start gap-2" aria-describedby={described ? hintId(id) : undefined}>
      <CalendarDays className="h-4 w-4" aria-hidden />
      {value ? <Metric size="body">{formatDateDMY(value)}</Metric> : t("quotes.header.pickDate")}
    </Button>
  );

  // On a cancellation draft service period and payment term come from the original invoice, so the
  // presets the hints explain do not apply there.
  const isCancellation = invoice.type === "cancellation";
  const termFields = (
    <>
      <FormField id="invoice-service-from" label={t("invoices.header.serviceFrom")} hint={isCancellation ? undefined : t("hints.invoiceServiceDate")}>
        <DatePopover value={from} onSelect={pickFrom}>{dateButton("invoice-service-from", from, !isCancellation)}</DatePopover>
      </FormField>
      <FormField id="invoice-service-to" label={t("invoices.header.serviceTo")}>
        <div className="flex items-center gap-2">
          <DatePopover value={to} minDate={from ?? undefined} onSelect={(date) => onPatch({ service_date_to: date })}>
            {dateButton("invoice-service-to", to)}
          </DatePopover>
          {to && (
            <Button variant="ghost" size="icon" aria-label={t("invoices.header.serviceToClear")} onClick={() => onPatch({ service_date_to: null })}>
              <X aria-hidden />
            </Button>
          )}
        </div>
      </FormField>
      <FormField id="invoice-payment-due-days" label={t("invoices.header.paymentDueDays")} hint={isCancellation ? undefined : t("hints.invoicePaymentDueDays")}>
        <Input id="invoice-payment-due-days" aria-describedby={isCancellation ? undefined : hintId("invoice-payment-due-days")} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} onBlur={saveDays} />
      </FormField>
    </>
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {isCancellation ? (
        <>
          <dl className="m-0 grid gap-x-6 gap-y-3 text-sm md:col-span-2 md:grid-cols-2">
            <DocumentHeaderFields doc={invoice} readOnly idPrefix="invoice" names={names} onPatch={onPatch} />
          </dl>
          <p className="m-0 text-sm text-muted-foreground md:col-span-2">{t("invoices.page.cancellationLocked")}</p>
          {termFields}
        </>
      ) : (
        <DocumentHeaderFields doc={invoice} readOnly={false} idPrefix="invoice" names={names} onPatch={onPatch} afterLocation={termFields} />
      )}
      <div className="space-y-4 md:col-span-2">
        <FormField id="invoice-intro_text" label={t("quotes.header.intro")} hint={t("hints.invoiceIntro")}><Textarea rows={3} {...textProps("intro_text")} /></FormField>
        <FormField id="invoice-closing_text" label={t("quotes.header.closing")} hint={t("hints.invoiceClosing")}><Textarea rows={3} {...textProps("closing_text")} /></FormField>
        <FormField id="invoice-payment_terms_text" label={t("quotes.header.paymentTerms")} hint={t("hints.invoicePaymentTerms")}><Textarea rows={2} {...textProps("payment_terms_text")} /></FormField>
      </div>
    </div>
  );
}
