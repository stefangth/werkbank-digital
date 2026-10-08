import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Metric } from "@/components/ui/metric";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatDateWithWeekday, formatTimestampLocal } from "@/lib/dates";
import { DefaultHint, HintedLabel } from "../components/DefaultHint";
import type { AssignmentReport } from "../data/technicianApp";
import { useAssignmentActions, useVisitObjectUrls } from "../hooks/useAssignments";
import { useOnline } from "../hooks/useOnline";
import { hintId } from "../lib/hintId";
import { resizeImage } from "../lib/resizeImage";
import { MAX_PHOTOS_PER_REPORT, PHOTO_MAX_EDGE_PX } from "../lib/visitDefaults";
import { FinalConfirmDialog } from "./FinalConfirmDialog";
import { NeedsNetwork } from "./OfflineBanner";
import { ReportPhotos } from "./ReportPhotos";
import { SignStep } from "./SignStep";

const DATE_ID = "report-visit-date";
const BODY_ID = "report-body";

type Flush = () => Promise<void>;

/** A finished report, or another technician's open one: nothing to edit. */
function ReadOnlyReport({ report }: { report: AssignmentReport }) {
  const { t } = useTranslation("werkbank");
  const paths = [...report.photos.map((p) => p.path), ...(report.signature_path ? [report.signature_path] : [])];
  const urls = useVisitObjectUrls(paths).data ?? {};
  const date = <Metric size="body">{null}</Metric>;
  return (
    <div className="space-y-4">
      <p className="m-0 text-body">
        {report.signed_at ? (
          <Trans t={t} i18nKey="app.report.signedOn" values={{ name: report.signer_name ?? "", date: formatTimestampLocal(report.signed_at) }} components={{ date }} />
        ) : report.locked_at ? (
          <Trans t={t} i18nKey="app.report.lockedOn" values={{ date: formatTimestampLocal(report.locked_at) }} components={{ date }} />
        ) : (
          t("app.report.othersReport", { name: report.technician_name })
        )}
      </p>
      <p className="m-0 text-control text-muted-foreground">
        <Metric size="body">{formatDateWithWeekday(report.visit_date)}</Metric>, {report.technician_name}
      </p>
      <p className="m-0 whitespace-pre-wrap text-body">{report.body.trim() ? report.body : t("app.report.noText")}</p>
      <ReportPhotos photos={report.photos} urls={urls} />
      {report.signature_path && (
        urls[report.signature_path] ? (
          <img
            src={urls[report.signature_path]} alt={t("app.report.signatureAlt", { name: report.signer_name ?? "" })}
            className="max-h-40 w-full rounded-control border border-border object-contain"
          />
        ) : <p className="m-0 text-control text-muted-foreground">{t("app.report.photoOnlineOnly")}</p>
      )}
    </div>
  );
}

