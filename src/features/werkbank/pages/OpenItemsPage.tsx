import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Lock, Wallet } from "lucide-react";
import { toast } from "sonner";
import { IconTooltip } from "@/components/common/IconTooltip";
import { PageMini } from "@/components/minis/PageMini";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { KpiTile } from "@/components/ui/kpi-tile";
import { Metric } from "@/components/ui/metric";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Token } from "@/components/ui/token";
import { formatDateDMY } from "@/lib/dates";
import { BulkDunningDialog } from "../components/BulkDunningDialog";
import type { InvoiceBalance } from "../data/invoiceEntries";
import { useIssueDunning } from "../hooks/useDunningActions";
import { useCustomerCredit, useDunningDue, useOpenItems } from "../hooks/useOpenItems";
import { stageKey } from "../lib/stageKey";
import { dueRecipient } from "../lib/dueRecipient";
import { formatEuro } from "../lib/money";
import { paymentStatus } from "../lib/paymentStatus";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { invoicePath } from "../paths";

type View = "open" | "due";
const VIEWS: readonly View[] = ["open", "due"];
const SEARCH_DEBOUNCE_MS = 275;
const sumCents = (rows: Pick<InvoiceBalance, "open_amount">[]) => rows.reduce((s, r) => s + Math.round((r.open_amount ?? 0) * 100), 0) / 100;

