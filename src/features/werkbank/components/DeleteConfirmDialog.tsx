import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/** Confirmation before a hard delete. The caller names what goes away in `title` and `body`.
 *  The confirm button is a plain Button, so the dialog stays open until the caller closes it
 *  (a failed delete keeps it open, and `pending` blocks a second click). */
export function DeleteConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  onConfirm: () => void;
  pending: boolean;
}) {
  const { t } = useTranslation("werkbank");
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            {t("common.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
