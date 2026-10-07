import { useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import type { Contact, ContactParent } from "../data/contacts";
import { useCreateContact, useUpdateContact } from "../hooks/useContacts";
import { contactSchema, type ContactForm } from "../schemas/contact";

const EMPTY: ContactForm = {
  first_name: "",
  last_name: "",
  role: "",
  phone: "",
  mobile: "",
  email: "",
  notes: "",
  is_primary: false,
};

const toFormValues = (c: Contact): ContactForm => ({
  first_name: c.first_name ?? "",
  last_name: c.last_name,
  role: c.role ?? "",
  phone: c.phone ?? "",
  mobile: c.mobile ?? "",
  email: c.email ?? "",
  notes: c.notes ?? "",
  is_primary: c.is_primary,
});

/** Create (no `contact`) or edit (`contact`) a contact of `parent`. Owns its mutations and
 *  closes on success; a failed save keeps the dialog open (the hooks toast the error). */
export function ContactFormDialog({
  open,
  onOpenChange,
  parent,
  contact,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parent: ContactParent;
  contact?: Contact | null;
}) {
  const { t } = useTranslation("werkbank");
  const create = useCreateContact();
  const update = useUpdateContact();
  const schema = useMemo(() => contactSchema(t), [t]);
  const form = useForm<ContactForm>({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const submitting = useRef(false);

  useEffect(() => {
    if (open) form.reset(contact ? toFormValues(contact) : EMPTY);
    else form.reset(EMPTY);
  }, [open, contact, form]);

  const pending = create.isPending || update.isPending;

  const save = (values: ContactForm) => {
    if (submitting.current) return;
    submitting.current = true;
    const onSettled = () => {
      submitting.current = false;
    };
    if (contact) {
      update.mutate({ parent, id: contact.id, form: values }, { onSuccess: () => onOpenChange(false), onSettled });
    } else {
      create.mutate({ parent, form: values }, { onSuccess: () => onOpenChange(false), onSettled });
    }
  };

  const text = (name: Exclude<keyof ContactForm, "is_primary">, labelKey: string, inputMode?: "email" | "tel") => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t(labelKey)}</FormLabel>
          <FormControl>
            <Input autoComplete="off" inputMode={inputMode} {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{contact ? t("contacts.dialog.editTitle") : t("contacts.dialog.createTitle")}</DialogTitle>
          <DialogDescription>{t("contacts.dialog.description")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={(e) => void form.handleSubmit(save)(e)} noValidate className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {text("first_name", "contacts.dialog.firstName")}
              {text("last_name", "contacts.dialog.lastName")}
            </div>
            {text("role", "contacts.dialog.role")}
            <div className="grid gap-4 sm:grid-cols-2">
              {text("phone", "contacts.dialog.phone", "tel")}
              {text("mobile", "contacts.dialog.mobile", "tel")}
            </div>
            {text("email", "contacts.dialog.email", "email")}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("contacts.dialog.notes")}</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="is_primary"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />
                  </FormControl>
                  <FormLabel className="font-normal">{t("contacts.dialog.isPrimary")}</FormLabel>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
