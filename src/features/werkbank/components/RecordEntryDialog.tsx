import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Metric } from "@/components/ui/metric";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { berlinDateKey, formatDateDMY } from "@/lib/dates";
import { useRecordEntry } from "../hooks/useOpenItems";
import { mapDbError } from "../lib/dbErrors";
import { formatEuro, parseEuroInput } from "../lib/money";
import { recordEntrySchema, WRITE_OFF_REASONS, type RecordEntryForm, type RecordEntryMode } from "../schemas/payment";
import { DatePopover } from "./DatePopover";
import { DefaultHint } from "./DefaultHint";

const asInput = (n: number) => n.toFixed(2).replace(".", ",");

/** Books a payment (preset: Berlin today and the open amount), a write-off (always the whole open
 *  amount) or a refund of credit. `openAmount` is negative while the invoice holds credit. When the
 *  database reports the open amount moved meanwhile, the dialog says so and `onStale` refetches. */
export function RecordEntryDialog({
  invoiceId, mode, openAmount, onStale, onOpenChange,
}: {
  invoiceId: string;
  mode: RecordEntryMode;
  openAmount: number;
  onStale: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation("werkbank");
  const record = useRecordEntry();
  const [stale, setStale] = useState(false);
  const open = Math.max(openAmount, 0);
  const credit = Math.max(-openAmount, 0);
  const preset = mode === "refund" ? credit : open;
  const form = useForm<RecordEntryForm>({
    resolver: zodResolver(recordEntrySchema(t, mode, credit)),
    defaultValues: { amount: asInput(preset), bookedOn: berlinDateKey(new Date()), note: "", writeOffReason: "" },
  });
  const { register, watch, setValue, formState: { errors } } = form;
  const bookedOn = watch("bookedOn");
  const reason = watch("writeOffReason");
  const typed = parseEuroInput(watch("amount"));
  const overOpen = mode === "payment" && typed !== null && Math.round(typed * 100) > Math.round(open * 100);

  const submit = form.handleSubmit(async (v) => {
    setStale(false);
    try {
      await record.mutateAsync({
        invoiceId, kind: mode, bookedOn: v.bookedOn,
        amount: mode === "write_off" ? open : parseEuroInput(v.amount)!,
        note: v.note.trim() || undefined,
        writeOffReason: mode === "write_off" ? (v.writeOffReason as (typeof WRITE_OFF_REASONS)[number]) : undefined,
      });
      toast.success(t(`payments.${mode === "refund" ? "refund_dialog" : mode}.saved`));
      onOpenChange(false);
    } catch (e) {
      // The hook already toasted; the stale amount also needs the page to show the new one.
      if (mapDbError(e) === "errors.openAmountChanged") {
        setStale(true);
        onStale();
      }
    }
  });
  const copy = mode === "refund" ? "payments.refund_dialog" : `payments.${mode}`;

  return (
    <Dialog open onOpenChange={(next) => { if (next || !record.isPending) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`${copy}.title`)}</DialogTitle>
          <DialogDescription>{t(`${copy}.description`)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="entry-date" className="flex items-center gap-1.5">
              {t("payments.form.date")}
              {mode !== "write_off" && <DefaultHint text={t("payments.hints.date")} />}
            </Label>
            <DatePopover value={bookedOn} onSelect={(d) => setValue("bookedOn", d, { shouldValidate: true })}>
              <Button id="entry-date" type="button" variant="secondary" className="w-full justify-start gap-2" aria-label={t("payments.form.date")}>
                <CalendarDays className="h-4 w-4" aria-hidden />
                {bookedOn ? <Metric size="body">{formatDateDMY(bookedOn)}</Metric> : t("payments.form.pickDate")}
              </Button>
            </DatePopover>
          </div>

          {mode === "write_off" ? (
            <>
              <p className="m-0 text-sm">
                {t("payments.open")} <Metric size="body">{formatEuro(open, i18n.language)}</Metric>
              </p>
              <div className="space-y-2">
                <Label id="entry-reason">{t("payments.form.reason")}</Label>
                <RadioGroup aria-labelledby="entry-reason" value={reason} onValueChange={(v) => setValue("writeOffReason", v as RecordEntryForm["writeOffReason"], { shouldValidate: true })}>
                  {WRITE_OFF_REASONS.map((r) => (
                    <div key={r} className="flex items-center gap-2">
                      <RadioGroupItem id={`entry-reason-${r}`} value={r} />
                      <Label htmlFor={`entry-reason-${r}`}>{t(`payments.reason.${r}`)}</Label>
                    </div>
                  ))}
                </RadioGroup>
                {errors.writeOffReason && <p className="m-0 text-sm text-destructive">{errors.writeOffReason.message}</p>}
              </div>
              <p className="m-0 text-sm text-muted-foreground">{t("payments.write_off.hint")}</p>
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="entry-amount" className="flex items-center gap-1.5">
                {t("payments.form.amount")}
                <DefaultHint text={t(mode === "refund" ? "payments.hints.refund" : "payments.hints.amount")} />
              </Label>
              <Input id="entry-amount" inputMode="decimal" autoComplete="off" {...register("amount")} />
              {errors.amount && <p className="m-0 text-sm text-destructive">{errors.amount.message}</p>}
              {overOpen && <Alert>{t("payments.warnings.overOpen")}</Alert>}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="entry-note">{t(mode === "write_off" && reason === "other" ? "payments.form.noteRequired" : "payments.form.note")}</Label>
            <Input id="entry-note" autoComplete="off" maxLength={500} {...register("note")} />
            {errors.note && <p className="m-0 text-sm text-destructive">{errors.note.message}</p>}
          </div>

          {stale && <Alert variant="destructive">{t("errors.openAmountChanged")}</Alert>}
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={record.isPending} onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={record.isPending || (mode === "write_off" && open <= 0)}>{t(`${copy}.submit`)}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
