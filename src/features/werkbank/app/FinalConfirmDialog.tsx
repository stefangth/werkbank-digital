import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";

/** Confirms a step that locks a visit report for good. The action runs once: a double tap on the
 *  confirm button is dropped, and the dialog stays open (both buttons disabled) until `onConfirm`
 *  calls `done`. */
export function FinalConfirmDialog({ open, onOpenChange, title, action, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  action: string;
  onConfirm: (done: () => void) => void;
}) {
  const { t } = useTranslation("werkbank");
  const running = useRef(false);
  const [pending, setPending] = useState(false);

  const confirm = () => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    onConfirm(() => {
      running.current = false;
      setPending(false);
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{t("app.report.finalBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className={buttonVariants({ variant: "secondary", size: "touch" })}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <Button size="touch" disabled={pending} onClick={confirm}>{action}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
