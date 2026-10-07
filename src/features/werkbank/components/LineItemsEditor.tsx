import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Reorder, useDragControls } from "framer-motion";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Metric } from "@/components/ui/metric";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/ui/status-pill";
import { Token } from "@/components/ui/token";
import type { CatalogItem } from "../data/catalog";
import type { DocumentItem, DocumentRef, ItemDraft } from "../data/documentItems";
import { useDocumentItems, useItemMutations } from "../hooks/useDocumentItems";
import { formatEuro } from "../lib/money";
import { sectionSubtotals } from "../lib/quoteNumber";
import { UNIT_CODES, unitLabelKey, type UnitCode } from "../lib/units";
import { PRICE, toNumber } from "../schemas/catalogItem";
import { CatalogItemCombobox } from "./CatalogItemCombobox";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";

/** Lines of an order that differ from its quote (ids), shown with a pill. */
export type LineMarks = { changed: ReadonlySet<string>; added: ReadonlySet<string> };

/** Inline edits are written this long after the last keystroke. */
const SAVE_DELAY_MS = 500;
const QUANTITY = /^\d+([.,]\d{1,3})?$/;
const VAT_RATES = ["19", "7", "0"] as const;

type Mutation<V> = { mutate: (vars: V) => void; isPending: boolean };
type Patch = Partial<ItemDraft>;

const blankDraft = (kind: ItemDraft["kind"]): ItemDraft => ({
  kind,
  name: kind === "text" ? null : "",
  description: null,
  catalog_item_id: null,
  item_no: null,
  quantity: kind === "item" ? 1 : null,
  unit_code: kind === "item" ? "H87" : null,
  labour_price: kind === "item" ? 0 : null,
  material_price: kind === "item" ? 0 : null,
  vat_rate: kind === "item" ? 19 : null,
});

/** A catalog item as a line item: the values are copied, so later catalog edits leave the
 *  document untouched. */
const snapshotDraft = (c: CatalogItem): ItemDraft => ({
  kind: "item",
  name: c.name,
  description: c.description,
  catalog_item_id: c.id,
  item_no: c.item_no,
  quantity: 1,
  unit_code: c.unit_code,
  labour_price: c.labour_price,
  material_price: c.material_price,
  vat_rate: c.vat_rate,
});

/** Debounced writes per field: the last edit of a field wins, and leaving the field saves at
 *  once. Pending writes are also run when the row unmounts (navigation, closing, read only), since
 *  removing an input fires no blur. */
function useFieldSaver(save: (patch: Patch) => void) {
  const pending = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => void }>());
  useEffect(() => {
    const map = pending.current;
    return () => {
      map.forEach((p) => {
        clearTimeout(p.timer);
        p.run();
      });
      map.clear();
    };
  }, []);
  const flush = (field: string) => {
    const p = pending.current.get(field);
    if (!p) return;
    clearTimeout(p.timer);
    pending.current.delete(field);
    p.run();
  };
  const schedule = (field: string, patch: Patch) => {
    const prev = pending.current.get(field);
    if (prev) clearTimeout(prev.timer);
    const run = () => save(patch);
    pending.current.set(field, {
      run,
      timer: setTimeout(() => {
        pending.current.delete(field);
        run();
      }, SAVE_DELAY_MS),
    });
  };
  const cancel = (field: string) => {
    const p = pending.current.get(field);
    if (p) clearTimeout(p.timer);
    pending.current.delete(field);
  };
  return { schedule, flush, cancel };
}

/** A text input with local state that saves `toPatch(value)` after the debounce; a value that
 *  `toPatch` rejects (null) is marked invalid and not saved. */
function SavedInput({
  field, label, initial, toPatch, saver, className, multiline, numeric,
}: {
  field: string;
  label: string;
  initial: string;
  toPatch: (value: string) => Patch | null;
  saver: ReturnType<typeof useFieldSaver>;
  className?: string;
  multiline?: boolean;
  numeric?: boolean;
}) {
  const { t } = useTranslation("werkbank");
  const [value, setValue] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const [syncedInitial, setSyncedInitial] = useState(initial);
  const focused = useRef(false);
  const errorId = `${useId()}-error`;
  // A value that changed from outside (another tab, realtime) replaces the shown one, unless the
  // user is editing this field right now (adjusting state while rendering).
  if (initial !== syncedInitial) {
    setSyncedInitial(initial);
    if (!focused.current) {
      setValue(initial);
      setInvalid(false);
    }
  }
  const onChange = (next: string) => {
    setValue(next);
    const patch = toPatch(next);
    setInvalid(patch === null);
    if (patch) saver.schedule(field, patch);
    else saver.cancel(field);
  };
  const common = {
    "aria-label": label,
    placeholder: label,
    value,
    "aria-invalid": invalid || undefined,
    "aria-describedby": invalid ? errorId : undefined,
    onFocus: () => { focused.current = true; },
    onBlur: () => {
      focused.current = false;
      saver.flush(field);
      // An invalid entry was never saved: show the saved value again.
      if (invalid) {
        setValue(initial);
        setInvalid(false);
      }
    },
    className,
  };
  if (multiline) return <Textarea {...common} onChange={(e) => onChange(e.target.value)} />;
  return (
    <div className="flex flex-col gap-1">
      <Input {...common} inputMode={numeric ? "decimal" : "text"} onChange={(e) => onChange(e.target.value)} />
      {invalid && <p id={errorId} role="alert" className="m-0 text-sm text-destructive">{t("lineItems.invalidNumber")}</p>}
    </div>
  );
}

