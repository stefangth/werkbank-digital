import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FileText } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Metric } from "@/components/ui/metric";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Token } from "@/components/ui/token";
import { berlinDateKey, formatDateDMY } from "@/lib/dates";
import { DatePopover } from "../components/DatePopover";
import { DeleteConfirmDialog } from "../components/DeleteConfirmDialog";
import { DocumentTotalsCard } from "../components/DocumentTotalsCard";
import { LineItemsEditor } from "../components/LineItemsEditor";
import { QuoteActions } from "../components/QuoteActions";
import { QuoteHeaderForm } from "../components/QuoteHeaderForm";
import { QuoteHistory } from "../components/QuoteHistory";
import type { QuotePatch } from "../data/quotes";
import { useCustomer } from "../hooks/useCustomers";
import { useOrderIdForQuote, useOrderMutations } from "../hooks/useOrders";
import { useQuote, useQuoteList, useQuoteMutations } from "../hooks/useQuotes";
import { mapDbError } from "../lib/dbErrors";
import { formatQuoteNumber } from "../lib/quoteNumber";
import { QUOTE_STATUS_TONE, quoteDisplayStatus } from "../lib/quoteStatus";
import { QUOTES_PATH, orderPath, quotePath } from "../paths";

/** One quote: header, line items, totals and (once sent) the history. A draft is edited in
 *  place; every other status is read only, with the actions that fit it. */
