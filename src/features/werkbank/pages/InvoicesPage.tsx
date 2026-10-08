import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Receipt } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Metric } from "@/components/ui/metric";
import { PageHeader } from "@/components/ui/page-header";
import { PageMini } from "@/components/minis/PageMini";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Token } from "@/components/ui/token";
import { cn } from "@/lib/utils";
import { formatDateDMY } from "@/lib/dates";
import { CustomerPicker } from "../components/CustomerPicker";
import { PropertyPicker } from "../components/PropertyPicker";
import type { InvoiceFilter } from "../data/invoices";
import { useCompanyProfile } from "../hooks/useCompanyProfile";
import { useInvoiceMutations, useInvoices } from "../hooks/useInvoices";
import { useOrderList } from "../hooks/useOrders";
import { INVOICE_STATUS_TONES, signedGross, type InvoiceStatus } from "../lib/invoiceStatus";
import { formatEuro } from "../lib/money";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { ORDERS_PATH, invoicePath } from "../paths";

const SEARCH_DEBOUNCE_MS = 275;
const FILTERS: readonly InvoiceFilter[] = ["all", "draft", "issued", "cancelled"];

function NewInvoiceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation("werkbank");
  const navigate = useNavigate();
  const profile = useCompanyProfile();
  const { create } = useInvoiceMutations();
  const [customerId, setCustomerId] = useState("");
  const [propertyId, setPropertyId] = useState("");

  const submit = () =>
    create.mutate(
      { customerId, propertyId: propertyId || null, profile: profile.data ?? null },
      {
        onSuccess: (id) => {
          onOpenChange(false);
          setCustomerId("");
          setPropertyId("");
          navigate(invoicePath(id));
        },
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("invoices.new.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="new-invoice-customer">{t("invoices.new.customer")}</Label>
          <CustomerPicker id="new-invoice-customer" value={customerId} onChange={(id) => { setCustomerId(id); setPropertyId(""); }} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-invoice-property">{t("invoices.new.property")}</Label>
          <PropertyPicker id="new-invoice-property" customerId={customerId} value={propertyId} onChange={setPropertyId} disabled={!customerId} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!customerId || profile.isLoading || create.isPending} onClick={submit}>
            {t("invoices.new.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The org's invoices and cancellations: status filter, debounced search, a notice for done
 *  orders still to be invoiced, and a free invoice. A row opens the invoice. */
export function InvoicesPage() {
  const { t, i18n } = useTranslation("werkbank");
  const navigate = useNavigate();
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  const [creating, setCreating] = useState(false);

  const searchTerm = debouncedSearch.trim();
  const { data: invoices, isLoading, isError } = useInvoices({ filter, search: searchTerm });
  const { data: orders } = useOrderList();

  // Every done order is still to be invoiced: issuing an invoice moves it to invoiced.
  // Hidden until the order list has loaded.
  const notInvoiced = (orders ?? []).filter((o) => o.status === "done").length;

  const money = (n: number) => formatEuro(n, i18n.language);
  const none = filter === "all" && !searchTerm && (invoices ?? []).length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("invoices.title")}
        sub={t("invoices.sub")}
        actions={<Button onClick={() => setCreating(true)}>{t("invoices.add")}</Button>}
      />

      <PageMini page="invoices" />

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : isError ? (
        <Alert variant="destructive">{t("invoices.loadFailed")}</Alert>
      ) : none ? (
        <EmptyState
          icon={Receipt}
          title={t("invoices.empty.title")}
          body={t("invoices.empty.body")}
          action={{ label: t("invoices.empty.action"), onClick: () => setCreating(true) }}
        />
      ) : (
        <>
          {notInvoiced > 0 && (
            <div className="flex items-center gap-3 rounded-card border border-border px-4 py-3 text-sm">
              <p className="m-0 flex items-center gap-2">
                <span>{t("invoices.notice.doneNotInvoiced")}</span>
                <Metric size="body">{notInvoiced}</Metric>
              </p>
              <Link to={`${ORDERS_PATH}?status=done`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
                {t("invoices.notice.show")}
              </Link>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl<InvoiceFilter>
              value={filter}
              onChange={setFilter}
              options={FILTERS.map((f) => ({ value: f, label: t(`invoices.filter.${f}`) }))}
            />
            <Input
              type="search"
              className="w-72"
              aria-label={t("invoices.searchLabel")}
              placeholder={t("invoices.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {(invoices ?? []).length === 0 ? (
            <EmptyState size="inline" title={t("invoices.noMatches")} reason={t("invoices.noMatchesReason")} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("invoices.columns.number")}</TableHead>
                  <TableHead>{t("invoices.columns.customer")}</TableHead>
                  <TableHead>{t("invoices.columns.subject")}</TableHead>
                  <TableHead>{t("invoices.columns.issueDate")}</TableHead>
                  <TableHead>{t("invoices.columns.dueDate")}</TableHead>
                  <TableHead className="text-right">{t("invoices.columns.gross")}</TableHead>
                  <TableHead>{t("invoices.columns.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(invoices ?? []).map((i) => {
                  const status = (i.status ?? "draft") as InvoiceStatus;
                  return (
                    <TableRow key={i.id} className="cursor-pointer" onClick={() => navigate(invoicePath(i.id!))}>
                      <TableCell>{i.invoice_no ? <Token>{i.invoice_no}</Token> : t("invoices.draftNumber")}</TableCell>
                      <TableCell>
                        <div className="font-medium">{i.customer_name}</div>
                        {i.property_name && <div className="text-muted-foreground">{i.property_name}</div>}
                      </TableCell>
                      <TableCell>{i.subject}</TableCell>
                      <TableCell>{i.issue_date && <Metric size="body">{formatDateDMY(i.issue_date)}</Metric>}</TableCell>
                      <TableCell>{i.due_date && <Metric size="body">{formatDateDMY(i.due_date)}</Metric>}</TableCell>
                      <TableCell className="text-right">
                        <Metric size="body">{money(signedGross(i))}</Metric>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {i.type === "cancellation" && <StatusPill tone="risk">{t("invoices.type.cancellation")}</StatusPill>}
                          <StatusPill tone={INVOICE_STATUS_TONES[status]}>{t(`invoices.status.${status}`)}</StatusPill>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </>
      )}

      <NewInvoiceDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

