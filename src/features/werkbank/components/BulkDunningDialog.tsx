import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Token } from "@/components/ui/token";
import type { DunningDueRow } from "../data/dunning";
import { DunningActionError } from "../data/dunningActions";
import { useIssueDunning } from "../hooks/useDunningActions";
import { dueRecipient } from "../lib/dueRecipient";
import { invoicePath } from "../paths";

type Failure = { id: string; no: string };
type Outcome = { sent: number; skipped: number; failed: Failure[] };

/** Confirms and runs the bulk send: one notice after another (the server serialises per invoice),
 *  then a summary. `not_allowed` is skipped (state changed since the list loaded), any other
 *  error, a send failure after creation included, is failed and linked. Rows without an address
 *  are named and left out. */
export function BulkDunningDialog({ rows, onOpenChange }: { rows: DunningDueRow[]; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation("werkbank");
  const issue = useIssueDunning();
  const [done, setDone] = useState(0);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // Frozen when the run starts: the lists refresh while it runs and `rows` shrinks with them.
  const [frozen, setFrozen] = useState<DunningDueRow[] | null>(null);
  const sendable = frozen ?? rows.filter((r) => dueRecipient(r));
  const excluded = rows.filter((r) => !dueRecipient(r));

  const run = async () => {
    setFrozen(sendable);
    setRunning(true);
    const result: Outcome = { sent: 0, skipped: 0, failed: [] };
    for (const r of sendable) {
      try {
        await issue.mutateAsync({ invoiceId: r.invoice_id!, delivery: "email", send: {} });
        result.sent += 1;
      } catch (e) {
        if (e instanceof DunningActionError && e.code === "not_allowed") result.skipped += 1;
        else result.failed.push({ id: r.invoice_id!, no: r.invoice_no ?? r.invoice_id! });
      }
      setDone((d) => d + 1);
    }
    setRunning(false);
    setOutcome(result);
  };

  const summary = outcome && [
    outcome.sent && t("openItems.bulk.sent", { count: outcome.sent }),
    outcome.skipped && t("openItems.bulk.skipped", { count: outcome.skipped }),
    outcome.failed.length && t("openItems.bulk.failed", { count: outcome.failed.length }),
  ].filter(Boolean).join(", ");

  return (
    <Dialog open onOpenChange={(o) => { if (!running) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("openItems.bulk.title")}</DialogTitle>
          <DialogDescription>{outcome ? t("openItems.bulk.doneHint") : t("openItems.bulk.description")}</DialogDescription>
        </DialogHeader>

        {outcome ? (
          <div className="space-y-2 text-sm">
            <p className="m-0 font-medium">{summary || t("openItems.bulk.nothingSent")}</p>
            {outcome.failed.length > 0 && (
              <div>
                <p className="m-0 text-muted-foreground">{t("openItems.bulk.failedList")}</p>
                <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
                  {outcome.failed.map((f) => (
                    <li key={f.id}><Link to={invoicePath(f.id)} className="text-accent-text hover:underline">{f.no}</Link></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="m-0 font-medium">{t("openItems.bulk.count", { count: sendable.length })}</p>
            <ul className="m-0 max-h-48 list-none space-y-1 overflow-y-auto p-0">
              {sendable.map((r) => (
                <li key={r.invoice_id} className="flex flex-wrap gap-x-3">
                  <Token>{r.invoice_no}</Token>
                  <span>{r.customer_name}</span>
                  <span className="text-muted-foreground">{dueRecipient(r)}</span>
                </li>
              ))}
            </ul>
            {excluded.length > 0 && (
              <p className="m-0 text-muted-foreground">
                {t("openItems.bulk.excluded")} {excluded.map((r) => r.invoice_no).join(", ")}
              </p>
            )}
            {running && <p className="m-0" role="status">{t("openItems.bulk.progress", { done, total: sendable.length })}</p>}
          </div>
        )}

        <DialogFooter>
          {outcome ? (
            <Button onClick={() => onOpenChange(false)}>{t("openItems.bulk.close")}</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={running} onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
              <Button disabled={running || sendable.length === 0} onClick={() => void run()}>{t("openItems.bulk.confirm")}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
