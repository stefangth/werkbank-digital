import { useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import type { Customer } from "../data/customers";
import { useCreateCustomer, useUpdateCustomer } from "../hooks/useCustomers";
import { customerSchema, type CustomerForm } from "../schemas/customer";
import { CountryField } from "./CountryField";

const EMPTY: CustomerForm = {
  kind: "property_manager",
  company_name: "",
  first_name: "",
  last_name: "",
  street: "",
  postal_code: "",
  city: "",
  country_code: "DE",
  email: "",
  invoice_email: "",
  phone: "",
  vat_id: "",
  payment_terms_days: "14",
  notes: "",
  customer_no: "",
};

function toFormValues(c: Customer): CustomerForm {
  return {
    kind: c.kind === "private" ? "private" : "property_manager",
    company_name: c.company_name ?? "",
    first_name: c.first_name ?? "",
    last_name: c.last_name ?? "",
    street: c.street,
    postal_code: c.postal_code,
    city: c.city,
    country_code: c.country_code,
    email: c.email ?? "",
    invoice_email: c.invoice_email ?? "",
    phone: c.phone ?? "",
    vat_id: c.vat_id ?? "",
    payment_terms_days: String(c.payment_terms_days),
    notes: c.notes ?? "",
    customer_no: c.customer_no,
  };
}

/** Create (no `customer`) or edit (`customer`) a customer. Owns its mutations and closes on
 *  success; a failed save keeps the dialog open (the hooks toast the error). */
export function CustomerFormDialog({
  open,
  onOpenChange,
  customer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: Customer | null;
}) {
  const { t } = useTranslation("werkbank");
  const create = useCreateCustomer();
  const update = useUpdateCustomer();
  const schema = useMemo(() => customerSchema(t), [t]);
  const form = useForm<CustomerForm>({ resolver: zodResolver(schema), defaultValues: EMPTY });
  // Two quick submits can both pass validation before `isPending` renders; this guard keeps one
  // attempt to one write.
  const submitting = useRef(false);

  useEffect(() => {
    if (open) form.reset(customer ? toFormValues(customer) : EMPTY);
    else form.reset(EMPTY);
  }, [open, customer, form]);

  const kind = form.watch("kind");
  const pending = create.isPending || update.isPending;

  const submit = form.handleSubmit((values) => {
    if (submitting.current) return;
    submitting.current = true;
    const onSettled = () => {
      submitting.current = false;
    };
    if (customer) {
      update.mutate(
        { id: customer.id, form: values },
        { onSuccess: () => onOpenChange(false), onSettled },
      );
    } else {
      create.mutate(values, {
        onSuccess: (created) => {
          toast.success(t("customers.toast.created", { number: created.customer_no }));
          onOpenChange(false);
        },
        onSettled,
      });
    }
  });

  const text = (name: keyof CustomerForm, labelKey: string, extra: { inputMode?: "email" | "tel" | "numeric" } = {}) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t(labelKey)}</FormLabel>
          <FormControl>
            <Input autoComplete="off" {...extra} {...field} value={field.value ?? ""} />
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
          <DialogTitle>{customer ? t("customers.dialog.editTitle") : t("customers.dialog.createTitle")}</DialogTitle>
          <DialogDescription>{t("customers.dialog.description")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="space-y-4">
            <SegmentedControl
              value={kind}
              onChange={(k) => form.setValue("kind", k, { shouldDirty: true })}
              options={[
                { value: "property_manager", label: t("kind.property_manager") },
                { value: "private", label: t("kind.private") },
              ]}
            />
            {kind === "property_manager" ? (
              text("company_name", "customers.dialog.companyName")
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {text("first_name", "customers.dialog.firstName")}
                {text("last_name", "customers.dialog.lastName")}
              </div>
            )}
            {text("street", "customers.dialog.street")}
            <div className="grid gap-4 sm:grid-cols-2">
              {text("postal_code", "customers.dialog.postalCode")}
              {text("city", "customers.dialog.city")}
            </div>
            <FormField
              control={form.control}
              name="country_code"
              render={({ field }) => (
                <FormItem>
                  <CountryField
                    id="customer-country"
                    label={t("customers.dialog.country")}
                    value={field.value}
                    onChange={field.onChange}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              {text("email", "customers.dialog.email", { inputMode: "email" })}
              {text("invoice_email", "customers.dialog.invoiceEmail", { inputMode: "email" })}
              {text("phone", "customers.dialog.phone", { inputMode: "tel" })}
              {text("vat_id", "customers.dialog.vatId")}
              {text("payment_terms_days", "customers.dialog.paymentTerms", { inputMode: "numeric" })}
              {text("customer_no", "customers.dialog.customerNo")}
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">{t("customers.dialog.customerNoHint")}</p>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("customers.dialog.notes")}</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <FormMessage />
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
