import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { NumberRange } from "../data/numberRanges";
import { formatNumber } from "../data/numberRanges";
import { useNumberRange, useSaveNumberRange } from "../hooks/useNumberRanges";

const MAX_PREFIX_LENGTH = 10;
/** Postgres bigint upper bound is far above this; JS numbers stay exact up to it. */
const MAX_NEXT_VALUE = Number.MAX_SAFE_INTEGER;

/** The typed next number as an integer of 1 or more, or null when it is not one. */
function parseNextValue(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= 1 && n <= MAX_NEXT_VALUE ? n : null;
}

function RangeForm({ range }: { range: NumberRange }) {
  const { t } = useTranslation("werkbank");
  const save = useSaveNumberRange("customer");
  const [prefix, setPrefix] = useState(range.prefix);
  const [nextText, setNextText] = useState(String(range.next_value));
  const [submitted, setSubmitted] = useState(false);

  const nextValue = parseNextValue(nextText);
  const prefixError = prefix.length > MAX_PREFIX_LENGTH ? t("numbering.errors.prefixTooLong") : null;
  const nextError = nextValue === null ? t("numbering.errors.nextValue") : null;
  const preview = nextValue !== null && !prefixError ? formatNumber(prefix, nextValue, range.padding) : null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (prefixError || nextValue === null) return;
    // The padding is not editable here; it is written back as stored. The next number is only sent
    // when the admin changed it, so saving a new prefix never moves the counter.
    save.mutate(
      nextValue === range.next_value
        ? { prefix, padding: range.padding }
        : { prefix, next_value: nextValue, padding: range.padding },
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="numbering-prefix">{t("numbering.prefix")}</Label>
          <Input
            id="numbering-prefix"
            autoComplete="off"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            aria-invalid={submitted && !!prefixError}
          />
          {submitted && prefixError ? (
            <p role="alert" className="text-sm text-destructive">{prefixError}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("numbering.prefixHint")}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="numbering-next">{t("numbering.nextValue")}</Label>
          <Input
            id="numbering-next"
            inputMode="numeric"
            autoComplete="off"
            value={nextText}
            onChange={(e) => setNextText(e.target.value)}
            aria-invalid={submitted && !!nextError}
          />
          {submitted && nextError && <p role="alert" className="text-sm text-destructive">{nextError}</p>}
        </div>
      </div>
      <p className="text-sm font-medium" aria-live="polite">
        {preview !== null && t("numbering.preview", { number: preview })}
      </p>
      <Button type="submit" disabled={save.isPending}>{t("numbering.save")}</Button>
    </form>
  );
}

/** Settings tab "Nummernkreise" (admins of a handwerk org). Teil 3 and 4 add their keys here. */
export function NumberingTab() {
  const { t } = useTranslation("werkbank");
  const { data, isLoading, isError } = useNumberRange("customer");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">{t("numbering.title")}</CardTitle>
        <CardDescription>{t("numbering.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <h3 className="text-sm font-semibold">{t("numbering.customerHeading")}</h3>
        {isLoading && <Skeleton className="h-24 w-full" />}
        {isError && (
          <Alert variant="destructive">
            <AlertDescription>{t("numbering.loadFailed")}</AlertDescription>
          </Alert>
        )}
        {/* Keyed on the loaded values: a refetch (after a save, a new customer or an import)
            re-mounts the form, so it never shows or saves a stale next number. */}
        {data && <RangeForm key={`${data.prefix}|${data.next_value}|${data.padding}`} range={data} />}
      </CardContent>
    </Card>
  );
}
