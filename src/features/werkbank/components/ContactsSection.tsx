import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import type { Contact, ContactParent } from "../data/contacts";
import { useContacts, useDeleteContact } from "../hooks/useContacts";
import { ContactFormDialog } from "./ContactFormDialog";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";

const fullName = (c: Contact) => [c.first_name, c.last_name].filter(Boolean).join(" ");

/** The contacts of a customer or a property: primary first (the query orders them), with
 *  create, edit and delete (after a confirmation). Shared by both detail pages. */
export function ContactsSection({ parent }: { parent: ContactParent }) {
  const { t } = useTranslation("werkbank");
  const { data: contacts, isLoading, isError } = useContacts(parent);
  const remove = useDeleteContact();
  const [dialog, setDialog] = useState<{ open: boolean; contact: Contact | null }>({ open: false, contact: null });
  const [toDelete, setToDelete] = useState<Contact | null>(null);

  const confirmDelete = () => {
    if (!toDelete) return;
    remove.mutate(toDelete.id, { onSuccess: () => setToDelete(null) });
  };

  return (
    <section className="space-y-3" aria-labelledby="contacts-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="contacts-heading" className="m-0 text-lg font-semibold">
          {t("contacts.title")}
        </h2>
        <Button variant="secondary" size="sm" onClick={() => setDialog({ open: true, contact: null })}>
          {t("contacts.add")}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : isError ? (
        <Alert variant="destructive">{t("contacts.loadFailed")}</Alert>
      ) : !contacts || contacts.length === 0 ? (
        <EmptyState size="inline" title={t("contacts.empty")} action={{ label: t("contacts.add"), onClick: () => setDialog({ open: true, contact: null }) }} />
      ) : (
        <ul className="m-0 list-none divide-y divide-border rounded-card border border-border p-0">
          {contacts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
              <div className="min-w-0 space-y-0.5 text-sm">
                <div className="m-0 font-medium">
                  {fullName(c)}
                  {c.is_primary && (
                    <span className="ml-2">
                      <StatusPill tone="accent">{t("contacts.primaryBadge")}</StatusPill>
                    </span>
                  )}
                </div>
                {c.role && <p className="m-0 text-muted-foreground">{c.role}</p>}
                {[c.phone, c.mobile, c.email].filter(Boolean).map((v, i) => (
                  <p key={i} className="m-0">{v}</p>
                ))}
                {c.notes && <p className="m-0 text-muted-foreground">{c.notes}</p>}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setDialog({ open: true, contact: c })}>
                  {t("common.edit")}
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setToDelete(c)}>
                  {t("common.delete")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ContactFormDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        parent={parent}
        contact={dialog.contact}
      />
      <DeleteConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
        title={t("contacts.delete.title")}
        body={t("contacts.delete.body", { name: toDelete ? fullName(toDelete) : "" })}
        onConfirm={confirmDelete}
        pending={remove.isPending}
      />
    </section>
  );
}
