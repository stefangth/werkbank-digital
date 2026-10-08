import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { NumberRange } from "../data/numberRanges";
import { formatNumber, NUMBER_RANGE_KEYS, type NumberRangeKey } from "../data/numberRanges";
import { HintedLabel } from "./DefaultHint";
import { hintId } from "../lib/hintId";
import { useInvoiceRangeLocked, useNumberRange, useSaveNumberRange } from "../hooks/useNumberRanges";

/** The start value the database applies to a range without a row (numberRanges.ts, werkbank.next_number). */
const DEFAULT_START: Record<NumberRangeKey, number> = { customer: 10001, quote: 1, order: 1, invoice: 1 };
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

function RangeForm({ rangeKey, range, locked }: { rangeKey: NumberRangeKey; range: NumberRange; locked: boolean }) {
  const { t } = useTranslation("werkbank");
  const save = useSaveNumberRange(rangeKey);
  const [prefix, setPrefix] = useState(range.prefix);
  const [nextText, setNextText] = useState(String(range.next_value));
  const [submitted, setSubmitted] = useState(false);

  const nextValue = parseNextValue(nextText);
  const prefixError = prefix.length > MAX_PREFIX_LENGTH ? t("numbering.errors.prefixTooLong") : null;
  // The database refuses any decrease of the invoice start (number_range_locked), so catch it here.
  const nextError = nextValue === null
    ? t("numbering.errors.nextValue")
    : rangeKey === "invoice" && nextValue < range.next_value ? t("numbering.errors.raiseOnly") : null;
  const preview = nextValue !== null && !prefixError ? formatNumber(prefix, nextValue, range.padding) : null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (prefixError || nextError || nextValue === null) return;
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
          <Label htmlFor={`numbering-prefix-${rangeKey}`}>{t("numbering.prefix")}</Label>
          <Input
            id={`numbering-prefix-${rangeKey}`}
            autoComplete="off"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            disabled={locked}
            aria-invalid={submitted && !!prefixError}
          />
          {submitted && prefixError ? (
            <p role="alert" className="text-sm text-destructive">{prefixError}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("numbering.prefixHint")}</p>
          )}
        </div>
        <div className="space-y-2">
          <HintedLabel htmlFor={`numbering-next-${rangeKey}`} hint={t("hints.numberingStart", { start: DEFAULT_START[rangeKey] })}>
            {t("numbering.nextValue")}
          </HintedLabel>
          <Input
            id={`numbering-next-${rangeKey}`}
            aria-describedby={hintId(`numbering-next-${rangeKey}`)}
            inputMode="numeric"
            autoComplete="off"
            value={nextText}
            onChange={(e) => setNextText(e.target.value)}
            disabled={locked}
            aria-invalid={submitted && !!nextError}
          />
          {submitted && nextError && <p role="alert" className="text-sm text-destructive">{nextError}</p>}
        </div>
      </div>
      <p className="text-sm font-medium" aria-live="polite">
        {preview !== null && t(`numbering.preview.${rangeKey}`, { number: preview })}
      </p>
      {locked ? (
        <p className="text-sm text-muted-foreground">{t("numbering.locked")}</p>
      ) : (
        <Button type="submit" disabled={save.isPending}>{t("numbering.save")}</Button>
      )}
    </form>
  );
}

function RangeSection({ rangeKey }: { rangeKey: NumberRangeKey }) {
  const { t } = useTranslation("werkbank");
  const { data, isLoading, isError } = useNumberRange(rangeKey);
  // Only the invoice range locks (an issued invoice carries its number for good); others stay editable.
  const issued = useInvoiceRangeLocked();
  const locked = rangeKey === "invoice" && issued.data === true;
  const headingId = `numbering-heading-${rangeKey}`;

  return (
    <div role="group" aria-labelledby={headingId} className="space-y-4">
      <h3 id={headingId} className="text-sm font-semibold">{t(`numbering.headings.${rangeKey}`)}</h3>
      {isLoading && <Skeleton className="h-24 w-full" />}
      {isError && (
        <Alert variant="destructive">
          <AlertDescription>{t("numbering.loadFailed")}</AlertDescription>
        </Alert>
      )}
      {/* Keyed on the loaded values: a refetch (after a save, a new customer or an import)
          re-mounts the form, so it never shows or saves a stale next number. */}
      {data && <RangeForm key={`${data.prefix}|${data.next_value}|${data.padding}|${locked}`} rangeKey={rangeKey} range={data} locked={locked} />}
    </div>
  );
}

/** Settings tab "Nummernkreise" (admins of a handwerk org): one row per number range. */
export function NumberingTab() {
  const { t } = useTranslation("werkbank");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">{t("numbering.title")}</CardTitle>
        <CardDescription>{t("numbering.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {NUMBER_RANGE_KEYS.map((key) => (
          <RangeSection key={key} rangeKey={key} />
        ))}
      </CardContent>
    </Card>
  );
}