const amount = (pattern: RegExp, key: "quantity" | "labour_price" | "material_price") => (value: string): Patch | null =>
  pattern.test(value.trim()) ? { [key]: toNumber(value.trim()) } : null;

function RowFields({
  item, subtotal, readOnly, saver, update, onDelete,
}: {
  item: DocumentItem;
  subtotal: number | undefined;
  readOnly: boolean;
  saver: ReturnType<typeof useFieldSaver>;
  update: (patch: Patch) => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation("werkbank");
  const money = (n: number | null) => formatEuro(n ?? 0, i18n.language);
  const unit = (item.unit_code ?? "H87") as UnitCode;
  const deleteButton = (
    <Button type="button" variant="ghost" size="icon" aria-label={t("common.delete")} onClick={onDelete}>
      <Trash2 className="h-4 w-4" />
    </Button>
  );

  if (item.kind === "title" || item.kind === "text") {
    const isTitle = item.kind === "title";
    const text = (isTitle ? item.name : item.description) ?? "";
    return (
      <div className="flex flex-1 items-center gap-2">
        {readOnly ? (
          <p className={isTitle ? "m-0 flex-1 font-semibold" : "m-0 flex-1 whitespace-pre-line text-muted-foreground"}>{text}</p>
        ) : (
          <SavedInput
            field={isTitle ? "name" : "description"}
            label={isTitle ? t("lineItems.title") : t("lineItems.text")}
            initial={text}
            toPatch={(v) => (isTitle ? { name: v } : { description: v })}
            saver={saver}
            className="flex-1"
            multiline={!isTitle}
          />
        )}
        {isTitle && subtotal !== undefined && <Metric size="body">{money(subtotal)}</Metric>}
        {!readOnly && deleteButton}
      </div>
    );
  }

  if (readOnly) {
    return (
      <div className="flex flex-1 items-center gap-3">
        {item.item_no && <Token className="text-muted-foreground">{item.item_no}</Token>}
        <span className="flex-1">{item.name}</span>
        <Metric size="body">{`${new Intl.NumberFormat(i18n.language || "de", { maximumFractionDigits: 3 }).format(item.quantity ?? 0)} ${t(unitLabelKey(unit))}`}</Metric>
        <Metric size="body">{money(item.line_net)}</Metric>
      </div>
    );
  }

  const price = (field: "labour_price" | "material_price", label: string) => (
    <SavedInput
      field={field}
      label={label}
      initial={String(item[field] ?? 0).replace(".", ",")}
      toPatch={amount(PRICE, field)}
      saver={saver}
      className="w-24 text-right tabular-nums"
      numeric
    />
  );
  return (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      {item.item_no && <Token className="text-muted-foreground">{item.item_no}</Token>}
      <SavedInput field="name" label={t("lineItems.name")} initial={item.name ?? ""} toPatch={(v) => ({ name: v })} saver={saver} className="min-w-48 flex-1" />
      <SavedInput
        field="quantity"
        label={t("lineItems.quantity")}
        initial={String(item.quantity ?? 0).replace(".", ",")}
        toPatch={amount(QUANTITY, "quantity")}
        saver={saver}
        className="w-20 text-right tabular-nums"
        numeric
      />
      <Select value={unit} onValueChange={(v) => update({ unit_code: v })}>
        <SelectTrigger aria-label={t("lineItems.unit")} className="w-24"><SelectValue /></SelectTrigger>
        <SelectContent>
          {UNIT_CODES.map((code) => <SelectItem key={code} value={code}>{t(unitLabelKey(code))}</SelectItem>)}
        </SelectContent>
      </Select>
      {price("labour_price", t("lineItems.labour"))}
      {price("material_price", t("lineItems.material"))}
      <Select value={String(item.vat_rate ?? 19)} onValueChange={(v) => update({ vat_rate: Number(v) })}>
        <SelectTrigger aria-label={t("lineItems.vat")} className="w-20"><SelectValue /></SelectTrigger>
        <SelectContent>
          {VAT_RATES.map((r) => <SelectItem key={r} value={r}>{`${r} %`}</SelectItem>)}
        </SelectContent>
      </Select>
      <Metric size="body" className="w-24 text-right">{money(item.line_net)}</Metric>
      {deleteButton}
    </div>
  );
}

/** "Changed" or "New" next to a line that differs from the quote. */
function MarkPill({ id, marks }: { id: string; marks?: LineMarks }) {
  const { t } = useTranslation("werkbank");
  if (marks?.added.has(id)) return <StatusPill tone="accent">{t("orders.comparison.added")}</StatusPill>;
  if (marks?.changed.has(id)) return <StatusPill tone="waiting">{t("orders.comparison.changed")}</StatusPill>;
  return null;
}

function EditableRow({
  item, subtotal, marks, update, onDelete, onDragEnd,
}: {
  item: DocumentItem;
  marks?: LineMarks;
  subtotal: number | undefined;
  update: Mutation<{ id: string; patch: Patch }>;
  onDelete: () => void;
  onDragEnd: () => void;
}) {
  const { t } = useTranslation("werkbank");
  const controls = useDragControls();
  const saver = useFieldSaver((patch) => update.mutate({ id: item.id, patch }));
  return (
    <Reorder.Item value={item} dragListener={false} dragControls={controls} onDragEnd={onDragEnd}>
      <div data-row className="flex items-start gap-2 border-b px-3 py-2">
        <button
          type="button"
          aria-label={t("lineItems.drag")}
          className="mt-2 cursor-grab touch-none text-muted-foreground"
          onPointerDown={(e) => controls.start(e)}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <RowFields item={item} subtotal={subtotal} readOnly={false} saver={saver} update={(patch) => update.mutate({ id: item.id, patch })} onDelete={onDelete} />
        <MarkPill id={item.id} marks={marks} />
      </div>
    </Reorder.Item>
  );
}

/** The positions of a quote or order: add from the catalog or free, titles and text blocks,
 *  inline edits (debounced), drag to reorder, subtotals per title. `readOnly` shows plain text. */
export function LineItemsEditor({
  docRef, readOnly, marks, onLocked,
}: {
  docRef: DocumentRef;
  readOnly: boolean;
  /** For an order: the lines that differ from its quote. */
  marks?: LineMarks;
  /** The database rejected a write because the document was locked meanwhile. */
  onLocked?: () => void;
}) {
  const { t } = useTranslation("werkbank");
  const { data: items } = useDocumentItems(docRef);
  const { add, update, remove, reorder } = useItemMutations(docRef, onLocked);
  const [order, setOrder] = useState<DocumentItem[]>(items ?? []);
  const [syncedItems, setSyncedItems] = useState(items);
  const [titleToDelete, setTitleToDelete] = useState<DocumentItem | null>(null);

  // A fresh server list replaces the local drag order (adjusting state while rendering).
  if (items !== syncedItems) {
    setSyncedItems(items);
    setOrder(items ?? []);
  }

  const subtotals = useMemo(() => sectionSubtotals(order), [order]);
  const nextSort = (items ?? []).reduce((max, i) => Math.max(max, i.sort_order + 10), 0);
  const addDraft = (draft: ItemDraft) => add.mutate({ draft, sortOrder: nextSort });

  const persistOrder = () => {
    const ids = order.map((i) => i.id);
    if (ids.join() !== (items ?? []).map((i) => i.id).join()) reorder.mutate(ids);
  };
  const requestDelete = (item: DocumentItem, index: number) => {
    const next = order[index + 1];
    if (item.kind === "title" && next && next.kind !== "title") setTitleToDelete(item);
    else remove.mutate(item.id);
  };

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <CatalogItemCombobox onPick={(c) => addDraft(snapshotDraft(c))} />
          <Button type="button" variant="outline" size="sm" onClick={() => addDraft(blankDraft("item"))}>
            <Plus className="mr-1 h-4 w-4" />{t("lineItems.addFree")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => addDraft(blankDraft("title"))}>{t("lineItems.addTitle")}</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => addDraft(blankDraft("text"))}>{t("lineItems.addText")}</Button>
        </div>
      )}

      {order.length === 0 ? (
        <p className="m-0 py-6 text-center text-muted-foreground">{t("lineItems.empty")}</p>
      ) : readOnly ? (
        <div>
          {order.map((item) => (
            <div key={item.id} data-row className="flex items-center gap-2 border-b px-3 py-2">
              <RowFields item={item} subtotal={subtotals.get(item.id)} readOnly saver={noSaver} update={noop} onDelete={noop} />
              <MarkPill id={item.id} marks={marks} />
            </div>
          ))}
        </div>
      ) : (
        <Reorder.Group
          axis="y"
          values={order}
          onReorder={setOrder}
        >
          {order.map((item, index) => (
            <EditableRow
              key={item.id}
              item={item}
              subtotal={subtotals.get(item.id)}
              marks={marks}
              update={update}
              onDelete={() => requestDelete(item, index)}
              onDragEnd={persistOrder}
            />
          ))}
        </Reorder.Group>
      )}

      <DeleteConfirmDialog
        open={!!titleToDelete}
        onOpenChange={(open) => !open && setTitleToDelete(null)}
        title={t("lineItems.deleteTitle")}
        body={t("lineItems.deleteTitleBody")}
        pending={remove.isPending}
        onConfirm={() => {
          if (titleToDelete) remove.mutate(titleToDelete.id);
          setTitleToDelete(null);
        }}
      />
    </div>
  );
}

const noop = () => {};
const noSaver = { schedule: noop, flush: noop, cancel: noop };
