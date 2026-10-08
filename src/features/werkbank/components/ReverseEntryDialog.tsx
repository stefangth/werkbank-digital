import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useReverseEntry } from "../hooks/useOpenItems";
import { reverseEntrySchema, type ReverseEntryForm } from "../schemas/payment";

/** Reverses a ledger entry with a required reason. The entry stays in the list, marked reversed. */
export function ReverseEntryDialog({ entryId, onOpenChange }: { entryId: string; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation("werkbank");
  const reverse = useReverseEntry();
  const { register, handleSubmit, formState: { errors } } = useForm<ReverseEntryForm>({
    resolver: zodResolver(reverseEntrySchema(t)), defaultValues: { reason: "" },
  });
  const submit = handleSubmit(async (v) => {
    try {
      await reverse.mutateAsync({ entryId, reason: v.reason });
      toast.success(t("payments.reverseDialog.saved"));
      onOpenChange(false);
    } catch {
      // The hook already toasted the translated error.
    }
  });
  return (
    <Dialog open onOpenChange={(next) => { if (next || !reverse.isPending) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("payments.reverseDialog.title")}</DialogTitle>
          <DialogDescription>{t("payments.reverseDialog.description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="reverse-reason">{t("payments.reverseDialog.reason")}</Label>
            <Input id="reverse-reason" autoComplete="off" maxLength={500} {...register("reason")} />
            {errors.reason && <p className="m-0 text-sm text-destructive">{errors.reason.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={reverse.isPending} onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={reverse.isPending}>{t("payments.reverseDialog.submit")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
