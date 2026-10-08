import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { berlinDateKey } from "@/lib/dates";
import { QuoteActionError, quoteActionErrorKey } from "../data/quoteActions";
import type { Quote } from "../data/quotes";
import { useCompanyProfile } from "../hooks/useCompanyProfile";
import { useContacts } from "../hooks/useContacts";
import { useCustomer } from "../hooks/useCustomers";
import { useDocumentItems } from "../hooks/useDocumentItems";
import { useQuoteActions } from "../hooks/useQuoteActions";
import { openPendingTab, showInTab } from "../lib/pdfTab";
import { quotePreflight, type QuoteBlocker } from "../lib/quotePreflight";
import { splitAddresses } from "../lib/addresses";

type SendableQuote = Pick<Quote, "id" | "customer_id" | "property_id" | "contact_id" | "status" | "valid_until">;

/** Send a draft, or (for a quote that is already sent) mail it again with a new link. The
 *  recipient is prefilled with the contact's email, else the customer's. Sending stays disabled
 *  while `quotePreflight` finds blockers, and the server runs the same check. */
export function SendQuoteDialog({
  quote,
  open,
  onOpenChange,
  onResend,
}: {
  quote: SendableQuote;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called from the "Resend" toast action after a send whose email did not go out. */
  onResend?: () => void;
}) {
  const { t } = useTranslation("werkbank");
  const resendMode = quote.status === "sent";
  const actions = useQuoteActions();
  const { data: profile, isLoading: profileLoading, isError: profileError } = useCompanyProfile();
  const { data: items, isLoading: itemsLoading } = useDocumentItems({ quoteId: quote.id });
  const { data: customer } = useCustomer(quote.customer_id);
  const { data: customerContacts } = useContacts(quote.customer_id ? { customerId: quote.customer_id } : undefined);
  const { data: propertyContacts } = useContacts(quote.property_id ? { propertyId: quote.property_id } : undefined);

  const contact = quote.contact_id
    ? [...(propertyContacts ?? []), ...(customerContacts ?? [])].find((c) => c.id === quote.contact_id)
    : undefined;
  const defaultTo = contact?.email?.trim() || customer?.email?.trim() || "";

  // null = untouched, so the prefill follows the contact and customer data as it loads.
  const [toInput, setToInput] = useState<string | null>(null);
  const [ccInput, setCcInput] = useState("");
  const [message, setMessage] = useState(() => t("quotes.send.defaultMessage"));
  const [error, setError] = useState<QuoteActionError | null>(null);

  const to = splitAddresses(toInput ?? defaultTo);
  const cc = splitAddresses(ccInput);
  const loading = profileLoading || itemsLoading;
  const blockers = quotePreflight({
    profile: profile ?? null,
    itemCount: (items ?? []).filter((i) => i.kind === "item").length,
    recipients: to,
    validUntil: quote.valid_until,
    today: berlinDateKey(new Date()),
  });
  const shownBlockers: QuoteBlocker[] = error?.blockers.length ? error.blockers : loading ? [] : blockers.filter((b) => !profileError || b !== "profile_incomplete");
  const pending = actions.send.isPending || actions.resend.isPending;

  const submit = async () => {
    setError(null);
    const body = { to, cc, message: message.trim() };
    try {
      const { emailSent } = await (resendMode
        ? actions.resend.mutateAsync({ quoteId: quote.id, body })
        : actions.send.mutateAsync({ quoteId: quote.id, body }));
      if (emailSent) {
        toast.success(t("quotes.sent"));
      } else {
        toast.warning(t("quotes.emailFailed"), { action: { label: t("quotes.send.resend"), onClick: () => onResend?.() } });
      }
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof QuoteActionError ? e : new QuoteActionError("unknown"));
    }
  };

  const preview = () => {
    const tab = openPendingTab();
    return actions.preview.mutateAsync(quote.id)
      .then((url) => {
        setError(null);
        showInTab(tab, url, (u) => toast.error(t("quotes.page.pdfBlocked"), { action: { label: t("quotes.page.pdfOpen"), onClick: () => window.open(u, "_blank") } }));
      })
      .catch((e) => {
        tab?.close();
        setError(e instanceof QuoteActionError ? e : new QuoteActionError("unknown"));
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{resendMode ? t("quotes.send.resendTitle") : t("quotes.send.title")}</DialogTitle>
          <DialogDescription>{resendMode ? t("quotes.send.resendHint") : t("quotes.send.hint")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="send-quote-to">{t("quotes.send.to")}</Label>
            <Input id="send-quote-to" type="text" value={toInput ?? defaultTo} onChange={(e) => setToInput(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="send-quote-cc">{t("quotes.send.cc")}</Label>
            <Input id="send-quote-cc" type="text" value={ccInput} onChange={(e) => setCcInput(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="send-quote-message">{t("quotes.send.message")}</Label>
            <Textarea id="send-quote-message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>

          {shownBlockers.length > 0 && (
            <Alert variant="destructive">
              <ul className="m-0 list-disc pl-4">
                {shownBlockers.map((b) => <li key={b}>{t(`quotes.send.blockers.${b}`)}</li>)}
              </ul>
            </Alert>
          )}
          {profileError && <Alert variant="destructive">{t("quotes.send.errors.profileLoad")}</Alert>}
          {error && error.blockers.length === 0 && <Alert variant="destructive">{t(quoteActionErrorKey(error.code))}</Alert>}
        </div>

        <DialogFooter>
          {!resendMode && (
            <Button variant="secondary" disabled={actions.preview.isPending} onClick={() => void preview()}>
              {t("quotes.send.preview")}
            </Button>
          )}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button disabled={loading || pending || profileError || blockers.length > 0} onClick={() => void submit()}>
            {resendMode ? t("quotes.send.resend") : t("quotes.send.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
