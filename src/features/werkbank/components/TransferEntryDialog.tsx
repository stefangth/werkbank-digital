import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Metric } from "@/components/ui/metric";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Token } from "@/components/ui/token";
import { useTransferEntry, useTransferTargets } from "../hooks/useOpenItems";
import { formatEuro } from "../lib/money";
import { transferEntrySchema, type TransferEntryForm } from "../schemas/payment";

/** Moves a payment to another issued invoice of the same customer, with a required reason. */
export function TransferEntryDialog({
  entryId, invoiceId, customerId, onOpenChange,
}: {
  entryId: string;
  invoiceId: string;
  customerId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation("werkbank");
  const transfer = useTransferEntry();
  const { data: targets } = useTransferTargets(customerId, invoiceId, true);
  const form = useForm<TransferEntryForm>({
    resolver: zodResolver(transferEntrySchema(t)), defaultValues: { targetInvoiceId: "", reason: "" },
  });
  const { register, watch, setValue, formState: { errors } } = form;
  const submit = form.handleSubmit(async (v) => {
    try {
      await transfer.mutateAsync({ entryId, ...v });
      toast.success(t("payments.transferDialog.saved"));
      onOpenChange(false);
    } catch {
      // The hook already toasted the translated error.
    }
  });
  return (
    <Dialog open onOpenChange={(next) => { if (next || !transfer.isPending) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("payments.transferDialog.title")}</DialogTitle>
          <DialogDescription>{t("payments.transferDialog.description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label id="transfer-target">{t("payments.form.target")}</Label>
            {targets?.length === 0 && <p className="m-0 text-sm text-muted-foreground">{t("payments.form.none")}</p>}
            <RadioGroup aria-labelledby="transfer-target" value={watch("targetInvoiceId")} onValueChange={(v) => setValue("targetInvoiceId", v, { shouldValidate: true })}>
              {(targets ?? []).map((inv) => (
                <div key={inv.id} className="flex items-center gap-2">
                  <RadioGroupItem id={`transfer-${inv.id}`} value={inv.id!} />
                  <Label htmlFor={`transfer-${inv.id}`} className="flex gap-2">
                    <Token>{inv.invoice_no}</Token>
                    <Metric size="body">{formatEuro(inv.gross_total ?? 0, i18n.language)}</Metric>
                  </Label>
                </div>
              ))}
            </RadioGroup>
            {errors.targetInvoiceId && <p className="m-0 text-sm text-destructive">{errors.targetInvoiceId.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="transfer-reason">{t("payments.transferDialog.reason")}</Label>
            <Input id="transfer-reason" autoComplete="off" maxLength={500} {...register("reason")} />
            {errors.reason && <p className="m-0 text-sm text-destructive">{errors.reason.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={transfer.isPending} onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={transfer.isPending}>{t("payments.transferDialog.submit")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
