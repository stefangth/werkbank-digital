import { useEffect, useMemo } from "react";
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
import { companyProfileSchema, toCompanyProfileRow, type CompanyProfileForm } from "../schemas/companyProfile";
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
};

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
  };
}

function CompanyForm({ profile }: { profile: CompanyProfile | null }) {
  const { t } = useTranslation("werkbank");
  const save = useSaveCompanyProfile();
  const schema = useMemo(() => companyProfileSchema(t), [t]);
  const form = useForm<CompanyProfileForm>({ resolver: zodResolver(schema), defaultValues: toFormValues(profile) });

  useEffect(() => {
    form.reset(toFormValues(profile));
  }, [profile, form]);

  const submit = form.handleSubmit((values) => {
    if (save.isPending) return;
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

  const area = (name: "quote_intro" | "quote_closing" | "payment_terms_text", labelKey: string) => (
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
            render={({ field }) => <LogoUpload value={field.value} onChange={field.onChange} />}
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

        <Button type="submit" disabled={save.isPending}>{t("common.save")}</Button>
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
