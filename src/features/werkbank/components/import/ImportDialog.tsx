import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Upload } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { MAX_IMPORT_ROWS, parseSheet, type ParsedSheet } from "@/lib/artistImport/parseSheet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { guessColumns } from "../../import/guessColumns";
import type { ColumnMapping, ImportResult, ImportSpec } from "../../import/types";
import { validateRows, type ValidatedRows } from "../../import/validateRows";
import { mapDbError } from "../../lib/dbErrors";

type Step = "upload" | "map" | "review" | "summary";
const STEPS: Step[] = ["upload", "map", "review", "summary"];

/** Select value for "do not import this field" (Radix Select has no empty value). */
const IGNORE = "__ignore__";

/** The message parseSheet throws when a sheet has more than MAX_IMPORT_ROWS rows. */
const TOO_MANY_ROWS = `Sheet exceeds ${MAX_IMPORT_ROWS} rows`;

/** The sheet row a 0-based data row index stands for (row 1 holds the column names). */
const sheetRow = (index: number) => index + 2;

interface Summary {
  created: number;
  skipped: number;
  errors: number;
  lines: { row: number; text: string }[];
}

/** Folds the rows left out in review and the RPC results (whose `row` indexes the rows sent, i.e.
 *  `checked.valid`) into counts and one line per row that was not created. */
function summarize<F>(checked: ValidatedRows<F>, results: ImportResult[], t: TFunction): Summary {
  const lines = checked.invalid.map((r) => ({ row: sheetRow(r.index), text: t("import.reasons.invalid") }));
  for (const r of results) {
    if (r.status === "created") continue;
    const sent = checked.valid[r.row];
    lines.push({
      row: sheetRow(sent ? sent.index : r.row),
      text: r.reason ? t(`import.reasons.${r.reason}`, { detail: r.detail ?? "" }) : t("import.reasons.other"),
    });
  }
  return {
    created: results.filter((r) => r.status === "created").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length + checked.invalid.length,
    lines: lines.sort((a, b) => a.row - b.row),
  };
}

/** Import of one entity from a CSV or XLSX file: upload, map columns, review (invalid rows are
 *  listed and left out), import through `spec.run`, summary. `onDone` runs once per finished
 *  import, so the caller can refresh its lists. */
