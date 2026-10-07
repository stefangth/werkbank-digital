import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileText } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Metric } from "@/components/ui/metric";
import { PageHeader } from "@/components/ui/page-header";
import { PageMini } from "@/components/minis/PageMini";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Token } from "@/components/ui/token";
import { formatDateDMY } from "@/lib/dates";
import { CustomerPicker } from "../components/CustomerPicker";
import type { QuoteListRow } from "../data/quotes";
import { useCompanyProfile } from "../hooks/useCompanyProfile";
import { useQuoteList, useQuoteMutations } from "../hooks/useQuotes";
import { formatEuro } from "../lib/money";
import { formatQuoteNumber } from "../lib/quoteNumber";
import { QUOTE_DISPLAY_STATUSES, QUOTE_STATUS_TONE, isAcceptedWithoutOrder, quoteDisplayStatus } from "../lib/quoteStatus";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { quotePath } from "../paths";

const ALL = "__all__";
const SEARCH_DEBOUNCE_MS = 275;

const numberOf = (q: QuoteListRow) => formatQuoteNumber(q.quote_no ?? "", q.version ?? 1);
const matches = (q: QuoteListRow, needle: string) =>
  [numberOf(q), q.customer_name, q.subject].some((field) => field?.toLowerCase().includes(needle));

function NewQuoteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation("werkbank");
  const navigate = useNavigate();
  const profile = useCompanyProfile();
  const { create } = useQuoteMutations();
  const [customerId, setCustomerId] = useState("");

  const submit = () =>
    create.mutate(
      { draft: { customer_id: customerId }, profile: profile.data ?? null },
      {
        onSuccess: (id) => {
          onOpenChange(false);
          setCustomerId("");
          navigate(quotePath(id));
        },
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("quotes.new.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="new-quote-customer">{t("quotes.new.customer")}</Label>
          <CustomerPicker id="new-quote-customer" value={customerId} onChange={setCustomerId} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!customerId || profile.isLoading || create.isPending} onClick={submit}>
            {t("quotes.new.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The org's quotes: search, status filter (expired is derived), a notice for accepted quotes
 *  that still need an order, and create. A row opens the quote. */
export function QuotesPage() {
  const { t, i18n } = useTranslation("werkbank");
  const navigate = useNavigate();
  const { data: quotes, isLoading, isError } = useQuoteList();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  // The dashboard links here with ?status=accepted&noOrder=1; an unknown status is ignored.
  const [params] = useSearchParams();
  const urlStatus = params.get("status");
  const urlNoOrder = params.get("noOrder") === "1";
  const statusFromUrl = urlStatus && (QUOTE_DISPLAY_STATUSES as readonly string[]).includes(urlStatus) ? urlStatus : ALL;
  const [status, setStatus] = useState(statusFromUrl);
  const [noOrderOnly, setNoOrderOnly] = useState(urlNoOrder);
  // The page stays mounted when another dashboard link changes the params: apply them again
  // (adjusting state while rendering).
  const urlKey = `${statusFromUrl}|${urlNoOrder}`;
  const [appliedUrlKey, setAppliedUrlKey] = useState(urlKey);
  if (urlKey !== appliedUrlKey) {
    setAppliedUrlKey(urlKey);
    setStatus(statusFromUrl);
    setNoOrderOnly(urlNoOrder);
  }
  const [creating, setCreating] = useState(false);

  const visible = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase();
    return (quotes ?? []).filter(
      (q) =>
        (status === ALL || quoteDisplayStatus(q) === status) &&
        (!noOrderOnly || isAcceptedWithoutOrder(q)) &&
        (!needle || matches(q, needle)),
    );
  }, [quotes, debouncedSearch, status, noOrderOnly]);

  const acceptedNoOrder = (quotes ?? []).filter(isAcceptedWithoutOrder).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("quotes.title")}
        sub={t("quotes.sub")}
        actions={<Button onClick={() => setCreating(true)}>{t("quotes.add")}</Button>}
      />

      <PageMini page="quotes" />

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : isError ? (
        <Alert variant="destructive">{t("quotes.loadFailed")}</Alert>
      ) : !quotes || quotes.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t("quotes.empty.title")}
          body={t("quotes.empty.body")}
          action={{ label: t("quotes.empty.action"), onClick: () => setCreating(true) }}
        />
      ) : (
        <>
          {acceptedNoOrder > 0 && (
            <div className="flex items-center gap-3 rounded-card border border-border px-4 py-3 text-sm">
              <p className="m-0 flex items-center gap-2">
                <span>{t("quotes.notice.acceptedNoOrder")}</span>
                <Metric size="body">{acceptedNoOrder}</Metric>
              </p>
              <Button variant="secondary" size="sm" onClick={() => { setNoOrderOnly(true); setStatus("accepted"); }}>
                {t("quotes.notice.show")}
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="search"
              className="w-72"
              aria-label={t("quotes.searchLabel")}
              placeholder={t("quotes.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select value={status} onValueChange={(v) => { setNoOrderOnly(false); setStatus(v); }}>
              <SelectTrigger className="w-[200px]" aria-label={t("quotes.statusFilter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("quotes.allStatuses")}</SelectItem>
                {QUOTE_DISPLAY_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`quotes.status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant={noOrderOnly ? "default" : "secondary"} aria-pressed={noOrderOnly} onClick={() => setNoOrderOnly((on) => !on)}>
              {t("quotes.noOrderFilter")}
            </Button>
          </div>

          {visible.length === 0 ? (
            <EmptyState size="inline" title={t("quotes.noMatches")} reason={t("quotes.noMatchesReason")} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("quotes.columns.number")}</TableHead>
                  <TableHead>{t("quotes.columns.customer")}</TableHead>
                  <TableHead>{t("quotes.columns.subject")}</TableHead>
                  <TableHead>{t("quotes.columns.status")}</TableHead>
                  <TableHead>{t("quotes.columns.validUntil")}</TableHead>
                  <TableHead className="text-right">{t("quotes.columns.net")}</TableHead>
                  <TableHead className="text-right">{t("quotes.columns.gross")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((q) => {
                  const display = quoteDisplayStatus(q);
                  return (
                    <TableRow key={q.id} className="cursor-pointer" onClick={() => navigate(quotePath(q.id!))}>
                      <TableCell>
                        <Token>{numberOf(q)}</Token>
                      </TableCell>
                      <TableCell className="font-medium">{q.customer_name}</TableCell>
                      <TableCell>{q.subject}</TableCell>
                      <TableCell>
                        <StatusPill tone={QUOTE_STATUS_TONE[display]}>{t(`quotes.status.${display}`)}</StatusPill>
                      </TableCell>
                      <TableCell>{q.valid_until && <Metric size="body">{formatDateDMY(q.valid_until)}</Metric>}</TableCell>
                      <TableCell className="text-right">
                        <Metric size="body">{formatEuro(q.net_total ?? 0, i18n.language)}</Metric>
                      </TableCell>
                      <TableCell className="text-right">
                        <Metric size="body">{formatEuro(q.gross_total ?? 0, i18n.language)}</Metric>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </>
      )}

      <NewQuoteDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
