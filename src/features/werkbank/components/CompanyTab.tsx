import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { CompanyProfile } from "../data/companyProfile";
import { useCompanyProfile, useSaveCompanyProfile } from "../hooks/useCompanyProfile";
import { DEFAULT_STAGE_TEXTS } from "../lib/dunningDefaults";
import { stageKey } from "../lib/stageKey";
import { companyProfileSchema, toCompanyProfileRow, type CompanyProfileForm } from "../schemas/companyProfile";
import { DefaultHint } from "./DefaultHint";
import { CountryField } from "./CountryField";
import { LogoUpload } from "./LogoUpload";

const EMPTY: CompanyProfileForm = {
  company_name: "",
  legal_form: "",
  street: "",
  postal_code: "",
  city: "",
  country_code: "DE",
  phone: "",
  email: "",
  website: "",
  tax_number: "",
  vat_id: "",
  register_court: "",
  register_number: "",
  iban: "",
  bic: "",
  bank_name: "",
  logo_path: "",
  quote_intro: "",
  quote_closing: "",
  payment_terms_text: "",
  quote_validity_days: "30",
  invoice_intro: "",
  invoice_closing: "",
  payment_due_days: "14",
  reminder_after_days: "7",
  dunning1_after_days: "14",
  dunning2_after_days: "14",
  dunning_deadline_days: "7",
  reminder_text: "",
  dunning1_text: "",
  dunning2_text: "",
};

type DunningDayField = "reminder_after_days" | "dunning1_after_days" | "dunning2_after_days" | "dunning_deadline_days";

const STAGES = [
  { stage: 1, field: "reminder_after_days", textField: "reminder_text", hint: "reminder" },
  { stage: 2, field: "dunning1_after_days", textField: "dunning1_text", hint: "dunning1" },
  { stage: 3, field: "dunning2_after_days", textField: "dunning2_text", hint: "dunning2" },
] as const;

function toFormValues(p: CompanyProfile | null): CompanyProfileForm {
  if (!p) return EMPTY;
  return {
    company_name: p.company_name,
    legal_form: p.legal_form ?? "",
    street: p.street,
    postal_code: p.postal_code,
    city: p.city,
    country_code: p.country_code,
    phone: p.phone ?? "",
    email: p.email ?? "",
    website: p.website ?? "",
    tax_number: p.tax_number ?? "",
    vat_id: p.vat_id ?? "",
    register_court: p.register_court ?? "",
    register_number: p.register_number ?? "",
    iban: p.iban ?? "",
    bic: p.bic ?? "",
    bank_name: p.bank_name ?? "",
    logo_path: p.logo_path ?? "",
    quote_intro: p.quote_intro ?? "",
    quote_closing: p.quote_closing ?? "",
    payment_terms_text: p.payment_terms_text ?? "",
    quote_validity_days: String(p.quote_validity_days),
    invoice_intro: p.invoice_intro ?? "",
    invoice_closing: p.invoice_closing ?? "",
    payment_due_days: String(p.payment_due_days),
    reminder_after_days: String(p.reminder_after_days),
    dunning1_after_days: String(p.dunning1_after_days),
    dunning2_after_days: String(p.dunning2_after_days),
    dunning_deadline_days: String(p.dunning_deadline_days),
    reminder_text: p.reminder_text ?? "",
    dunning1_text: p.dunning1_text ?? "",
    dunning2_text: p.dunning2_text ?? "",
  };
}

