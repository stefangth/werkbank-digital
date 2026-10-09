import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AssignmentReport } from "../data/technicianApp";
import { isSignatureUploaded } from "../data/technicianApp";
import { useAssignmentActions } from "../hooks/useAssignments";
import { useOnline } from "../hooks/useOnline";
import { SIGNATURE_MAX_BYTES } from "../lib/visitDefaults";
import { FinalConfirmDialog } from "./FinalConfirmDialog";
import { NeedsNetwork } from "./OfflineBanner";
import { SignaturePad } from "./SignaturePad";
import { uploadedSignatures } from "./signatureStore";

/** The customer signs on the technician's phone: a read-only summary of the report, the signer's
 *  name and the pad. Signing uploads the PNG, then locks the report with `sign_visit_report`. */
export function SignStep({ orderId, report, body, onBack, onSigned }: {
  orderId: string;
  report: AssignmentReport;
  /** The text as typed in the sheet, which may be newer than `report.body`. */
  body: string;
  onBack: () => void;
  onSigned: () => void;
}) {
  const { t } = useTranslation("werkbank");
  const { signReport } = useAssignmentActions(orderId);
  const { online } = useOnline();
  const [uploaded, setUploaded] = useState(() => uploadedSignatures.get(report.id) ?? null);
  const [name, setName] = useState(uploaded?.signerName ?? "");
  const [png, setPng] = useState<Blob | null>(uploaded?.png ?? null);
  const [confirming, setConfirming] = useState(false);
  const signer = name.trim();
  const frozenUrl = useMemo(() => (uploaded ? URL.createObjectURL(uploaded.png) : null), [uploaded]);
  useEffect(() => () => { if (frozenUrl) URL.revokeObjectURL(frozenUrl); }, [frozenUrl]);

  const sign = (done: () => void) => {
    if (!png || !signer) return done();
    if (png.size > SIGNATURE_MAX_BYTES) {
      toast.error(t("app.report.signatureTooLarge"));
      setConfirming(false);
      return done();
    }
    signReport.mutate({ reportId: report.id, signerName: signer, png, ...(uploaded ? { uploaded: true } : {}) }, {
      onSuccess: () => {
        uploadedSignatures.delete(report.id);
        toast.success(t("app.report.signedToast"));
        onSigned();
      },
      onError: (e) => {
        if (uploaded || !isSignatureUploaded(e)) return;
        const stored = { png, signerName: signer };
        uploadedSignatures.set(report.id, stored);
        setUploaded(stored);
      },
      onSettled: () => {
        done();
        setConfirming(false);
      },
    });
  };

  return (
    <div className="space-y-4">
      <section className="space-y-1.5 rounded-card border border-border p-3">
        <p className="m-0 whitespace-pre-wrap text-body">{body.trim() ? body : t("app.report.noText")}</p>
        <p className="m-0 text-control text-muted-foreground">{t("app.detail.photos", { count: report.photos.length })}</p>
      </section>

      <div className="space-y-1.5">
        <Label htmlFor="report-signer">{t("app.report.signerName")}</Label>
        <Input
          id="report-signer" className="h-11" autoComplete="name" value={name} readOnly={!!uploaded}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <h3 className="m-0"><Eyebrow>{t("app.report.signature")}</Eyebrow></h3>
        {uploaded && frozenUrl ? (
          <>
            <img
              src={frozenUrl} alt={t("app.report.signatureAlt", { name: uploaded.signerName })}
              className="block h-48 w-full rounded-control border border-border object-contain"
            />
            <p className="m-0 text-control text-muted-foreground">{t("app.report.signatureStored")}</p>
          </>
        ) : (
          <SignaturePad onChange={setPng} />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Button size="touch" disabled={!online || !signer || !png} onClick={() => setConfirming(true)}>{t("app.report.signSubmit")}</Button>
        <NeedsNetwork />
        <Button variant="secondary" size="touch" onClick={onBack}>{t("app.report.backToReport")}</Button>
      </div>

      <FinalConfirmDialog
        open={confirming} onOpenChange={setConfirming}
        title={t("app.report.signTitle")} action={t("app.report.signSubmit")} onConfirm={sign}
      />
    </div>
  );
}
