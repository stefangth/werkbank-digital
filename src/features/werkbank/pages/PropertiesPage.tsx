import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Home } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/AuthContext";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ImportDialog } from "../components/import/ImportDialog";
import { PROPERTY_IMPORT_SPEC } from "../data/imports";
import { ArchiveSwitch } from "../components/ArchiveSwitch";
import { DeleteConfirmDialog } from "../components/DeleteConfirmDialog";
import { PropertyFormDialog } from "../components/PropertyFormDialog";
import type { PropertyListRow } from "../data/properties";
import { useArchiveProperty, useDeleteProperty, useProperties } from "../hooks/useProperties";
import { customerDisplayName } from "../lib/displayName";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { propertyPath } from "../paths";

const SEARCH_DEBOUNCE_MS = 275;

const matches = (p: PropertyListRow, needle: string) =>
  [p.name, p.object_no, p.street, p.postal_code, p.city, customerDisplayName(p.customer)].some((field) =>
    field?.toLowerCase().includes(needle),
  );

/** The org's properties: search, archive switch, and create, edit, archive and (admin only)
 *  delete. The name links to the property; a click on the row does too. */
export function PropertiesPage() {
  const { t } = useTranslation("werkbank");
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const canDelete = hasRole("admin");
  const queryClient = useQueryClient();

  const { data: properties, isLoading, isError } = useProperties();
  const archive = useArchiveProperty();
  const remove = useDeleteProperty();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  const [showArchived, setShowArchived] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; property: PropertyListRow | null }>({
    open: false,
    property: null,
  });
  const [toDelete, setToDelete] = useState<PropertyListRow | null>(null);

  const visible = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase();
    return (properties ?? []).filter((p) => (showArchived || !p.archived_at) && (!needle || matches(p, needle)));
  }, [properties, debouncedSearch, showArchived]);

  const openCreate = () => setDialog({ open: true, property: null });

  const confirmDelete = () => {
    if (!toDelete) return;
    remove.mutate(toDelete.id, { onSuccess: () => setToDelete(null) });
  };

  // The row opens the property; the link and buttons inside it handle themselves.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("properties.title")}
        sub={t("properties.sub")}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              {t("import.action")}
            </Button>
            <Button onClick={openCreate}>{t("properties.add")}</Button>
          </div>
        }
      />

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : isError ? (
        <Alert variant="destructive">{t("properties.loadFailed")}</Alert>
      ) : !properties || properties.length === 0 ? (
        <EmptyState
          icon={Home}
          title={t("properties.empty.title")}
          body={t("properties.empty.body")}
          action={{ label: t("properties.empty.action"), onClick: openCreate }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="search"
              className="w-72"
              aria-label={t("properties.searchLabel")}
              placeholder={t("properties.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <ArchiveSwitch checked={showArchived} onCheckedChange={setShowArchived} />
          </div>

          {visible.length === 0 ? (
            <EmptyState size="inline" title={t("properties.noMatches")} reason={t("properties.noMatchesReason")} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("properties.columns.name")}</TableHead>
                  <TableHead>{t("properties.columns.objectNo")}</TableHead>
                  <TableHead>{t("properties.columns.address")}</TableHead>
                  <TableHead>{t("properties.columns.customer")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("properties.columns.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((p) => (
                  <TableRow
                    key={p.id}
                    className={`cursor-pointer ${p.archived_at ? "text-muted-foreground" : ""}`}
                    onClick={() => navigate(propertyPath(p.id))}
                  >
                    <TableCell className="font-medium">
                      <Link to={propertyPath(p.id)} onClick={stop} className="hover:underline">
                        {p.name}
                      </Link>
                      {p.archived_at && (
                        <span className="ml-2">
                          <StatusPill tone="neutral">{t("properties.archivedPill")}</StatusPill>
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{p.object_no}</TableCell>
                    <TableCell>{`${p.street}, ${p.postal_code} ${p.city}`}</TableCell>
                    <TableCell>{customerDisplayName(p.customer)}</TableCell>
                    <TableCell onClick={stop}>
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setDialog({ open: true, property: p })}>
                          {t("common.edit")}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={archive.isPending}
                          onClick={() => archive.mutate({ id: p.id, archived: !p.archived_at })}
                        >
                          {p.archived_at ? t("common.restore") : t("common.archive")}
                        </Button>
                        {canDelete && (
                          <Button variant="destructive" size="sm" onClick={() => setToDelete(p)}>
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

      <PropertyFormDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        property={dialog.property}
      />
      <DeleteConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
        title={t("properties.delete.title")}
        body={t("properties.delete.body", { name: toDelete?.name ?? "" })}
        onConfirm={confirmDelete}
        pending={remove.isPending}
      />
      <ImportDialog
        spec={PROPERTY_IMPORT_SPEC}
        open={importOpen}
        onOpenChange={setImportOpen}
        onDone={() => {
          void queryClient.invalidateQueries({ queryKey: ["werkbank", "properties"] });
          void queryClient.invalidateQueries({ queryKey: ["werkbank", "customers"] });
        }}
      />
    </div>
  );
}