/** Everything still open or in credit, and the invoices due their next notice (bulk send). */
export function OpenItemsPage() {
  const { t, i18n } = useTranslation("werkbank");
  const navigate = useNavigate();
  const [view, setView] = useState<View>("open");
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search, SEARCH_DEBOUNCE_MS).trim();
  // Cleared on every search change: the bulk run must never mail a selected row the search hides.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState(false);

  // The tiles always cover everything; the table follows the search.
  const all = useOpenItems({ search: "" });
  const list = useOpenItems({ search: term });
  const dueQuery = useDunningDue();
  const credit = useCustomerCredit();
  const issue = useIssueDunning();

  const money = (n: number) => formatEuro(n, i18n.language);
  const days = (r: Pick<InvoiceBalance, "days_overdue">) => r.days_overdue ?? 0;
  const owing = (all.data ?? []).filter((r) => (r.open_amount ?? 0) > 0);
  const rows = [...(list.data ?? [])].sort((a, b) => days(b) - days(a));
  const due = (dueQuery.data ?? []).filter((r) => !term || `${r.invoice_no} ${r.customer_name} ${r.property_name ?? ""}`.toLowerCase().includes(term.toLowerCase()));
  const pickable = due.filter((r) => dueRecipient(r));
  const chosen = due.filter((r) => r.invoice_id && selected.has(r.invoice_id));
  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  const printOnly = (id: string) =>
    issue.mutateAsync({ invoiceId: id, delivery: "print" })
      .then(() => toast.success(t("openItems.due.printed")))
      .catch(() => toast.error(t("openItems.due.printFailed")));

  const loading = all.isLoading || dueQuery.isLoading;
  const failed = all.isError || list.isError || dueQuery.isError;
  const listLoading = list.isLoading;
  const nothing = !term && (all.data ?? []).length === 0;

  return (
    <div className="space-y-6">
      <PageHeader title={t("openItems.title")} sub={t("openItems.sub")} />
      <PageMini page="openItems" />

      {loading ? (
        <Skeleton className="h-32 w-full" />
      ) : failed ? (
        <Alert variant="destructive">{t("openItems.loadFailed")}</Alert>
      ) : (
        <>
          <div data-testid="open-items-kpis" className="grid gap-3 sm:grid-cols-3">
            <KpiTile label={t("openItems.kpi.open")} value={money(sumCents(owing))} />
            <KpiTile label={t("openItems.kpi.overdue")} value={money(sumCents(owing.filter((r) => days(r) > 0)))} tone={owing.some((r) => days(r) > 0) ? "waiting" : "neutral"} />
            <KpiTile label={t("openItems.kpi.credit")} value={money(credit.data ?? 0)} />
          </div>

          {nothing && (dueQuery.data ?? []).length === 0 ? (
            <EmptyState icon={Wallet} title={t("openItems.empty.title")} body={t("openItems.empty.body")} reason={t("openItems.empty.reason")} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <SegmentedControl<View> value={view} onChange={setView} options={VIEWS.map((v) => ({ value: v, label: t(`openItems.view.${v}`) }))} />
                <Input type="search" className="w-72" aria-label={t("openItems.searchLabel")} placeholder={t("openItems.searchPlaceholder")}
                  value={search} onChange={(e) => { setSearch(e.target.value); setSelected(new Set()); }} />
                {view === "due" && (
                  <Button className="ml-auto" disabled={chosen.length === 0} onClick={() => setBulk(true)}>{t("openItems.due.bulk")}</Button>
                )}
              </div>

              {view === "open" && listLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : view === "open" ? (
                rows.length === 0 ? (
                  <EmptyState size="inline" title={t("openItems.noMatches")} reason={t("openItems.noMatchesReason")} />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("openItems.columns.number")}</TableHead>
                        <TableHead>{t("openItems.columns.customer")}</TableHead>
                        <TableHead>{t("openItems.columns.dueDate")}</TableHead>
                        <TableHead className="text-right">{t("openItems.columns.daysOverdue")}</TableHead>
                        <TableHead className="text-right">{t("openItems.columns.open")}</TableHead>
                        <TableHead>{t("openItems.columns.status")}</TableHead>
                        <TableHead>{t("openItems.columns.stage")}</TableHead>
                        <TableHead><span className="sr-only">{t("openItems.columns.hold")}</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => {
                        const s = paymentStatus(r);
                        return (
                          <TableRow key={r.invoice_id} className="cursor-pointer" onClick={() => navigate(invoicePath(r.invoice_id!))}>
                            <TableCell><Token>{r.invoice_no}</Token></TableCell>
                            <TableCell>
                              <div className="font-medium">{r.customer_name}</div>
                              {r.property_name && <div className="text-muted-foreground">{r.property_name}</div>}
                            </TableCell>
                            <TableCell>{r.due_date && <Metric size="body">{formatDateDMY(r.due_date)}</Metric>}</TableCell>
                            <TableCell className="text-right">{days(r) > 0 && <Metric size="body">{days(r)}</Metric>}</TableCell>
                            <TableCell className="text-right"><Metric size="body">{money(r.open_amount ?? 0)}</Metric></TableCell>
                            <TableCell><StatusPill tone={s.tone}>{t(s.labelKey)}</StatusPill></TableCell>
                            <TableCell>{r.last_stage ? t(stageKey(r.last_stage)) : null}</TableCell>
                            <TableCell>
                              {r.hold_reason && (
                                <IconTooltip label={t("openItems.holdTooltip", { reason: r.hold_reason })}>
                                  <span aria-label={t("openItems.holdTooltip", { reason: r.hold_reason })} className="inline-flex text-muted-foreground"><Lock className="h-4 w-4" /></span>
                                </IconTooltip>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )
              ) : due.length === 0 ? (
                <EmptyState size="inline" title={t("openItems.due.none")} reason={t("openItems.due.noneReason")} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">
                        <Checkbox aria-label={t("openItems.due.selectAll")}
                          checked={pickable.length > 0 && chosen.length === pickable.length}
                          onCheckedChange={(v) => setSelected(v === true ? new Set(pickable.map((r) => r.invoice_id!)) : new Set())} />
                      </TableHead>
                      <TableHead>{t("openItems.columns.number")}</TableHead>
                      <TableHead>{t("openItems.columns.customer")}</TableHead>
                      <TableHead className="text-right">{t("openItems.columns.daysOverdue")}</TableHead>
                      <TableHead className="text-right">{t("openItems.columns.open")}</TableHead>
                      <TableHead>{t("openItems.due.nextStage")}</TableHead>
                      <TableHead><span className="sr-only">{t("openItems.columns.actions")}</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {due.map((r) => {
                      const id = r.invoice_id!;
                      const hasMail = !!dueRecipient(r);
                      return (
                        <TableRow key={id}>
                          <TableCell>
                            <Checkbox aria-label={t("openItems.due.select", { number: r.invoice_no })} disabled={!hasMail}
                              checked={selected.has(id)} onCheckedChange={(v) => toggle(id, v === true)} />
                          </TableCell>
                          <TableCell><Token>{r.invoice_no}</Token></TableCell>
                          <TableCell>
                            <div className="font-medium">{r.customer_name}</div>
                            {r.property_name && <div className="text-muted-foreground">{r.property_name}</div>}
                          </TableCell>
                          <TableCell className="text-right"><Metric size="body">{r.days_overdue ?? 0}</Metric></TableCell>
                          <TableCell className="text-right"><Metric size="body">{money(r.open_amount ?? 0)}</Metric></TableCell>
                          <TableCell>{t(stageKey(r.next_stage))}</TableCell>
                          <TableCell className="text-right">
                            {!hasMail && (
                              <Button variant="secondary" size="sm" disabled={issue.isPending} onClick={() => void printOnly(id)}>{t("openItems.due.print")}</Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </>
      )}

      {bulk && <BulkDunningDialog rows={chosen} onOpenChange={(o) => { if (!o) { setBulk(false); setSelected(new Set()); } }} />}
    </div>
  );
}
