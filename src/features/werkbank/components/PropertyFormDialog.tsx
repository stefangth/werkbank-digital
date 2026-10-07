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
import type { Property } from "../data/properties";
import { useCreateProperty, useUpdateProperty } from "../hooks/useProperties";
import { propertySchema, type PropertyForm } from "../schemas/property";
import { CountryField } from "./CountryField";
import { CustomerPicker } from "./CustomerPicker";

const empty = (customerId?: string): PropertyForm => ({
  customer_id: customerId ?? "",
  name: "",
  object_no: "",
  street: "",
  postal_code: "",
  city: "",
  country_code: "DE",
  has_billing: false,
  billing_name: "",
  billing_street: "",
  billing_postal_code: "",
  billing_city: "",
  billing_country_code: "DE",
  access_notes: "",
  notes: "",
});

function toFormValues(p: Property): PropertyForm {
  return {
    customer_id: p.customer_id,
    name: p.name,
    object_no: p.object_no ?? "",
    street: p.street,
    postal_code: p.postal_code,
    city: p.city,
    country_code: p.country_code,
    has_billing: p.billing_name !== null,
    billing_name: p.billing_name ?? "",
    billing_street: p.billing_street ?? "",
    billing_postal_code: p.billing_postal_code ?? "",
    billing_city: p.billing_city ?? "",
    billing_country_code: p.billing_country_code ?? "DE",
    access_notes: p.access_notes ?? "",
    notes: p.notes ?? "",
  };
}

/** Create (no `property`) or edit (`property`) a property. `customerId` preselects the customer
 *  on create. Owns its mutations and closes on success; a failed save keeps the dialog open (the
 *  hooks toast the error). */
export function PropertyFormDialog({
  open,
  onOpenChange,
  property,
  customerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property?: Property | null;
  customerId?: string;
}) {
  const { t } = useTranslation("werkbank");
  const create = useCreateProperty();
  const update = useUpdateProperty();
  const schema = useMemo(() => propertySchema(t), [t]);
  const form = useForm<PropertyForm>({ resolver: zodResolver(schema), defaultValues: empty(customerId) });
  // Two quick submits can both pass validation before `isPending` renders; this guard keeps one
  // attempt to one write.
  const submitting = useRef(false);

  useEffect(() => {
    if (open) form.reset(property ? toFormValues(property) : empty(customerId));
    else form.reset(empty(customerId));
  }, [open, property, customerId, form]);

  const hasBilling = form.watch("has_billing");
  const pending = create.isPending || update.isPending;

  const submit = form.handleSubmit((values) => {
    if (submitting.current) return;
    submitting.current = true;
    const handlers = {
      onSuccess: () => onOpenChange(false),
      onSettled: () => {
        submitting.current = false;
      },
    };
    if (property) update.mutate({ id: property.id, form: values }, handlers);
    else create.mutate(values, handlers);
  });

  const text = (name: keyof PropertyForm, label: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input autoComplete="off" {...field} value={typeof field.value === "string" ? field.value : ""} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const area = (name: "access_notes" | "notes", label: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Textarea {...field} />
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
          <DialogTitle>{property ? t("properties.dialog.editTitle") : t("properties.dialog.createTitle")}</DialogTitle>
          <DialogDescription>{t("properties.dialog.description")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="space-y-4">
            <FormField
              control={form.control}
              name="customer_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("properties.dialog.customer")}</FormLabel>
                  <FormControl>
                    <CustomerPicker ref={field.ref} value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              {text("name", t("properties.dialog.name"))}
              {text("object_no", t("properties.dialog.objectNo"))}
            </div>
            {text("street", t("customers.dialog.street"))}
            <div className="grid gap-4 sm:grid-cols-2">
              {text("postal_code", t("customers.dialog.postalCode"))}
              {text("city", t("customers.dialog.city"))}
            </div>
            <FormField
              control={form.control}
              name="country_code"
              render={({ field }) => (
                <FormItem>
                  <CountryField
                    id="property-country"
                    label={t("customers.dialog.country")}
                    value={field.value}
                    onChange={field.onChange}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            {area("access_notes", t("properties.dialog.accessNotes"))}
            {area("notes", t("properties.dialog.notes"))}
            <FormField
              control={form.control}
              name="has_billing"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />
                  </FormControl>
                  <FormLabel className="font-normal">{t("properties.dialog.hasBilling")}</FormLabel>
                </FormItem>
              )}
            />
            {hasBilling && (
              <div className="space-y-4 rounded-card border border-border p-4">
                {text("billing_name", t("properties.dialog.billingName"))}
                {text("billing_street", t("customers.dialog.street"))}
                <div className="grid gap-4 sm:grid-cols-2">
                  {text("billing_postal_code", t("customers.dialog.postalCode"))}
                  {text("billing_city", t("customers.dialog.city"))}
                </div>
                <FormField
                  control={form.control}
                  name="billing_country_code"
                  render={({ field }) => (
                    <FormItem>
                      <CountryField
                        id="property-billing-country"
                        label={t("customers.dialog.country")}
                        value={field.value}
                        onChange={field.onChange}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}
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
