import { useTranslation } from "react-i18next";
import { StatusPill } from "@/components/ui/status-pill";
import { Metric } from "@/components/ui/metric";
import { formatTimestampLocal } from "@/lib/dates";
import type { Quote } from "../data/quotes";
import { useQuoteAcceptances, useSignatureUrl } from "../hooks/useQuoteHistory";

function SignatureImage({ path, name }: { path: string; name: string }) {
  const { t } = useTranslation("werkbank");
  const { data: url } = useSignatureUrl(path);
  if (!url) return null;
  return <img src={url} alt={t("quotes.history.signature", { name })} className="mt-2 max-h-24 rounded-card border border-border bg-background" />;
}

/** What happened to a sent quote: when it went out and to whom, and each decision of the
 *  customer with name, comment and signature. A draft has no history. */
export function QuoteHistory({ quote }: { quote: Pick<Quote, "id" | "status" | "sent_at" | "sent_to"> }) {
  const { t } = useTranslation("werkbank");
  const isDraft = quote.status === "draft";
  const { data: decisions } = useQuoteAcceptances(quote.id, !isDraft);
  if (isDraft || (!quote.sent_at && !decisions?.length)) return null;

  return (
    <section className="space-y-3" aria-labelledby="quote-history">
      <h2 id="quote-history" className="m-0 text-lg font-semibold">
        {t("quotes.history.title")}
      </h2>
      <ul className="m-0 list-none divide-y divide-border rounded-card border border-border p-0">
        {quote.sent_at && (
          <li className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <StatusPill tone="waiting">{t("quotes.history.sent")}</StatusPill>
              <Metric size="body">{formatTimestampLocal(quote.sent_at)}</Metric>
              {quote.sent_to && quote.sent_to.length > 0 && (
                <span className="text-muted-foreground">{t("quotes.history.sentTo", { recipients: quote.sent_to.join(", ") })}</span>
              )}
            </div>
          </li>
        )}
        {(decisions ?? []).map((d) => (
          <li key={d.id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <StatusPill tone={d.decision === "accepted" ? "confirmed" : "risk"}>
                {d.decision === "accepted" ? t("quotes.history.accepted") : t("quotes.history.rejected")}
              </StatusPill>
              <Metric size="body">{formatTimestampLocal(d.decided_at)}</Metric>
              <span className="text-muted-foreground">{t("quotes.history.by", { name: d.signer_name })}</span>
            </div>
            {d.comment && <p className="m-0 mt-2 whitespace-pre-line">{d.comment}</p>}
            {d.signature_image_path && <SignatureImage path={d.signature_image_path} name={d.signer_name} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
