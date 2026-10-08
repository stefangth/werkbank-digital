import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { InvoiceActionError, invoiceActionErrorKey } from "../data/invoiceActions";
import type { Invoice } from "../data/invoices";
import { useCompanyProfile } from "../hooks/useCompanyProfile";
import { useContacts } from "../hooks/useContacts";
import { useCustomer } from "../hooks/useCustomers";
import { useDocumentItems } from "../hooks/useDocumentItems";
import { useIssueInvoice, useSendInvoice } from "../hooks/useInvoiceActions";
import { useProperty } from "../hooks/useProperties";
import { invoicePreflight, type InvoiceBlocker } from "../lib/invoicePreflight";
import { splitAddresses } from "../lib/addresses";
import { defaultRecipient } from "../lib/defaultRecipient";
import { HintedLabel } from "./DefaultHint";
import { focusFirstField } from "../lib/focusFirstField";
import { hintId } from "../lib/hintId";

export type IssuableInvoice = Pick<Invoice, "id" | "type" | "customer_id" | "property_id" | "contact_id" | "service_date_from">;

/** Issue a draft invoice ("issue": irreversible, with "Nur abschließen" and "Abschließen und
 *  senden"), or mail an issued one ("send"). The recipient is prefilled with the customer's
 *  invoice email, else the contact's, else the customer's email. The buttons stay disabled while
 *  `invoicePreflight` finds blockers; the server runs the same check. `onStateChanged` is called
 *  whenever the invoice may have left the draft state (issued, or a conflict), so the caller
 *  refetches and turns read only. */
