import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Building2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/AuthContext";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageMini } from "@/components/minis/PageMini";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ImportDialog } from "../components/import/ImportDialog";
import { CUSTOMER_IMPORT_SPEC } from "../data/imports";
import { ArchiveSwitch } from "../components/ArchiveSwitch";
import { CustomerFormDialog } from "../components/CustomerFormDialog";
import { DeleteConfirmDialog } from "../components/DeleteConfirmDialog";
import type { CustomerListRow } from "../data/customers";
import { useArchiveCustomer, useCustomers, useDeleteCustomer } from "../hooks/useCustomers";
import { customerDisplayName } from "../lib/displayName";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { customerPath } from "../paths";

const ALL = "__all__";
const SEARCH_DEBOUNCE_MS = 275;

const matches = (c: CustomerListRow, needle: string) =>
  [customerDisplayName(c), c.customer_no, c.city, c.email].some((field) => field?.toLowerCase().includes(needle));

/** The org's customers: search, kind filter, archive switch, and create, edit, archive and
 *  (admin only) delete. A row opens the customer. */
export function CustomersPage() {
  const { t } = useTranslation("werkbank");
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const canDelete = hasRole("admin");
  const queryClient = useQueryClient();

  const { data: customers, isLoading, isError } = useCustomers();
  const archive = useArchiveCustomer();
  const remove = useDeleteCustomer();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  const [kind, setKind] = useState(ALL);
  const [showArchived, setShowArchived] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; customer: CustomerListRow | null }>({
    open: false,
    customer: null,
  });
  const [toDelete, setToDelete] = useState<CustomerListRow | null>(null);

  const visible = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase();
    return (customers ?? []).filter(
      (c) => (showArchived || !c.archived_at) && (kind === ALL || c.kind === kind) && (!needle || matches(c, needle)),
    );
  }, [customers, debouncedSearch, kind, showArchived]);

  const openCreate = () => setDialog({ open: true, customer: null });

  const confirmDelete = () => {
    if (!toDelete) return;
    remove.mutate(toDelete.id, { onSuccess: () => setToDelete(null) });
  };

  // The row opens the customer; the buttons inside it must not.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("customers.title")}
        sub={t("customers.sub")}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              {t("import.action")}
            </Button>
            <Button onClick={openCreate}>{t("customers.add")}</Button>
          </div>
        }
      />

      <PageMini page="customers" />

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : isError ? (
        <Alert variant="destructive">{t("customers.loadFailed")}</Alert>
      ) : !customers || customers.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={t("customers.empty.title")}
          body={t("customers.empty.body")}
          action={{ label: t("customers.empty.action"), onClick: openCreate }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="search"
              className="w-72"
              aria-label={t("customers.searchLabel")}
              placeholder={t("customers.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="w-[200px]" aria-label={t("customers.kindFilter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("customers.allKinds")}</SelectItem>
                <SelectItem value="property_manager">{t("kind.property_manager")}</SelectItem>
                <SelectItem value="private">{t("kind.private")}</SelectItem>
              </SelectContent>
            </Select>
            <ArchiveSwitch checked={showArchived} onCheckedChange={setShowArchived} />
          </div>

          {visible.length === 0 ? (
            <EmptyState size="inline" title={t("customers.noMatches")} reason={t("customers.noMatchesReason")} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("customers.columns.number")}</TableHead>
                  <TableHead>{t("customers.columns.name")}</TableHead>
                  <TableHead>{t("customers.columns.kind")}</TableHead>
                  <TableHead>{t("customers.columns.city")}</TableHead>
                  <TableHead className="text-right">{t("customers.columns.properties")}</TableHead>
                  <TableHead>{t("customers.columns.phone")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("customers.columns.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((c) => (
                  <TableRow
                    key={c.id}
                    className={`cursor-pointer ${c.archived_at ? "text-muted-foreground" : ""}`}
                    onClick={() => navigate(customerPath(c.id))}
                  >
                    <TableCell>{c.customer_no}</TableCell>
                    <TableCell className="font-medium">
                      {customerDisplayName(c)}
                      {c.archived_at && (
                        <span className="ml-2">
                          <StatusPill tone="neutral">{t("customers.archivedPill")}</StatusPill>
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={c.kind === "property_manager" ? "accent" : "neutral"}>
                        {t(`kind.${c.kind}`)}
                      </StatusPill>
                    </TableCell>
                    <TableCell>{c.city}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.property_count}</TableCell>
                    <TableCell>{c.phone}</TableCell>
                    <TableCell onClick={stop}>
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setDialog({ open: true, customer: c })}>
                          {t("common.edit")}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={archive.isPending}
                          onClick={() => archive.mutate({ id: c.id, archived: !c.archived_at })}
                        >
                          {c.archived_at ? t("common.restore") : t("common.archive")}
                        </Button>
                        {canDelete && (
                          <Button variant="destructive" size="sm" onClick={() => setToDelete(c)}>
                            {t("common.delete")}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}

      <CustomerFormDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        customer={dialog.customer}
      />
      <DeleteConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
        title={t("customers.delete.title")}
        body={t("customers.delete.body", { name: toDelete ? customerDisplayName(toDelete) : "" })}
        onConfirm={confirmDelete}
        pending={remove.isPending}
      />
      <ImportDialog
        spec={CUSTOMER_IMPORT_SPEC}
        open={importOpen}
        onOpenChange={setImportOpen}
        onDone={() => {
          void queryClient.invalidateQueries({ queryKey: ["werkbank", "customers"] });
        }}
      />
    </div>
  );
}
