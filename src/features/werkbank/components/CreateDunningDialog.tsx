import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Metric } from "@/components/ui/metric";
import { berlinDateKey, formatDateDMY } from "@/lib/dates";
import { DunningActionError } from "../data/dunningActions";
import { invoiceActionErrorKey } from "../data/invoiceActions";
import { useCompanyProfile } from "../hooks/useCompanyProfile";
import { useContacts } from "../hooks/useContacts";
import { useCustomer } from "../hooks/useCustomers";
import { useIssueDunning, usePreviewDunning } from "../hooks/useDunningActions";
import { splitAddresses } from "../lib/addresses";
import { defaultRecipient } from "../lib/defaultRecipient";
import { addDaysToKey } from "../lib/dunningBlockers";
import { DUNNING_STAGE_TITLES } from "../lib/dunningDefaults";
import { openPendingTab, showInTab } from "../lib/pdfTab";
import { DatePopover } from "./DatePopover";
import { DefaultHint } from "./DefaultHint";

const DEFAULT_DEADLINE_DAYS = 7;
const MAIL = /^[^@\s]+@[^@\s]+$/;

/** Creates the next dunning notice: recipient and CC (preset like the invoice mail), the payment
 *  deadline (preset Berlin today plus the profile's deadline days), a preview, and either "Erstellen
 *  und senden" or "Nur PDF für Postversand". A notice cannot be undone, so the dialog stays open
 *  while the call runs. When the notice exists but its PDF or mail failed, the dialog closes: the
 *  list then offers the retry. */
export function CreateDunningDialog({ invoice, stage, onOpenChange }: {
  invoice: { id: string; customer_id: string; contact_id: string | null };
  stage: 1 | 2 | 3;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("werkbank");
  const issue = useIssueDunning();
  const preview = usePreviewDunning();
  const { data: profile } = useCompanyProfile();
  const { data: customer } = useCustomer(invoice.customer_id);
  const { data: contacts } = useContacts({ customerId: invoice.customer_id });
  const contact = invoice.contact_id ? contacts?.find((c) => c.id === invoice.contact_id) : undefined;
  const defaultTo = defaultRecipient(customer ?? null, contact ?? null);
  const presetDeadline = addDaysToKey(berlinDateKey(new Date()), profile?.dunning_deadline_days ?? DEFAULT_DEADLINE_DAYS);

  // null = untouched, so the preset follows the customer and the profile as they load.
  const [toInput, setToInput] = useState<string | null>(null);
  const [ccInput, setCcInput] = useState("");
  const [deadlineInput, setDeadlineInput] = useState<string | null>(null);
  const [error, setError] = useState<DunningActionError | null>(null);
  const deadline = deadlineInput ?? presetDeadline;
  const to = splitAddresses(toInput ?? defaultTo);
  const cc = splitAddresses(ccInput);
  const malformed = [...to, ...cc].some((a) => !MAIL.test(a));
  const pending = issue.isPending;

  const showPreview = () => {
    const tab = openPendingTab();
    return preview.mutateAsync({ invoiceId: invoice.id, paymentDeadline: deadline })
      .then((blob) =>
        showInTab(tab, URL.createObjectURL(blob), (url) =>
          toast.error(t("invoices.page.pdfBlocked"), { action: { label: t("invoices.page.pdfOpen"), onClick: () => window.open(url, "_blank") } })))
      .catch(() => {
        tab?.close();
        toast.error(t("invoices.page.pdfFailed"));
      });
  };

  const submit = async (email: boolean) => {
    setError(null);
    try {
      await issue.mutateAsync(email
        ? { invoiceId: invoice.id, delivery: "email", paymentDeadline: deadline, send: { to, ...(cc.length ? { cc } : {}) } }
        : { invoiceId: invoice.id, delivery: "print", paymentDeadline: deadline });
      toast.success(t(email ? "dunning.create.sent" : "dunning.create.created", { stage: DUNNING_STAGE_TITLES[stage] }));
      onOpenChange(false);
    } catch (e) {
      const err = e instanceof DunningActionError ? e : new DunningActionError("unknown");
      if (err.issued) {
        toast.warning(t(err.code === "send_failed" ? "dunning.create.issuedSendFailed" : "dunning.create.issuedRenderFailed"));
        onOpenChange(false);
      } else setError(err);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (next || !pending) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dunning.create.title", { stage: DUNNING_STAGE_TITLES[stage] })}</DialogTitle>
          <DialogDescription>{t("dunning.create.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dunning-to" className="flex items-center gap-1.5">
              {t("dunning.create.to")}
              <DefaultHint text={t("dunning.create.hintTo")} />
            </Label>
            <Input id="dunning-to" type="text" value={toInput ?? defaultTo} onChange={(e) => setToInput(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dunning-cc">{t("dunning.create.cc")}</Label>
            <Input id="dunning-cc" type="text" value={ccInput} onChange={(e) => setCcInput(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dunning-deadline" className="flex items-center gap-1.5">
              {t("dunning.create.deadline")}
              <DefaultHint text={t("dunning.create.hintDeadline", { days: profile?.dunning_deadline_days ?? DEFAULT_DEADLINE_DAYS })} />
            </Label>
            <DatePopover value={deadline} minDate={berlinDateKey(new Date())} onSelect={setDeadlineInput}>
              <Button id="dunning-deadline" type="button" variant="secondary" className="w-full justify-start gap-2" aria-label={t("dunning.create.deadline")}>
                <CalendarDays className="h-4 w-4" aria-hidden />
                <Metric size="body">{formatDateDMY(deadline)}</Metric>
              </Button>
            </DatePopover>
          </div>
          {malformed && <Alert variant="destructive">{t("invoices.send.errors.invalidRecipient")}</Alert>}
          {error?.code === "not_allowed" ? (
            <Alert variant="destructive">
              <ul className="m-0 list-disc pl-4">
                {error.blockers.map((b) => <li key={b}>{t(`dunning.blockers.${b}`, { defaultValue: t("errors.dunningNotAllowed") })}</li>)}
              </ul>
            </Alert>
          ) : error && <Alert variant="destructive">{t(invoiceActionErrorKey(error.code))}</Alert>}
        </div>
        <DialogFooter>
          <Button variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button variant="secondary" disabled={pending || preview.isPending} onClick={() => void showPreview()}>{t("dunning.create.preview")}</Button>
          <Button variant="secondary" disabled={pending} onClick={() => void submit(false)}>{t("dunning.create.printOnly")}</Button>
          <Button disabled={pending || malformed || to.length === 0} onClick={() => void submit(true)}>{t("dunning.create.send")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
