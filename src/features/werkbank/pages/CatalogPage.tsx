import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Wrench } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/AuthContext";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ImportDialog } from "../components/import/ImportDialog";
import { CATALOG_IMPORT_SPEC } from "../data/imports";
import { ArchiveSwitch } from "../components/ArchiveSwitch";
import { CatalogItemFormDialog } from "../components/CatalogItemFormDialog";
import { DeleteConfirmDialog } from "../components/DeleteConfirmDialog";
import type { CatalogItem } from "../data/catalog";
import {
  useArchiveCatalogItem,
  useCatalogItems,
  useDeleteCatalogItem,
} from "../hooks/useCatalog";
import { formatEuro } from "../lib/money";
import { UNIT_CODES, unitLabelKey, type UnitCode } from "../lib/units";

const ALL = "__all__";

const matches = (item: CatalogItem, needle: string) =>
  [item.item_no, item.name, item.description].some((field) => field?.toLowerCase().includes(needle));

/** The org's service and material catalog: search, category filter, archive switch, and
 *  create, edit, archive and (admin only) delete. */
export function CatalogPage() {
  const { t, i18n } = useTranslation("werkbank");
  const { hasRole } = useAuth();
  const canDelete = hasRole("admin");
  const queryClient = useQueryClient();

  const { data: items, isLoading, isError } = useCatalogItems();
  const archive = useArchiveCatalogItem();
  const remove = useDeleteCatalogItem();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL);
  const [showArchived, setShowArchived] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; item: CatalogItem | null }>({ open: false, item: null });
  const [toDelete, setToDelete] = useState<CatalogItem | null>(null);

  const categories = useMemo(
    () =>
      [...new Set((items ?? []).flatMap((i) => (i.category ? [i.category] : [])))].sort((a, b) =>
        a.localeCompare(b, i18n.language),
      ),
    [items, i18n.language],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (items ?? []).filter(
      (i) =>
        (showArchived || !i.archived_at) &&
        (category === ALL || i.category === category) &&
        (!needle || matches(i, needle)),
    );
  }, [items, search, category, showArchived]);

  const openCreate = () => setDialog({ open: true, item: null });
  const money = (amount: number) => formatEuro(amount, i18n.language);
  const unitLabel = (code: string) =>
    (UNIT_CODES as readonly string[]).includes(code) ? t(unitLabelKey(code as UnitCode)) : code;

  const confirmDelete = () => {
    if (!toDelete) return;
    remove.mutate(toDelete.id, { onSuccess: () => setToDelete(null) });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("catalog.title")}
        sub={t("catalog.sub")}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              {t("import.action")}
            </Button>
            <Button onClick={openCreate}>{t("catalog.add")}</Button>
          </div>
        }
      />

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : isError ? (
        <Alert variant="destructive">{t("catalog.loadFailed")}</Alert>
      ) : !items || items.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title={t("catalog.empty.title")}
          body={t("catalog.empty.body")}
          action={{ label: t("catalog.empty.action"), onClick: openCreate }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="search"
              className="w-72"
              aria-label={t("catalog.searchLabel")}
              placeholder={t("catalog.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-[200px]" aria-label={t("catalog.categoryFilter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("catalog.allCategories")}</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ArchiveSwitch checked={showArchived} onCheckedChange={setShowArchived} />
          </div>

          {visible.length === 0 ? (
            <EmptyState size="inline" title={t("catalog.noMatches")} reason={t("catalog.noMatchesReason")} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("catalog.columns.number")}</TableHead>
                  <TableHead>{t("catalog.columns.name")}</TableHead>
                  <TableHead>{t("catalog.columns.category")}</TableHead>
                  <TableHead>{t("catalog.columns.unit")}</TableHead>
                  <TableHead className="text-right">{t("catalog.columns.labour")}</TableHead>
                  <TableHead className="text-right">{t("catalog.columns.material")}</TableHead>
                  <TableHead className="text-right">{t("catalog.columns.net")}</TableHead>
                  <TableHead className="text-right">{t("catalog.columns.vat")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("catalog.columns.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((item) => (
                  <TableRow key={item.id} className={item.archived_at ? "text-muted-foreground" : undefined}>
                    <TableCell>{item.item_no}</TableCell>
                    <TableCell className="font-medium">
                      {item.name}
                      {item.archived_at && (
                        <span className="ml-2">
                          <StatusPill tone="neutral">{t("catalog.archivedPill")}</StatusPill>
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{item.category}</TableCell>
                    <TableCell>{unitLabel(item.unit_code)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(item.labour_price)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(item.material_price)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(item.net_price)}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.vat_rate} %</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setDialog({ open: true, item })}>
                          {t("common.edit")}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={archive.isPending}
                          onClick={() => archive.mutate({ id: item.id, archived: !item.archived_at })}
                        >
                          {item.archived_at ? t("common.restore") : t("common.archive")}
                        </Button>
                        {canDelete && (
                          <Button variant="destructive" size="sm" onClick={() => setToDelete(item)}>
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

      <CatalogItemFormDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        item={dialog.item}
      />
      <DeleteConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
        title={t("catalog.delete.title")}
        body={t("catalog.delete.body", { name: toDelete?.name ?? "" })}
        onConfirm={confirmDelete}
        pending={remove.isPending}
      />
      <ImportDialog
        spec={CATALOG_IMPORT_SPEC}
        open={importOpen}
        onOpenChange={setImportOpen}
        onDone={() => {
          void queryClient.invalidateQueries({ queryKey: ["werkbank", "catalog"] });
        }}
      />
    </div>
  );
}
