import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

export interface NewTechnician {
  name: string;
  email: string;
  phone: string | null;
}

interface FormValues {
  name: string;
  email: string;
  phone: string;
}

const EMPTY: FormValues = { name: "", email: "", phone: "" };

/** Name and email are required (the email is where the app invitation goes), phone is optional.
 *  An email already used by a technician of this org is rejected, so a second attempt for the
 *  same person cannot create a duplicate row (`artists` has no unique email constraint). */
export function AddTechnicianDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
  existingEmails,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: NewTechnician) => void;
  submitting: boolean;
  /** Lower-cased emails of the org's technicians. */
  existingEmails: ReadonlySet<string>;
}) {
  const { t } = useTranslation("werkbank");
  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t("technicians.dialog.errors.name")),
        email: z
          .string()
          .trim()
          .min(1, t("technicians.dialog.errors.emailRequired"))
          .email(t("technicians.dialog.errors.emailInvalid"))
          .refine((email) => !existingEmails.has(email.toLowerCase()), t("technicians.dialog.errors.emailTaken")),
        phone: z.string().trim(),
      }),
    [t, existingEmails],
  );
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  useEffect(() => {
    if (!open) form.reset(EMPTY);
  }, [open, form]);

  const submit = form.handleSubmit((values) =>
    onSubmit({ name: values.name, email: values.email, phone: values.phone || null }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("technicians.dialog.title")}</DialogTitle>
          <DialogDescription>{t("technicians.dialog.description")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("technicians.dialog.name")}</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("technicians.dialog.email")}</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("technicians.dialog.phone")}</FormLabel>
                  <FormControl>
                    <Input type="tel" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("technicians.dialog.cancel")}
              </Button>
              <Button type="submit" disabled={submitting}>
                {t("technicians.dialog.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
