import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, FileText, XCircle } from "lucide-react";
import i18n from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Metric } from "@/components/ui/metric";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Token } from "@/components/ui/token";
import { SignaturePad, type SignatureValue } from "@/components/common/SignaturePad";
import { formatDateDMY } from "@/lib/dates";
import {
  decidePublicQuote, fetchPublicQuote, PublicQuoteError,
  type ClosedState, type PublicQuoteView,
} from "../data/publicQuote";
import { formatEuro } from "../lib/money";

// The page is German only (spec R5): the customer is not a user of the app and has no language setting.
const LOCALE = "de-DE";

type Outcome = { kind: "thanks"; decision: "accepted" | "rejected"; pdfUrl: string | null } | (ClosedState & { fromDecide: boolean });
type TFn = ReturnType<typeof i18n.getFixedT>;

const FORM_ERRORS = new Set(["invalid_signer_name", "invalid_signature", "consent_required"]);

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:py-10">{children}</div>
    </main>
  );
}

function ClosedCard({ outcome, t }: { outcome: ClosedState & { fromDecide?: boolean }; t: TFn }) {
  const key = outcome.reason === "decided" ? `decided_${outcome.decision ?? "accepted"}` : outcome.reason;
  const Icon = outcome.reason === "decided" && outcome.decision === "accepted" ? CheckCircle2 : XCircle;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (outcome.fromDecide) heading.current?.focus(); }, [outcome.fromDecide]);
  return (
    <Card className="space-y-3 p-6 text-center sm:p-8">
      <Icon className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
      <h1 ref={heading} tabIndex={-1} className="font-display text-title font-semibold focus:outline-none">{t(`publicQuote.closed.${key}.title` as never)}</h1>
      <p className="text-body text-muted-foreground">{t(`publicQuote.closed.${key}.body` as never)}</p>
      {outcome.fromDecide && outcome.reason !== "decided" && (
        <Alert><p className="text-control">{t("publicQuote.closed.nothingSigned")}</p></Alert>
      )}
      {outcome.pdfUrl && (
        <a className="inline-block text-control font-medium text-accent-text hover:underline" href={outcome.pdfUrl} target="_blank" rel="noreferrer">
          {t("publicQuote.thanks.pdf")}
        </a>
      )}
    </Card>
  );
}