export function ImportDialog<F>({
  spec,
  open,
  onOpenChange,
  onDone,
}: {
  spec: ImportSpec<F>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation("werkbank");
  const orgId = useAuth().currentOrg?.id;
  const [step, setStep] = useState<Step>("upload");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [checked, setChecked] = useState<ValidatedRows<F> | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  // Two quick clicks can both start before `running` renders; this keeps one click to one import.
  const runningRef = useRef(false);

  function reset() {
    setStep("upload");
    setSheet(null);
    setMapping({});
    setUploadError(null);
    setChecked(null);
    setRunError(null);
    setSummary(null);
  }

  function changeOpen(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function readFile(file: File) {
    setUploadError(null);
    try {
      const parsed = /\.xlsx$/i.test(file.name)
        ? await parseSheet(await file.arrayBuffer(), "xlsx")
        : await parseSheet(await file.text(), "csv");
      if (parsed.headers.every((h) => h === "")) return setUploadError(t("import.errors.noColumns"));
      if (parsed.rows.length === 0) return setUploadError(t("import.errors.noRows"));
      setSheet(parsed);
      setMapping(guessColumns(parsed.headers, spec.fields));
      setStep("map");
    } catch (e) {
      const tooMany = e instanceof Error && e.message === TOO_MANY_ROWS;
      setUploadError(tooMany ? t("import.errors.tooManyRows", { max: MAX_IMPORT_ROWS }) : t("import.errors.read"));
    }
  }

  function review() {
    if (!sheet) return;
    setChecked(validateRows(sheet.rows, mapping, spec, t));
    setRunError(null);
    setStep("review");
  }

  async function runImport() {
    if (!checked || !orgId || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setRunError(null);
    try {
      const results = await spec.run(supabase, orgId, checked.valid.map((v) => spec.toRpcRow(v.form)));
      setSummary(summarize(checked, results, t));
      setStep("summary");
      onDone();
    } catch (e) {
      setRunError(t(mapDbError(e)));
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  const headers = sheet ? [...new Set(sheet.headers.filter((h) => h !== ""))] : [];
  const mappingComplete = spec.fields.every((f) => !f.required || mapping[f.key]);

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(`import.title.${spec.entity}`)}</DialogTitle>
          <DialogDescription>{t("import.description")}</DialogDescription>
        </DialogHeader>
        {spec.entity === "properties" && <p className="text-sm">{t("import.propertiesHint")}</p>}

        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={s === step ? "step" : undefined}
              className={cn(s === step ? "font-medium text-foreground" : "text-muted-foreground")}
            >
              {i + 1}. {t(`import.steps.${s}`)}
            </li>
          ))}
        </ol>

        {step === "upload" && (
          <div className="space-y-3">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border p-8 text-center hover:bg-hover-tint">
              <Upload className="h-6 w-6 text-muted-foreground" aria-hidden />
              <span className="text-sm">{t("import.upload.label")}</span>
              <input
                type="file"
                accept=".csv,.xlsx"
                className="sr-only"
                aria-label={t("import.upload.label")}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void readFile(file);
                }}
              />
            </label>
            <p className="text-xs text-muted-foreground">{t("import.upload.hint", { max: MAX_IMPORT_ROWS })}</p>
            {uploadError && (
              <Alert variant="destructive">
                <AlertDescription>{uploadError}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {step === "map" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("import.map.intro")}</p>
            <div className="grid items-center gap-x-3 gap-y-2 sm:grid-cols-[14rem_1fr]">
              {spec.fields.map((field) => {
                const label = t(field.labelKey);
                return (
                  <div key={field.key} className="contents">
                    <span className="text-sm">
                      {label}
                      {field.required && <span className="text-destructive"> *</span>}
                    </span>
                    <Select
                      value={mapping[field.key] ?? IGNORE}
                      onValueChange={(v) => setMapping((m) => ({ ...m, [field.key]: v === IGNORE ? null : v }))}
                    >
                      <SelectTrigger aria-label={t("import.map.columnFor", { field: label })}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={IGNORE}>{t("import.map.ignore")}</SelectItem>
                        {headers.map((h) => (
                          <SelectItem key={h} value={h}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStep("upload")}>
                {t("import.back")}
              </Button>
              <Button type="button" onClick={review} disabled={!mappingComplete}>
                {t("import.continue")}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "review" && checked && (
          <div className="space-y-4">
            <p className="text-sm">
              {checked.invalid.length > 0
                ? t("import.review.counts", {
                    ready: t("import.review.ready", { count: checked.valid.length }),
                    invalid: t("import.review.invalid", { count: checked.invalid.length }),
                  })
                : t("import.review.countsAllValid", { ready: t("import.review.ready", { count: checked.valid.length }) })}
            </p>
            {checked.invalid.length > 0 && (
              <ul
                aria-label={t("import.review.invalidList")}
                className="max-h-64 space-y-1 overflow-y-auto rounded-control border border-border p-3 text-sm"
              >
                {checked.invalid.map((r) => (
                  <li key={r.index}>{t("import.row", { row: sheetRow(r.index), message: r.messages.join(", ") })}</li>
                ))}
              </ul>
            )}
            {runError && (
              <Alert variant="destructive">
                <AlertDescription>{runError}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStep("map")} disabled={running}>
                {t("import.back")}
              </Button>
              <Button type="button" onClick={() => void runImport()} disabled={running || checked.valid.length === 0}>
                {running ? t("import.review.running") : t("import.review.submit", { count: checked.valid.length })}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "summary" && summary && (
          <div className="space-y-4">
            <p className="text-base font-medium">
              {t("import.summary.counts", { created: summary.created, skipped: summary.skipped, errors: summary.errors })}
            </p>
            {summary.lines.length > 0 && (
              <ul
                aria-label={t("import.summary.list")}
                className="max-h-64 space-y-1 overflow-y-auto rounded-control border border-border p-3 text-sm"
              >
                {summary.lines.map((line, i) => (
                  <li key={i}>{t("import.row", { row: line.row, message: line.text })}</li>
                ))}
              </ul>
            )}
            {spec.entity === "customers" && <p className="text-xs text-muted-foreground">{t("import.summary.customerNumbers")}</p>}
            <DialogFooter>
              <Button type="button" onClick={() => changeOpen(false)}>
                {t("import.done")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
