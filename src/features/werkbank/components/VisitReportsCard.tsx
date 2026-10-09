import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Label } from "@/components/ui/label";
import { Metric } from "@/components/ui/metric";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { formatDateWithWeekday, formatTimestampLocal } from "@/lib/dates";
import { type VisitReport, visitReportPdfErrorKey } from "../data/visitReports";
import { useVisitObjectUrls } from "../hooks/useAssignments";
import { useUpdateOfficeNote, useVisitReportPdf, useVisitReports } from "../hooks/useVisitReports";
import { openPendingTab, showInTab } from "../lib/pdfTab";

type ReportState = "open" | "locked" | "signed";
const reportState = (r: VisitReport): ReportState => (r.signed_at ? "signed" : r.locked_at ? "locked" : "open");
const STATE_TONE = { open: "waiting", locked: "neutral", signed: "confirmed" } as const;

/** The internal note of one report: saved on leaving the field, only when it changed. */
function OfficeNote({ report }: { report: VisitReport }) {
  const { t } = useTranslation("werkbank");
  const update = useUpdateOfficeNote();
  const saved = report.office_note ?? "";
  const [value, setValue] = useState(saved);
  const id = `office-note-${report.id}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t("orders.reports.officeNote")}</Label>
      <Textarea
        id={id} rows={2} value={value} onChange={(e) => setValue(e.target.value)}
        onBlur={() => { if (value !== saved) update.mutate({ reportId: report.id, note: value.trim() === "" ? null : value }); }}
      />
    </div>
  );
}

function ReportItem({ report, onOpenPhoto }: { report: VisitReport; onOpenPhoto: (url: string, alt: string) => void }) {
  const { t } = useTranslation("werkbank");
  const state = reportState(report);
  const paths = [...report.photos.map((p) => p.path), ...(report.signature_path ? [report.signature_path] : [])];
  const urls = useVisitObjectUrls(paths).data ?? {};
  const date = <Metric size="body">{null}</Metric>;
  const signature = report.signature_path ? urls[report.signature_path] : undefined;
  return (
    <li className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <Metric size="body">{formatDateWithWeekday(report.visit_date)}</Metric>
        <span className="text-muted-foreground">{report.technician_name}</span>
        <StatusPill tone={STATE_TONE[state]}>{t(`orders.reports.state.${state}`)}</StatusPill>
      </div>
      <p className="m-0 whitespace-pre-wrap text-body">{report.body.trim() ? report.body : t("app.report.noText")}</p>
      {report.photos.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0 sm:grid-cols-5">
          {report.photos.map((p, i) => {
            const alt = t("app.report.photoAlt", { n: i + 1 });
            return (
              <li key={p.id}>
                {urls[p.path] ? (
                  <button type="button" className="block w-full" aria-label={alt} onClick={() => onOpenPhoto(urls[p.path], alt)}>
                    <img src={urls[p.path]} alt="" className="aspect-square w-full rounded-control object-cover" />
                  </button>
                ) : (
                  <div className="aspect-square w-full rounded-control bg-well-tint" />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {state !== "open" && (
        <p className="m-0 text-control text-muted-foreground">
          {report.signed_at ? (
            <Trans t={t} i18nKey="app.report.signedOn" values={{ name: report.signer_name ?? "", date: formatTimestampLocal(report.signed_at) }} components={{ date }} />
          ) : (
            <Trans t={t} i18nKey="app.report.lockedOn" values={{ date: formatTimestampLocal(report.locked_at!) }} components={{ date }} />
          )}
        </p>
      )}
      {signature && (
        <img
          src={signature} alt={t("app.report.signatureAlt", { name: report.signer_name ?? "" })}
          className="max-h-32 rounded-control border border-border object-contain"
        />
      )}
      <OfficeNote report={report} />
    </li>
  );
}

/** Opens the visit report PDF (werkbank-reports) of all reports or of one, in a new tab. */
function ReportsPdfMenu({ orderId, reports }: { orderId: string; reports: VisitReport[] }) {
  const { t } = useTranslation("werkbank");
  const pdf = useVisitReportPdf(orderId);
  const open = (reportIds?: string[]) => {
    const tab = openPendingTab();
    return pdf.mutateAsync(reportIds)
      .then((blob) =>
        showInTab(tab, URL.createObjectURL(blob), (url) =>
          toast.error(t("invoices.page.pdfBlocked"), { action: { label: t("invoices.page.pdfOpen"), onClick: () => window.open(url, "_blank") } })))
      .catch((e: unknown) => {
        tab?.close();
        toast.error(t(visitReportPdfErrorKey(e)));
      });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" disabled={pdf.isPending}>{t("orders.reports.pdf")}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void open()}>{t("orders.reports.pdfAll")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {reports.map((r) => (
          <DropdownMenuItem key={r.id} onSelect={() => void open([r.id])}>
            <span>
              <Trans
                t={t} i18nKey="orders.reports.pdfOne"
                values={{ date: formatDateWithWeekday(r.visit_date), name: r.technician_name }}
                components={{ date: <Metric size="body">{null}</Metric> }}
              />
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The technicians' visit reports of an order, oldest first, with the office's internal note per
 *  report and a PDF menu (all reports or one). Hidden while the order has no reports. */
export function VisitReportsCard({ orderId }: { orderId: string }) {
  const { t } = useTranslation("werkbank");
  const { data: reports } = useVisitReports(orderId);
  const [photo, setPhoto] = useState<{ url: string; alt: string } | null>(null);
  if (!reports || reports.length === 0) return null;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <h2 className="m-0"><Eyebrow>{t("orders.reports.title")}</Eyebrow></h2>
        <ReportsPdfMenu orderId={orderId} reports={reports} />
      </CardHeader>
      <CardContent>
        <ul className="m-0 list-none space-y-4 p-0">
          {reports.map((r) => <ReportItem key={r.id} report={r} onOpenPhoto={(url, alt) => setPhoto({ url, alt })} />)}
        </ul>
      </CardContent>
      <Dialog open={!!photo} onOpenChange={(open) => { if (!open) setPhoto(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{photo?.alt}</DialogTitle></DialogHeader>
          {photo && <img src={photo.url} alt={photo.alt} className="max-h-[70vh] w-full object-contain" />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