function CompanyForm({ profile }: { profile: CompanyProfile | null }) {
  const { t } = useTranslation("werkbank");
  const save = useSaveCompanyProfile();
  // Save waits for a running logo upload, or it would store the previous logo_path.
  const [logoUploading, setLogoUploading] = useState(false);
  const schema = useMemo(() => companyProfileSchema(t), [t]);
  const form = useForm<CompanyProfileForm>({ resolver: zodResolver(schema), defaultValues: toFormValues(profile) });

  const submit = form.handleSubmit((values) => {
    if (save.isPending || logoUploading) return;
    save.mutate(toCompanyProfileRow(values));
  });

  const text = (name: Exclude<keyof CompanyProfileForm, "logo_path">, labelKey: string, extra: { inputMode?: "email" | "tel" | "numeric" } = {}) => (
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

  const area = (name: "quote_intro" | "quote_closing" | "payment_terms_text" | "invoice_intro" | "invoice_closing", labelKey: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t(labelKey)}</FormLabel>
          <FormControl>
            <Textarea rows={3} {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const dunningField = (name: DunningDayField, label: string, hintKey: string) => (
    <FormField
      key={name}
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel className="inline-flex items-center gap-1.5">
            {label}
            <DefaultHint text={t(hintKey)} />
          </FormLabel>
          <FormControl>
            <Input autoComplete="off" inputMode="numeric" {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="space-y-6">
        <section className="space-y-4">
          <Eyebrow>{t("company.sections.company")}</Eyebrow>
          <div className="grid gap-4 sm:grid-cols-2">
            {text("company_name", "company.fields.companyName")}
            {text("legal_form", "company.fields.legalForm")}
          </div>
          <FormField
            control={form.control}
            name="logo_path"
            render={({ field }) => <LogoUpload value={field.value} onChange={field.onChange} onPendingChange={setLogoUploading} />}
          />
          {text("street", "company.fields.street")}
          <div className="grid gap-4 sm:grid-cols-2">
            {text("postal_code", "company.fields.postalCode")}
            {text("city", "company.fields.city")}
          </div>
          <FormField
            control={form.control}
            name="country_code"
            render={({ field }) => (
              <FormItem>
                <CountryField id="company-country" label={t("company.fields.country")} value={field.value} onChange={field.onChange} />
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <section className="space-y-4">
          <Eyebrow>{t("company.sections.contact")}</Eyebrow>
          <div className="grid gap-4 sm:grid-cols-2">
            {text("email", "company.fields.email", { inputMode: "email" })}
            {text("phone", "company.fields.phone", { inputMode: "tel" })}
            {text("website", "company.fields.website")}
          </div>
        </section>

        <section className="space-y-4">
          <Eyebrow>{t("company.sections.legal")}</Eyebrow>
          <div className="grid gap-4 sm:grid-cols-2">
            {text("tax_number", "company.fields.taxNumber")}
            {text("vat_id", "company.fields.vatId")}
            {text("register_court", "company.fields.registerCourt")}
            {text("register_number", "company.fields.registerNumber")}
          </div>
          <p className="text-sm text-muted-foreground">{t("company.taxHint")}</p>
        </section>

        <section className="space-y-4">
          <Eyebrow>{t("company.sections.bank")}</Eyebrow>
          <div className="grid gap-4 sm:grid-cols-2">
            {text("iban", "company.fields.iban")}
            {text("bic", "company.fields.bic")}
            {text("bank_name", "company.fields.bankName")}
          </div>
        </section>

        <section className="space-y-4">
          <Eyebrow>{t("company.sections.texts")}</Eyebrow>
          {area("quote_intro", "company.fields.quoteIntro")}
          {area("quote_closing", "company.fields.quoteClosing")}
          {area("payment_terms_text", "company.fields.paymentTerms")}
          <div className="sm:max-w-48">{text("quote_validity_days", "company.fields.validity", { inputMode: "numeric" })}</div>
        </section>

        <section className="space-y-4">
          <Eyebrow>{t("company.sections.invoiceTexts")}</Eyebrow>
          {area("invoice_intro", "company.fields.invoiceIntro")}
          {area("invoice_closing", "company.fields.invoiceClosing")}
          <div className="sm:max-w-48">{text("payment_due_days", "company.fields.paymentDueDays", { inputMode: "numeric" })}</div>
        </section>

        <section className="space-y-4">
          <Eyebrow>{t("company.sections.dunning")}</Eyebrow>
          <div className="grid gap-4 sm:grid-cols-2">
            {STAGES.map(({ stage, field, hint }) =>
              dunningField(field, t("company.dunning.afterDays", { stage: t(stageKey(stage)) }), `company.dunning.hint.${hint}`))}
            {dunningField("dunning_deadline_days", t("company.dunning.deadline"), "company.dunning.hint.deadline")}
          </div>
          {STAGES.map(({ stage, textField }) => (
            <FormField
              key={textField}
              control={form.control}
              name={textField}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="inline-flex items-center gap-1.5">
                    {t("company.dunning.textLabel", { stage: t(stageKey(stage)) })}
                    <DefaultHint text={t("company.dunning.hint.text")} />
                  </FormLabel>
                  <FormControl>
                    <Textarea rows={4} placeholder={DEFAULT_STAGE_TEXTS[stage]} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </section>

        <Button type="submit" disabled={save.isPending || logoUploading}>{t("common.save")}</Button>
      </form>
    </Form>
  );
}

/** Settings tab "Firmendaten" (admins of a handwerk org): the sender data every quote needs. */
export function CompanyTab() {
  const { t } = useTranslation("werkbank");
  const { data, isLoading, isError } = useCompanyProfile();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">{t("company.title")}</CardTitle>
        <CardDescription>{t("company.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-48 w-full" />}
        {isError && (
          <Alert variant="destructive">
            <AlertDescription>{t("company.loadFailed")}</AlertDescription>
          </Alert>
        )}
        {/* Keyed on the stored row: a refetch after a save re-mounts the form with what is stored. */}
        {!isLoading && !isError && <CompanyForm key={data?.updated_at ?? "new"} profile={data ?? null} />}
      </CardContent>
    </Card>
  );
}