function Document({ view, t }: { view: PublicQuoteView; t: TFn }) {
  const { quote, seller, totals } = view;
  const euro = (n: number) => formatEuro(n, LOCALE);
  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Eyebrow>{seller.company_name}</Eyebrow>
          <h1 className="font-display text-title font-semibold">
            {t("publicQuote.title")} <Token>{quote.number}</Token>
          </h1>
          <p className="text-body text-muted-foreground">{quote.subject}</p>
        </div>
        {seller.logo_url && <img src={seller.logo_url} alt={seller.company_name} className="max-h-16 max-w-32 object-contain" />}
      </header>

      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Eyebrow>{t("publicQuote.recipient")}</Eyebrow>
          {quote.recipient_lines.map((l, i) => <p key={i} className="text-body">{l}</p>)}
        </div>
        <div className="space-y-1">
          <Eyebrow>{t("publicQuote.metaDate")}</Eyebrow>
          <p className="text-body"><Metric size="body">{formatDateDMY(quote.date)}</Metric></p>
          <Eyebrow>{t("publicQuote.metaValidUntil")}</Eyebrow>
          <p className="text-body"><Metric size="body">{formatDateDMY(quote.valid_until)}</Metric></p>
        </div>
        {quote.location_lines.length > 0 && (
          <div className="space-y-1 sm:col-span-2">
            <Eyebrow>{t("publicQuote.location")}</Eyebrow>
            {quote.location_lines.map((l, i) => <p key={i} className="text-body">{l}</p>)}
          </div>
        )}
      </Card>

      {quote.intro && <p className="whitespace-pre-line text-body">{quote.intro}</p>}

      <section className="space-y-4" aria-label={t("publicQuote.positions")}>
        {view.items.map((section) => (
          <Card key={`${section.number}-${section.title}`} className="p-4">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="font-display text-title-sm font-semibold">{section.number} {section.title}</h2>
              <Metric size="body">{euro(section.subtotal)}</Metric>
            </div>
            <ul className="divide-y divide-border">
              {section.rows.map((row, i) => (
                <li key={i} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-body">
                      {row.kind === "item" && <><Metric size="body" className="text-muted-foreground">{row.number}</Metric>{" "}</>}
                      {row.name}
                    </p>
                    {row.description && <p className="whitespace-pre-line text-control text-muted-foreground">{row.description}</p>}
                    {row.kind === "item" && (
                      <p className="text-control text-muted-foreground">
                        <Metric size="body">
                          {t("publicQuote.quantityTimesPrice", {
                            quantity: new Intl.NumberFormat(LOCALE).format(row.quantity), unit: row.unit, price: euro(row.unitPrice),
                          })}
                        </Metric>
                      </p>
                    )}
                  </div>
                  {row.kind === "item" && <Metric size="body" className="shrink-0">{euro(row.lineNet)}</Metric>}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </section>

      <Card className="space-y-1 p-4 text-body">
        <TotalRow label={t("publicQuote.totals.net")} value={euro(totals.net)} />
        {totals.discountPercent > 0 && (
          <TotalRow label={t("publicQuote.totals.discount", { percent: new Intl.NumberFormat(LOCALE).format(totals.discountPercent) })} value={`-${euro(totals.discount)}`} />
        )}
        {totals.vat.map((v) => (
          <TotalRow key={v.rate} label={t("publicQuote.totals.vat", { rate: v.rate })} value={euro(v.vat)} />
        ))}
        <div className="border-t border-border pt-2 font-semibold">
          <TotalRow label={t("publicQuote.totals.gross")} value={euro(totals.gross)} />
        </div>
        {totals.labour != null && totals.labour > 0 && (
          <TotalRow label={t("publicQuote.totals.labour")} value={euro(totals.labour)} muted />
        )}
      </Card>

      {quote.closing && <p className="whitespace-pre-line text-body">{quote.closing}</p>}
      {quote.payment_terms && (
        <div className="space-y-1">
          <Eyebrow>{t("publicQuote.paymentTerms")}</Eyebrow>
          <p className="whitespace-pre-line text-body">{quote.payment_terms}</p>
        </div>
      )}

      <a className="inline-flex items-center gap-2 text-control font-medium text-accent-text hover:underline" href={view.pdf_url} target="_blank" rel="noreferrer">
        <FileText className="h-4 w-4" aria-hidden />
        {t("publicQuote.pdf")}
      </a>
    </div>
  );
}

function TotalRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <Metric size="body">{value}</Metric>
    </div>
  );
}

function DecideForm({ view, token, t, onOutcome }: { view: PublicQuoteView; token: string; t: TFn; onOutcome: (o: Outcome) => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [name, setName] = useState("");
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [consent, setConsent] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameInvalid = error === "invalid_signer_name";
  const ready = name.trim().length > 0 && (rejecting || (signature !== null && consent));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await decidePublicQuote(
        supabase, token,
        rejecting
          ? { decision: "rejected", signerName: name.trim(), comment: comment.trim() || undefined }
          : { decision: "accepted", signerName: name.trim(), signature: signature as SignatureValue, consent },
      );
      if (result.kind === "done") onOutcome({ kind: "thanks", decision: rejecting ? "rejected" : "accepted", pdfUrl: result.pdfUrl });
      else onOutcome({ ...result, fromDecide: true });
    } catch (e) {
      const code = e instanceof PublicQuoteError ? e.code : "generic";
      setError(FORM_ERRORS.has(code) ? code : "generic");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4 p-4 sm:p-6">
      <h2 className="font-display text-title-sm font-semibold">{t("publicQuote.decide.title")}</h2>
      <div className="space-y-1.5">
        <Label htmlFor="pq-name">{t("publicQuote.decide.name")}</Label>
        <Input
          id="pq-name"
          value={name}
          onChange={(e) => { setName(e.target.value); if (error === "invalid_signer_name") setError(null); }}
          autoComplete="name"
          disabled={busy}
          aria-invalid={nameInvalid || undefined}
          // pq-error is the name field's message only for this error code.
          aria-describedby={nameInvalid ? "pq-error" : undefined}
        />
      </div>
      {rejecting ? (
        <div className="space-y-1.5">
          <Label htmlFor="pq-comment">{t("publicQuote.decide.comment")}</Label>
          <Textarea id="pq-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} disabled={busy} />
          <p className="text-control text-muted-foreground">{t("publicQuote.decide.rejectHint")}</p>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label>{t("publicQuote.decide.signature")}</Label>
            <SignaturePad
              labels={{ type: t("publicQuote.signature.type"), draw: t("publicQuote.signature.draw"), legalName: t("publicQuote.signature.legalName"), clear: t("publicQuote.signature.clear") }}
              value={signature} onChange={setSignature} disabled={busy} />
          </div>
          <div className="flex items-start gap-3">
            <Checkbox id="pq-consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} disabled={busy} />
            <Label htmlFor="pq-consent" className="text-control font-normal leading-snug">{view.consent_text}</Label>
          </div>
        </>
      )}
      {error && <Alert variant="destructive"><p id="pq-error" className="text-control">{t(`publicQuote.errors.${error}` as never)}</p></Alert>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant={rejecting ? "destructive" : "default"}
          disabled={!ready || busy}
          onClick={submit}
          className="sm:flex-1"
        >
          {busy ? t("publicQuote.decide.sending") : rejecting ? t("publicQuote.decide.reject") : t("publicQuote.decide.accept")}
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => { setRejecting(!rejecting); setError(null); }}>
          {rejecting ? t("publicQuote.decide.back") : t("publicQuote.decide.openReject")}
        </Button>
      </div>
    </Card>
  );
}

function ThanksCard({ outcome, t }: { outcome: Extract<Outcome, { kind: "thanks" }>; t: TFn }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <Card className="space-y-3 p-6 text-center sm:p-8">
      <CheckCircle2 className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
      <h1 ref={heading} tabIndex={-1} className="font-display text-title font-semibold focus:outline-none">{t(`publicQuote.thanks.${outcome.decision}.title`)}</h1>
      <p className="text-body text-muted-foreground">{t(`publicQuote.thanks.${outcome.decision}.body`)}</p>
      {outcome.pdfUrl && (
        <a className="inline-block text-control font-medium text-accent-text hover:underline" href={outcome.pdfUrl} target="_blank" rel="noreferrer">
          {t("publicQuote.thanks.pdf")}
        </a>
      )}
    </Card>
  );
}

/** The public, no-login page a customer opens from the quote email. German only, no AppLayout. */
export function QuotePublicPage() {
  const t = useMemo(() => i18n.getFixedT("de", "werkbank"), []);
  const { token = "" } = useParams<{ token: string }>();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["werkbank", "public-quote", token],
    queryFn: () => fetchPublicQuote(supabase, token),
    enabled: token !== "",
    retry: false,
    refetchOnWindowFocus: false,
  });
  const quoteNo = data?.kind === "open" ? data.view.quote.number : null;
  useEffect(() => {
    const previous = document.title;
    document.title = quoteNo ? `${t("publicQuote.title")} ${quoteNo}` : t("publicQuote.title");
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => { document.title = previous; meta.remove(); };
  }, [quoteNo, t]);

  if (outcome?.kind === "thanks") return <Shell><ThanksCard outcome={outcome} t={t} /></Shell>;
  if (outcome) return <Shell><ClosedCard outcome={outcome} t={t} /></Shell>;
  if (token === "") return <Shell><ClosedCard outcome={{ kind: "closed", reason: "not_found" }} t={t} /></Shell>;
  if (isLoading) return <Shell><Skeleton className="h-64 w-full" aria-label={t("publicQuote.loading")} /></Shell>;
  if (isError || !data) return <Shell><Alert variant="destructive"><p className="text-control">{t("publicQuote.loadFailed")}</p></Alert></Shell>;
  if (data.kind === "closed") return <Shell><ClosedCard outcome={data} t={t} /></Shell>;

  return (
    <Shell>
      <Document view={data.view} t={t} />
      <DecideForm view={data.view} token={token} t={t} onOutcome={setOutcome} />
    </Shell>
  );
}
