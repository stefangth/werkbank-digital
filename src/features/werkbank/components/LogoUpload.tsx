import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useLogoUrl, useUploadLogo } from "../hooks/useCompanyProfile";

const LOGO_MAX_BYTES = 1024 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg"] as const;

/** Logo picker: PNG or JPEG up to 1 MB. A valid file is uploaded at once and its storage path
 *  handed to `onChange`; the path is saved with the rest of the profile. `onPendingChange` reports
 *  a running upload, so the form can hold Save until the new path is in. */
export function LogoUpload({
  value,
  onChange,
  onPendingChange,
}: {
  value: string;
  onChange: (path: string) => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const { t } = useTranslation("werkbank");
  const upload = useUploadLogo();
  const preview = useLogoUrl(value || null);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onPendingChange?.(upload.isPending);
  }, [upload.isPending, onPendingChange]);

  const onPick = (file: File | undefined) => {
    if (!file) return;
    if (!(LOGO_TYPES as readonly string[]).includes(file.type)) {
      setError(t("company.logo.wrongType"));
    } else if (file.size > LOGO_MAX_BYTES) {
      setError(t("company.logo.tooLarge"));
    } else {
      setError(null);
      upload.mutate(file, { onSuccess: onChange });
    }
    // Lets the same file be picked again after a rejection.
    if (input.current) input.current.value = "";
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="company-logo">{t("company.logo.label")}</Label>
      {value && preview.data && (
        <img src={preview.data} alt={t("company.logo.alt")} className="max-h-16 max-w-48 rounded-field border border-border object-contain" />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          id="company-logo"
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          onChange={(e) => onPick(e.target.files?.[0])}
        />
        <Button type="button" variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}>
          {value ? t("company.logo.replace") : t("company.logo.choose")}
        </Button>
        {value && (
          <Button type="button" variant="outline" onClick={() => onChange("")}>{t("company.logo.remove")}</Button>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : upload.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">{t("company.logo.uploading")}</p>
      ) : (
        <p className="text-sm text-muted-foreground">{t("company.logo.hint")}</p>
      )}
    </div>
  );
}
