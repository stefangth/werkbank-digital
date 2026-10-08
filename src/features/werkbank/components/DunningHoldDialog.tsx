import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Metric } from "@/components/ui/metric";
import { berlinDateKey, formatDateDMY } from "@/lib/dates";
import { useSetDunningHold } from "../hooks/useOpenItems";
import { DatePopover } from "./DatePopover";
import { DefaultHint } from "./DefaultHint";

/** Pauses dunning for one invoice: a reason and an optional last day of the pause. Without a date
 *  the hold lasts until it is lifted. The hook toasts a database error. */
export function DunningHoldDialog({ invoiceId, onOpenChange }: { invoiceId: string; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation("werkbank");
  const setHold = useSetDunningHold();
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState<string | null>(null);
  const today = berlinDateKey(new Date());

  const submit = async () => {
    try {
      await setHold.mutateAsync({ invoiceId, reason: reason.trim(), until });
      toast.success(t("dunning.hold.saved"));
      onOpenChange(false);
    } catch {
      // Already toasted by the hook.
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (next || !setHold.isPending) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dunning.hold.title")}</DialogTitle>
          <DialogDescription>{t("dunning.hold.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hold-reason">{t("dunning.hold.reason")}</Label>
            <Input id="hold-reason" autoComplete="off" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hold-until" className="flex items-center gap-1.5">
              {t("dunning.hold.until")}
              <DefaultHint text={t("dunning.hold.hint")} />
            </Label>
            <div className="flex gap-2">
              <DatePopover value={until} minDate={today} onSelect={setUntil}>
                <Button id="hold-until" type="button" variant="secondary" className="flex-1 justify-start gap-2" aria-label={t("dunning.hold.until")}>
                  <CalendarDays className="h-4 w-4" aria-hidden />
                  {until ? <Metric size="body">{formatDateDMY(until)}</Metric> : t("dunning.hold.noDate")}
                </Button>
              </DatePopover>
              {until && <Button type="button" variant="secondary" onClick={() => setUntil(null)}>{t("dunning.hold.clearDate")}</Button>}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" disabled={setHold.isPending} onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button disabled={setHold.isPending || !reason.trim()} onClick={() => void submit()}>{t("dunning.hold.submit")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