/** The caller's open report: date and text saved on blur, photos, and the two closing actions. */
function EditableReport({ orderId, report, flushRef, onClose }: {
  orderId: string;
  report: AssignmentReport;
  flushRef: React.MutableRefObject<Flush | null>;
  onClose: () => void;
}) {
  const { t } = useTranslation("werkbank");
  const { updateReport, addPhoto, removePhoto, lockReport } = useAssignmentActions(orderId);
  const { online } = useOnline();
  const [body, setBody] = useState(report.body);
  const [visitDate, setVisitDate] = useState(report.visit_date);
  const [step, setStep] = useState<"edit" | "sign">("edit");
  const [locking, setLocking] = useState(false);
  const [resizing, setResizing] = useState(false);
  const saved = useRef({ body: report.body, visitDate: report.visit_date });
  const fileRef = useRef<HTMLInputElement>(null);
  const urls = useVisitObjectUrls(report.photos.map((p) => p.path)).data ?? {};

  /** Saves the text and date when they differ from the last save; resolves once stored. */
  const save = (next = { body, visitDate }): Promise<void> => new Promise((resolve, reject) => {
    if (!next.visitDate || (next.body === saved.current.body && next.visitDate === saved.current.visitDate)) return resolve();
    const before = saved.current;
    saved.current = next;
    updateReport.mutate({ reportId: report.id, body: next.body, visitDate: next.visitDate }, {
      onSuccess: () => resolve(),
      onError: (e) => {
        saved.current = before;
        reject(e);
      },
    });
  });

  useEffect(() => {
    flushRef.current = () => save();
    return () => { flushRef.current = null; };
  });

  const photoCount = report.photos.length;
  const uploading = resizing || addPhoto.isPending;

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setResizing(true);
    try {
      const resized = await resizeImage(file);
      addPhoto.mutate({ reportId: report.id, file: resized }, { onSettled: () => setResizing(false) });
    } catch (err) {
      setResizing(false);
      toast.error(t(err instanceof Error && err.message === "photo_too_large" ? "app.report.photoTooLarge" : "app.report.photoUnreadable"));
    }
  };

  const lock = (done: () => void) => {
    save().then(
      () => lockReport.mutate(report.id, {
        onSuccess: () => {
          toast.success(t("app.report.lockedToast"));
          onClose();
        },
        onSettled: () => {
          done();
          setLocking(false);
        },
      }),
      () => {
        done();
        setLocking(false);
      },
    );
  };

  // The customer signs the text the database holds: a failed save keeps the edit step (the hook
  // has toasted why), so the summary never shows text the locked report would not store.
  const toSignStep = () => { save().then(() => setStep("sign"), () => undefined); };

  if (step === "sign") {
    return <SignStep orderId={orderId} report={report} body={body} onBack={() => setStep("edit")} onSigned={onClose} />;
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <HintedLabel htmlFor={DATE_ID} hint={t("app.report.visitDateHint")}>{t("app.report.visitDate")}</HintedLabel>
        <Input
          id={DATE_ID} type="date" className="h-11" required value={visitDate} aria-describedby={hintId(DATE_ID)}
          onChange={(e) => {
            setVisitDate(e.target.value);
            if (e.target.value) save({ body, visitDate: e.target.value }).catch(() => undefined);
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={BODY_ID}>{t("app.report.body")}</Label>
        <Textarea
          id={BODY_ID} rows={6} value={body} onChange={(e) => setBody(e.target.value)}
          onBlur={() => { save().catch(() => undefined); }}
        />
      </div>

      <section className="space-y-2">
        <div className="flex items-center gap-1.5">
          <h3 className="m-0"><Eyebrow>{t("app.report.photos")}</Eyebrow></h3>
          <Metric size="body">{photoCount} / {MAX_PHOTOS_PER_REPORT}</Metric>
          <DefaultHint text={t("app.report.photoLimitHint", { max: MAX_PHOTOS_PER_REPORT })} />
        </div>
        <ReportPhotos photos={report.photos} urls={urls} onRemove={(id) => removePhoto.mutate(id)} removeDisabled={!online || removePhoto.isPending} />
        <div className="flex items-center gap-1.5">
          <Button
            type="button" variant="secondary" size="touch" disabled={!online || uploading || photoCount >= MAX_PHOTOS_PER_REPORT}
            onClick={() => fileRef.current?.click()}
          >
            <Camera aria-hidden="true" />{uploading ? t("app.report.uploading") : t("app.report.addPhoto")}
          </Button>
          <DefaultHint text={t("app.report.resizeHint", { px: PHOTO_MAX_EDGE_PX })} />
          <input
            ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true"
            onChange={onFile}
          />
        </div>
      </section>

      <div className="flex flex-col gap-2">
        <Button size="touch" disabled={!online || updateReport.isPending} onClick={toSignStep}>{t("app.report.sign")}</Button>
        <Button variant="secondary" size="touch" disabled={!online} onClick={() => setLocking(true)}>{t("app.report.lock")}</Button>
        <NeedsNetwork />
      </div>

      <FinalConfirmDialog
        open={locking} onOpenChange={setLocking}
        title={t("app.report.lockTitle")} action={t("app.report.lockSubmit")} onConfirm={lock}
      />
    </div>
  );
}

/** A visit report over the assignment detail. The caller's open report is editable; a locked one,
 *  or another technician's, is read-only. Unsaved text is saved when the sheet closes. */
export function ReportSheet({ orderId, report, open, onOpenChange }: {
  orderId: string;
  /** Undefined while a just-created report is still loading. */
  report: AssignmentReport | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("werkbank");
  const flushRef = useRef<Flush | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const editable = !!report && report.is_mine && !report.locked_at;

  const handleOpenChange = (next: boolean) => {
    if (!next) flushRef.current?.().catch(() => undefined);
    onOpenChange(next);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        ref={contentRef} side="right" className="w-full space-y-4 overflow-y-auto sm:max-w-lg" aria-describedby={undefined}
        // Focus the sheet itself: the first focusable is a DefaultHint, whose tooltip would pop up on open.
        onOpenAutoFocus={(e) => { e.preventDefault(); contentRef.current?.focus(); }}
      >
        <SheetHeader>
          <SheetTitle>{t("app.report.title")}</SheetTitle>
        </SheetHeader>
        {!report ? (
          <Skeleton role="status" aria-busy="true" className="h-40 w-full" />
        ) : editable ? (
          <EditableReport key={report.id} orderId={orderId} report={report} flushRef={flushRef} onClose={() => onOpenChange(false)} />
        ) : (
          <ReadOnlyReport report={report} />
        )}
      </SheetContent>
    </Sheet>
  );
}
