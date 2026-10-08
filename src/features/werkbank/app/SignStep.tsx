import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AssignmentReport } from "../data/technicianApp";
import { useAssignmentActions } from "../hooks/useAssignments";
import { SIGNATURE_MAX_BYTES } from "../lib/visitDefaults";
import { FinalConfirmDialog } from "./FinalConfirmDialog";
import { SignaturePad } from "./SignaturePad";

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
  const [name, setName] = useState("");
  const [png, setPng] = useState<Blob | null>(null);
  const [confirming, setConfirming] = useState(false);
  const signer = name.trim();

  const sign = (done: () => void) => {
    if (!png || !signer) return done();
    if (png.size > SIGNATURE_MAX_BYTES) {
      toast.error(t("app.report.signatureTooLarge"));
      setConfirming(false);
      return done();
    }
    signReport.mutate({ reportId: report.id, signerName: signer, png }, {
      onSuccess: () => {
        toast.success(t("app.report.signedToast"));
        onSigned();
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
        <Input id="report-signer" className="h-11" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <h3 className="m-0"><Eyebrow>{t("app.report.signature")}</Eyebrow></h3>
        <SignaturePad onChange={setPng} />
      </div>

      <div className="flex flex-col gap-2">
        <Button size="touch" disabled={!signer || !png} onClick={() => setConfirming(true)}>{t("app.report.signSubmit")}</Button>
        <Button variant="secondary" size="touch" onClick={onBack}>{t("app.report.backToReport")}</Button>
      </div>

      <FinalConfirmDialog
        open={confirming} onOpenChange={setConfirming}
        title={t("app.report.signTitle")} action={t("app.report.signSubmit")} onConfirm={sign}
      />
    </div>
  );
}
