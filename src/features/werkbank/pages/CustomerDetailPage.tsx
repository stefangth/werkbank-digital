import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Building2 } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { ContactsSection } from "../components/ContactsSection";
import { CustomerFormDialog } from "../components/CustomerFormDialog";
import { DocumentsSection } from "../components/DocumentsSection";
import { DeleteConfirmDialog } from "../components/DeleteConfirmDialog";
import { PropertyFormDialog } from "../components/PropertyFormDialog";
import { useArchiveCustomer, useCustomer, useDeleteCustomer } from "../hooks/useCustomers";
import { usePropertiesForCustomer } from "../hooks/useProperties";
import { customerDisplayName } from "../lib/displayName";
import { CUSTOMERS_PATH, propertyPath } from "../paths";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 whitespace-pre-line">{children}</dd>
    </div>
  );
}

/** One customer: master data, their properties (with a create button) and their contacts. */
export function CustomerDetailPage() {
  const { t } = useTranslation("werkbank");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const canDelete = hasRole("admin");

  const { data: customer, isLoading, isError } = useCustomer(id);
  const properties = usePropertiesForCustomer(customer?.id);
  const archive = useArchiveCustomer();
  const remove = useDeleteCustomer();
  const [editing, setEditing] = useState(false);
  const [addingProperty, setAddingProperty] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (isError) return <Alert variant="destructive">{t("customers.detail.loadFailed")}</Alert>;
  if (!customer) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={Building2}
          title={t("customers.detail.notFound.title")}
          reason={t("customers.detail.notFound.reason")}
        />
        <p className="text-center">
          <Link to={CUSTOMERS_PATH} className="text-sm font-medium text-accent-text hover:underline">
            {t("customers.detail.notFound.back")}
          </Link>
        </p>
      </div>
    );
  }

  const name = customerDisplayName(customer);
  const none = t("customers.detail.none");

  // On a database error (properties still exist) the hook toasts and the dialog stays open.
  const confirmDelete = () =>
    remove.mutate(customer.id, {
      onSuccess: () => {
        setConfirmingDelete(false);
        navigate(CUSTOMERS_PATH);
      },
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title={name}
        sub={customer.customer_no}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t("common.edit")}
            </Button>
            <Button
              variant="secondary"
              disabled={archive.isPending}
              onClick={() => archive.mutate({ id: customer.id, archived: !customer.archived_at })}
            >
              {customer.archived_at ? t("common.restore") : t("common.archive")}
            </Button>
            {canDelete && (
              <Button variant="destructive" onClick={() => setConfirmingDelete(true)}>
                {t("common.delete")}
              </Button>
            )}
          </>
        }
      />
      <div className="flex gap-2">
        <StatusPill tone={customer.kind === "property_manager" ? "accent" : "neutral"}>
          {t(`kind.${customer.kind}`)}
        </StatusPill>
        {customer.archived_at && <StatusPill tone="neutral">{t("customers.archivedPill")}</StatusPill>}
      </div>

      <section className="space-y-3" aria-labelledby="customer-master-data">
        <h2 id="customer-master-data" className="m-0 text-lg font-semibold">
          {t("customers.detail.masterData")}
        </h2>
        <dl className="m-0 grid gap-x-6 gap-y-3 text-sm md:grid-cols-2">
          <Field label={t("customers.detail.address")}>
            <p className="m-0">{customer.street}</p>
            <p className="m-0">{`${customer.postal_code} ${customer.city}`}</p>
          </Field>
          <Field label={t("customers.detail.email")}>{customer.email ?? none}</Field>
          <Field label={t("customers.detail.invoiceEmail")}>{customer.invoice_email ?? none}</Field>
          <Field label={t("customers.detail.phone")}>{customer.phone ?? none}</Field>
          <Field label={t("customers.detail.vatId")}>{customer.vat_id ?? none}</Field>
          <Field label={t("customers.detail.paymentTerms")}>
            {t("customers.detail.paymentTermsValue", { count: customer.payment_terms_days })}
          </Field>
          <Field label={t("customers.detail.notes")}>{customer.notes ?? none}</Field>
        </dl>
      </section>

      <section className="space-y-3" aria-labelledby="customer-properties">
        <div className="flex items-center justify-between gap-3">
          <h2 id="customer-properties" className="m-0 text-lg font-semibold">
            {t("customers.detail.properties.title")}
          </h2>
          <Button variant="secondary" size="sm" onClick={() => setAddingProperty(true)}>
            {t("customers.detail.properties.add")}
          </Button>
        </div>
        {properties.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : properties.isError ? (
          <Alert variant="destructive">{t("customers.detail.properties.loadFailed")}</Alert>
        ) : !properties.data?.length ? (
          <p className="m-0 text-sm text-muted-foreground">{t("customers.detail.properties.empty")}</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-border rounded-card border border-border p-0">
            {properties.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <Link to={propertyPath(p.id)} className="font-medium text-foreground hover:underline">
                  {p.name}
                </Link>
                {p.object_no && <span className="text-muted-foreground">{p.object_no}</span>}
                <span className="text-muted-foreground">{`${p.street}, ${p.postal_code} ${p.city}`}</span>
                {p.archived_at && <StatusPill tone="neutral">{t("properties.archivedPill")}</StatusPill>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <DocumentsSection customerId={customer.id} />

      <ContactsSection parent={{ customerId: customer.id }} />

      <CustomerFormDialog open={editing} onOpenChange={setEditing} customer={customer} />
      <PropertyFormDialog open={addingProperty} onOpenChange={setAddingProperty} customerId={customer.id} />
      <DeleteConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t("customers.delete.title")}
        body={t("customers.delete.body", { name })}
        onConfirm={confirmDelete}
        pending={remove.isPending}
      />
    </div>
  );
}
