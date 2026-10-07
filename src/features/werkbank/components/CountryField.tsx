import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const COMMON = ["DE", "AT", "CH"] as const;
const OTHER = "__other__";

/** Country as an ISO code: Deutschland, Österreich, Schweiz, or "other" with a free two-letter
 *  input (uppercased as typed). Controlled, so it works as a react-hook-form field. */
export function CountryField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (code: string) => void;
}) {
  const { t } = useTranslation("werkbank");
  const isOther = !(COMMON as readonly string[]).includes(value);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={isOther ? OTHER : value}
        // "Other" starts with an empty code so the input is shown and the user types their own.
        onValueChange={(v) => onChange(v === OTHER ? "" : v)}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COMMON.map((code) => (
            <SelectItem key={code} value={code}>
              {t(`customers.country.${code}`)}
            </SelectItem>
          ))}
          <SelectItem value={OTHER}>{t("customers.country.other")}</SelectItem>
        </SelectContent>
      </Select>
      {isOther && (
        <Input
          aria-label={t("customers.country.otherCode")}
          autoComplete="off"
          maxLength={2}
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
      )}
    </div>
  );
}