export function IssueInvoiceDialog({
  invoice, mode, resend, open, onOpenChange, onStateChanged,
}: {
  invoice: IssuableInvoice;
  mode: "issue" | "send";
  /** send mode only: the invoice went out before, so the copy says "again". */
  resend?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStateChanged?: () => void;
}) {
  const { t } = useTranslation("werkbank");
  const issue = useIssueInvoice();
  const send = useSendInvoice();
  const { data: profile, isLoading: profileLoading, isError: profileError } = useCompanyProfile();
  const { data: items, isLoading: itemsLoading } = useDocumentItems({ invoiceId: invoice.id });
  const { data: customer, isError: customerError } = useCustomer(invoice.customer_id);
  const { data: property, isError: propertyError } = useProperty(invoice.property_id ?? undefined);
  const { data: customerContacts } = useContacts(invoice.customer_id ? { customerId: invoice.customer_id } : undefined);
  const { data: propertyContacts } = useContacts(invoice.property_id ? { propertyId: invoice.property_id } : undefined);

  const contact = invoice.contact_id
    ? [...(propertyContacts ?? []), ...(customerContacts ?? [])].find((c) => c.id === invoice.contact_id)
    : undefined;
  const defaultTo = defaultRecipient(customer ?? null, contact ?? null);

  // null = untouched, so the prefill follows the customer and contact data as it loads.
  const [toInput, setToInput] = useState<string | null>(null);
  const [ccInput, setCcInput] = useState("");
  const [message, setMessage] = useState(() =>
    t(invoice.type === "cancellation" ? "invoices.send.defaultMessageCancellation" : "invoices.send.defaultMessage"));
  const [error, setError] = useState<InvoiceActionError | null>(null);

  const to = splitAddresses(toInput ?? defaultTo);
  const cc = splitAddresses(ccInput);
  const issueMode = mode === "issue";
  const partyError = customerError || propertyError;
  const loading = !customer || (!!invoice.property_id && !property) || (issueMode && (profileLoading || itemsLoading));

  // Same rule as the SQL buyer snapshot: the property's billing address once it has a billing name.
  const buyer = property?.billing_name != null
    ? { street: property.billing_street, postal_code: property.billing_postal_code, city: property.billing_city }
    : customer ?? null;
  const check = (recipients: string[] | null) =>
    invoicePreflight({
      profile: profile ?? null,
      itemCount: (items ?? []).filter((i) => i.kind === "item").length,
      serviceDateFrom: invoice.service_date_from,
      buyer,
      recipients,
      cancellation: invoice.type === "cancellation",
    });
  // An issued invoice only needs a recipient: its PDF is already stored.
  const sendBlockers = issueMode ? check(to) : check(to).filter((b) => b === "no_recipient");
  const issueBlockers = issueMode ? check(null) : [];
  const shownBlockers: InvoiceBlocker[] = error?.blockers.length
    ? error.blockers
    : loading ? [] : sendBlockers.filter((b) => !profileError || b !== "profile_incomplete");
  const pending = issue.isPending || send.isPending;
  const issueDisabled = loading || pending || (issueMode && profileError) || issueBlockers.length > 0;
  // Quick feedback only; the server checks the format (invalid_recipient) before anything is issued.
  const malformed = [...to, ...cc].some((a) => !/^[^@\s]+@[^@\s]+$/.test(a));
  const sendDisabled = issueDisabled || sendBlockers.length > 0 || malformed;

  const stateChanged = () => {
    onOpenChange(false);
    onStateChanged?.();
  };

  const submit = async (withSend: boolean) => {
    setError(null);
    const body = { to, cc, message: message.trim() };
    try {
      if (!issueMode) {
        const { emailSent } = await send.mutateAsync({ invoiceId: invoice.id, body });
        if (emailSent) toast.success(t("invoices.send.sent"));
        else toast.warning(t("invoices.send.emailFailed"));
        stateChanged();
        return;
      }
      const res = await issue.mutateAsync(withSend ? { invoiceId: invoice.id, send: body } : { invoiceId: invoice.id });
      if (withSend && res.emailSent === false) toast.warning(t("invoices.send.issuedSendFailed"));
      else toast.success(t(withSend ? "invoices.send.issuedAndSent" : "invoices.send.issued", { number: res.invoiceNo }));
      stateChanged();
    } catch (e) {
      const err = e instanceof InvoiceActionError ? e : new InvoiceActionError("unknown");
      if (err.issued) {
        // The number is drawn and the invoice is final; only the PDF or the email is missing.
        if (err.code === "send_failed") toast.warning(t("invoices.send.issuedSendFailed"));
        else toast.error(t("invoices.send.issuedRenderFailed"));
        stateChanged();
      } else if (err.code === "invalid_state" && err.reason !== "order_not_done") {
        // Issued or changed elsewhere meanwhile: refetch so the page shows the real state.
        toast.error(t(invoiceActionErrorKey(err.code)));
        stateChanged();
      } else {
        setError(err);
      }
    }
  };

  // Not dismissable while issuing or sending: the call would finish behind a closed dialog.
  return (
    <Dialog open={open} onOpenChange={(next) => { if (next || !pending) onOpenChange(next); }}>
      <DialogContent onOpenAutoFocus={focusFirstField}>
        <DialogHeader>
          <DialogTitle>{issueMode ? t("invoices.send.issueTitle") : t(resend ? "invoices.send.resendTitle" : "invoices.send.sendTitle")}</DialogTitle>
          <DialogDescription>{issueMode ? t("invoices.send.issueHint") : t("invoices.send.sendHint")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {issueMode && <Alert variant="destructive" className="font-medium">{t("invoices.send.warning")}</Alert>}
          <div className="space-y-2">
            <HintedLabel htmlFor="issue-invoice-to" hint={t("hints.invoiceRecipient")}>{t("invoices.send.to")}</HintedLabel>
            <Input id="issue-invoice-to" aria-describedby={hintId("issue-invoice-to")} type="text" value={toInput ?? defaultTo} onChange={(e) => setToInput(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="issue-invoice-cc">{t("invoices.send.cc")}</Label>
            <Input id="issue-invoice-cc" type="text" value={ccInput} onChange={(e) => setCcInput(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="issue-invoice-message">{t("invoices.send.message")}</Label>
            <Textarea id="issue-invoice-message" rows={5} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>

          {shownBlockers.length > 0 && (
            <Alert variant="destructive">
              <ul className="m-0 list-disc pl-4">
                {shownBlockers.map((b) => <li key={b}>{t(`invoices.send.blockers.${b}`)}</li>)}
              </ul>
            </Alert>
          )}
          {malformed && <Alert variant="destructive">{t("invoices.send.errors.invalidRecipient")}</Alert>}
          {partyError && <Alert variant="destructive">{t("invoices.send.partyLoad")}</Alert>}
          {issueMode && profileError && <Alert variant="destructive">{t("invoices.send.profileLoad")}</Alert>}
          {error && error.blockers.length === 0 && (
            <Alert variant="destructive">{t(invoiceActionErrorKey(error.code, error.reason))}</Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          {issueMode ? (
            <>
              <Button variant="secondary" disabled={issueDisabled} onClick={() => void submit(false)}>
                {t("invoices.send.issueOnly")}
              </Button>
              <Button disabled={sendDisabled} onClick={() => void submit(true)}>{t("invoices.send.issueAndSend")}</Button>
            </>
          ) : (
            <Button disabled={sendDisabled} onClick={() => void submit(true)}>{t(resend ? "invoices.send.resend" : "invoices.send.send")}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
