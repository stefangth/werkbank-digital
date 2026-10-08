import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DunningNotice } from "../data/dunning";
import { DunningActionError, dunningActionErrorKey } from "../data/dunningActions";
import { useContacts } from "../hooks/useContacts";
import { useCustomer } from "../hooks/useCustomers";
import { useIssueDunning, useSendDunning } from "../hooks/useDunningActions";
import { splitAddresses } from "../lib/addresses";
import { defaultRecipient } from "../lib/defaultRecipient";
import { stageKey } from "../lib/stageKey";
import { HintedLabel } from "./DefaultHint";
import { hintId } from "../lib/hintId";

const MAIL = /^[^@\s]+@[^@\s]+$/;

/** Sends an existing notice by email again, or completes an unrendered email notice and sends it
 *  (`retry`). Recipient and CC are asked again, so a retry never loses typed addresses: the
 *  recipient is preset with the addresses the notice last went to, else the invoice's default. */
export function SendDunningDialog({ notice, invoice, retry, onOpenChange }: {
  notice: DunningNotice;
  invoice: { customer_id: string; contact_id: string | null };
  retry: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("werkbank");
  const send = useSendDunning();
  const issue = useIssueDunning();
  const { data: customer } = useCustomer(invoice.customer_id);
  const { data: contacts } = useContacts({ customerId: invoice.customer_id });
  const contact = invoice.contact_id ? contacts?.find((c) => c.id === invoice.contact_id) : undefined;
  const last = notice.sent_to ?? [];
  const defaultTo = last.length ? last.join(", ") : defaultRecipient(customer ?? null, contact ?? null);

  // null = untouched, so the preset follows the customer as it loads.
  const [toInput, setToInput] = useState<string | null>(null);
  const [ccInput, setCcInput] = useState("");
  const [error, setError] = useState<DunningActionError | null>(null);
  const to = splitAddresses(toInput ?? defaultTo);
  const cc = splitAddresses(ccInput);
  const malformed = [...to, ...cc].some((a) => !MAIL.test(a));
  const pending = send.isPending || issue.isPending;
  const stage = t(stageKey(notice.stage));

  const submit = async () => {
    setError(null);
    const recipients = { to, ...(cc.length ? { cc } : {}) };
    try {
      if (retry) await issue.mutateAsync({ invoiceId: notice.invoice_id, delivery: "email", send: recipients });
      else await send.mutateAsync({ noticeId: notice.id, ...recipients });
      toast.success(t(retry ? "dunning.row.retried" : "dunning.row.resent"));
      onOpenChange(false);
    } catch (e) {
      const err = e instanceof DunningActionError ? e : new DunningActionError("unknown");
      if (retry && err.issued) {
        toast.warning(t(err.code === "send_failed" ? "dunning.create.issuedSendFailed" : "dunning.create.issuedRenderFailed"));
        onOpenChange(false);
      } else setError(err);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (next || !pending) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(retry ? "dunning.send.retryTitle" : "dunning.send.resendTitle", { stage })}</DialogTitle>
          <DialogDescription>{t("dunning.send.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <HintedLabel htmlFor="dunning-send-to" hint={t(last.length ? "dunning.send.hintToLast" : "dunning.create.hintTo")}>
              {t("dunning.create.to")}
            </HintedLabel>
            <Input id="dunning-send-to" type="text" aria-describedby={hintId("dunning-send-to")} value={toInput ?? defaultTo} onChange={(e) => setToInput(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dunning-send-cc">{t("dunning.create.cc")}</Label>
            <Input id="dunning-send-cc" type="text" value={ccInput} onChange={(e) => setCcInput(e.target.value)} />
          </div>
          {malformed && <Alert variant="destructive">{t("invoices.send.errors.invalidRecipient")}</Alert>}
          {error?.code === "not_allowed" ? (
            <Alert variant="destructive">
              <ul className="m-0 list-disc pl-4">
                {error.blockers.map((b) => <li key={b}>{t(`dunning.blockers.${b}`, { defaultValue: t("errors.dunningNotAllowed") })}</li>)}
              </ul>
            </Alert>
          ) : error && <Alert variant="destructive">{t(dunningActionErrorKey(error.code))}</Alert>}
        </div>
        <DialogFooter>
          <Button variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button disabled={pending || malformed || to.length === 0} onClick={() => void submit()}>{t("dunning.send.submit")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
