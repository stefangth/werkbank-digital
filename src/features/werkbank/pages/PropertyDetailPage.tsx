import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Home } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { ContactsSection } from "../components/ContactsSection";
import { DocumentsSection } from "../components/DocumentsSection";
import { DeleteConfirmDialog } from "../components/DeleteConfirmDialog";
import { PropertyFormDialog } from "../components/PropertyFormDialog";
import { useCustomer } from "../hooks/useCustomers";
import { useArchiveProperty, useDeleteProperty, useProperty } from "../hooks/useProperties";
import { customerDisplayName } from "../lib/displayName";
import { customerPath, PROPERTIES_PATH } from "../paths";

function Address({ street, postal, city }: { street: string; postal: string; city: string }) {
  return (
    <>
      <p className="m-0">{street}</p>
      <p className="m-0">{`${postal} ${city}`}</p>
    </>
  );
}

function Note({ label, value }: { label: string; value: string | null }) {
  const { t } = useTranslation("werkbank");
  return (
    <div>
      <h3 className="m-0 text-sm font-semibold">{label}</h3>
      <p className="m-0 mt-1 whitespace-pre-line text-sm text-muted-foreground">{value || t("properties.detail.none")}</p>
    </div>
  );
}

/** One property: address, who the invoice goes to, access notes, notes and on-site contacts. */
export function PropertyDetailPage() {
  const { t } = useTranslation("werkbank");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const canDelete = hasRole("admin");

  const { data: property, isLoading, isError } = useProperty(id);
  // The list embed has no customer address; the billing box needs it when nobody else is billed.
  const { data: customer } = useCustomer(property?.customer_id);
  const archive = useArchiveProperty();
  const remove = useDeleteProperty();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (isError) return <Alert variant="destructive">{t("properties.detail.loadFailed")}</Alert>;
  if (!property) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={Home}
          title={t("properties.detail.notFound.title")}
          reason={t("properties.detail.notFound.reason")}
        />
        <p className="text-center">
          <Link to={PROPERTIES_PATH} className="text-sm font-medium text-accent-text hover:underline">
            {t("properties.detail.notFound.back")}
          </Link>
        </p>
      </div>
    );
  }

  const customerName = customerDisplayName(property.customer);
  const billingSet = property.billing_name !== null;

  const confirmDelete = () =>
    remove.mutate(property.id, {
      onSuccess: () => {
        setConfirmingDelete(false);
        navigate(PROPERTIES_PATH);
      },
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title={property.name}
        sub={property.object_no ?? undefined}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t("common.edit")}
            </Button>
            <Button
              variant="secondary"
              disabled={archive.isPending}
              onClick={() => archive.mutate({ id: property.id, archived: !property.archived_at })}
            >
              {property.archived_at ? t("common.restore") : t("common.archive")}
            </Button>
            {canDelete && (
              <Button variant="destructive" onClick={() => setConfirmingDelete(true)}>
                {t("common.delete")}
              </Button>
            )}
          </>
        }
      />
      {property.archived_at && <StatusPill tone="neutral">{t("properties.archivedPill")}</StatusPill>}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="space-y-1 text-sm" aria-labelledby="property-address">
          <h2 id="property-address" className="m-0 mb-2 text-lg font-semibold">
            {t("properties.detail.address")}
          </h2>
          <Address street={property.street} postal={property.postal_code} city={property.city} />
          <p className="m-0 pt-2 text-muted-foreground">
            {t("properties.detail.customer")}:{" "}
            <Link to={customerPath(property.customer_id)} className="font-medium text-foreground hover:underline">
              {customerName}
            </Link>
          </p>
        </section>

        <section
          className="space-y-1 rounded-card border border-border p-4 text-sm"
          aria-labelledby="property-billing"
        >
          <h2 id="property-billing" className="m-0 mb-2 text-lg font-semibold">
            {t("properties.detail.billingTitle")}
          </h2>
          {billingSet ? (
            <>
              <p className="m-0 font-medium">
                {t("properties.detail.billingRepresented", { billingName: property.billing_name, customer: customerName })}
              </p>
              <Address
                street={property.billing_street ?? ""}
                postal={property.billing_postal_code ?? ""}
                city={property.billing_city ?? ""}
              />
            </>
          ) : (
            <>
              <p className="m-0 font-medium">{customerName}</p>
              {customer && <Address street={customer.street} postal={customer.postal_code} city={customer.city} />}
            </>
          )}
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Note label={t("properties.detail.accessNotes")} value={property.access_notes} />
        <Note label={t("properties.detail.notes")} value={property.notes} />
      </div>

      <DocumentsSection customerId={property.customer_id} propertyId={property.id} />

      <ContactsSection parent={{ propertyId: property.id }} />

      <PropertyFormDialog open={editing} onOpenChange={setEditing} property={property} />
      <DeleteConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t("properties.delete.title")}
        body={t("properties.delete.body", { name: property.name })}
        onConfirm={confirmDelete}
        pending={remove.isPending}
      />
    </div>
  );
}