export function QuotePage() {
  const { t } = useTranslation("werkbank");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: quote, isLoading, isError, refetch } = useQuote(id);
  const { data: list } = useQuoteList();
  const { data: customer } = useCustomer(quote?.customer_id);
  const { update, remove, extend, revokeLink, revise, copy } = useQuoteMutations();
  const { createFromQuote } = useOrderMutations();
  const hasOrder = !!list?.find((q) => q.id === quote?.id)?.has_order;
  const { data: orderId } = useOrderIdForQuote(quote?.id, quote?.status === "accepted" && hasOrder);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Keyed by the quote id: the route reuses this component, so a lock must not carry over to
  // the next quote the user navigates to.
  const [lockedId, setLockedId] = useState<string | null>(null);

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (isError) return <Alert variant="destructive">{t("quotes.page.loadFailed")}</Alert>;
  if (!quote) {
    return (
      <div className="space-y-4">
        <EmptyState icon={FileText} title={t("quotes.page.notFound.title")} reason={t("quotes.page.notFound.reason")} />
        <p className="text-center">
          <Link to={QUOTES_PATH} className="text-sm font-medium text-accent-text hover:underline">
            {t("quotes.page.notFound.back")}
          </Link>
        </p>
      </div>
    );
  }

  const number = formatQuoteNumber(quote.quote_no, quote.version);
  const locked = lockedId === quote.id;
  // An expired quote can only be extended to today or later (Berlin calendar day).
  const today = berlinDateKey(new Date());
  const extendFrom = quote.valid_until > today ? quote.valid_until : today;
  const listRow = list?.find((q) => q.id === quote.id);
  const display = quoteDisplayStatus({ status: quote.status, is_expired: listRow?.is_expired ?? quote.valid_until < today });
  const isDraft = quote.status === "draft";
  const isSent = quote.status === "sent";
  const versions = (list ?? []).filter((q) => q.quote_no === quote.quote_no).sort((a, b) => (a.version ?? 0) - (b.version ?? 0));

  // A save that hits a quote which was sent meanwhile: fetch the real state, so the page turns read only.
  const save = (patch: QuotePatch) =>
    update.mutate(
      { id: quote.id, patch },
      {
        onError: (e) => {
          if (mapDbError(e) === "errors.quoteLocked") {
            setLockedId(quote.id);
            void refetch();
          }
        },
      },
    );

  return (
    <div className="space-y-6">
      <Link to={QUOTES_PATH} className="text-sm font-medium text-accent-text hover:underline">
        {t("quotes.page.back")}
      </Link>
      <PageHeader
        eyebrow={t("quotes.title")}
        title={quote.subject ?? number}
        actions={
          <>
            <QuoteActions quote={quote} />
            {isDraft && (
              <Button variant="destructive" onClick={() => setConfirmingDelete(true)}>
                {t("quotes.page.delete")}
              </Button>
            )}
            {!isDraft && (
              <Button variant="secondary" disabled={copy.isPending} onClick={() => copy.mutate({ id: quote.id }, { onSuccess: (newId) => navigate(quotePath(newId)) })}>
                {t("quotes.page.copy")}
              </Button>
            )}
            {isSent && (
              <>
                <DatePopover value={quote.valid_until} minDate={extendFrom} onSelect={(validUntil) => extend.mutate({ id: quote.id, validUntil })}>
                  <Button variant="secondary">{t("quotes.page.extend")}</Button>
                </DatePopover>
                {!quote.link_revoked_at && (
                  <Button variant="secondary" disabled={revokeLink.isPending} onClick={() => revokeLink.mutate(quote.id)}>
                    {t("quotes.page.revokeLink")}
                  </Button>
                )}
              </>
            )}
            {quote.status === "accepted" && !hasOrder && (
              <Button
                disabled={createFromQuote.isPending}
                onClick={() => createFromQuote.mutate(quote.id, { onSuccess: (newId) => navigate(orderPath(newId)) })}
              >
                {t("quotes.page.createOrder")}
              </Button>
            )}
            {quote.status === "accepted" && hasOrder && orderId && (
              <Button asChild variant="secondary">
                <Link to={orderPath(orderId)}>{t("quotes.page.toOrder")}</Link>
              </Button>
            )}
            {(isSent || quote.status === "rejected") && (
              <Button disabled={revise.isPending} onClick={() => revise.mutate(quote.id, { onSuccess: (newId) => navigate(quotePath(newId)) })}>
                {t("quotes.page.revise")}
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Token className="text-lg">{number}</Token>
        <StatusPill tone={QUOTE_STATUS_TONE[display]}>{t(`quotes.status.${display}`)}</StatusPill>
        {quote.link_revoked_at && <StatusPill tone="risk">{t("quotes.page.linkRevoked")}</StatusPill>}
        {!isDraft && <Metric size="body">{t("quotes.header.validUntil")} {formatDateDMY(quote.valid_until)}</Metric>}
      </div>

      {versions.length > 1 && (
        <nav aria-label={t("quotes.page.versions")} className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">{t("quotes.page.versions")}</span>
          {versions.map((v) =>
            v.id === quote.id ? (
              <span key={v.id} className="font-semibold">{t("quotes.page.version", { count: v.version ?? 1 })}</span>
            ) : (
              <Link key={v.id} to={quotePath(v.id!)} className="font-medium text-accent-text hover:underline">
                {t("quotes.page.version", { count: v.version ?? 1 })}
              </Link>
            ),
          )}
        </nav>
      )}

      {locked && <Alert variant="destructive">{t("errors.quoteLocked")}</Alert>}

      <QuoteHeaderForm
        key={`${quote.id}-${isDraft}`}
        quote={quote}
        readOnly={!isDraft}
        names={{ customer: listRow?.customer_name ?? null, property: listRow?.property_name ?? null }}
        onPatch={save}
      />

      <LineItemsEditor docRef={{ quoteId: quote.id }} readOnly={!isDraft} />
      <DocumentTotalsCard totals={quote.totals} isPrivateCustomer={customer?.kind === "private"} />

      <QuoteHistory quote={quote} />

      <DeleteConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t("quotes.page.deleteTitle")}
        body={t("quotes.page.deleteBody", { number })}
        onConfirm={() => remove.mutate(quote.id, { onSuccess: () => { setConfirmingDelete(false); navigate(QUOTES_PATH); } })}
        pending={remove.isPending}
      />
    </div>
  );
}
