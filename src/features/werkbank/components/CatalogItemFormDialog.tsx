import { useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CatalogItem } from "../data/catalog";
import { useCreateCatalogItem, useUpdateCatalogItem } from "../hooks/useCatalog";
import { formatEuro } from "../lib/money";
import { UNIT_CODES, unitLabelKey, type UnitCode } from "../lib/units";
import { catalogItemSchema, type CatalogItemForm } from "../schemas/catalogItem";

const VAT_RATES = ["19", "7", "0"] as const;

const EMPTY: CatalogItemForm = {
  item_no: "",
  name: "",
  description: "",
  category: "",
  unit_code: "HUR",
  labour_price: "",
  material_price: "",
  vat_rate: "19",
};

/** An amount as typed, in cents; anything that is not a valid amount counts as 0. */
function toCents(value: string): number {
  const n = Number(value.trim().replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}

function priceText(n: number, lang: string): string {
  const text = n.toFixed(2);
  return lang.startsWith("de") ? text.replace(".", ",") : text;
}

function toFormValues(item: CatalogItem, lang: string): CatalogItemForm {
  return {
    item_no: item.item_no ?? "",
    name: item.name,
    description: item.description ?? "",
    category: item.category ?? "",
    unit_code: (UNIT_CODES as readonly string[]).includes(item.unit_code) ? (item.unit_code as UnitCode) : "HUR",
    labour_price: priceText(Number(item.labour_price), lang),
    material_price: priceText(Number(item.material_price), lang),
    vat_rate: String(item.vat_rate) as CatalogItemForm["vat_rate"],
  };
}

/** Create (no `item`) or edit (`item`) a catalog item. Owns its mutations and closes on success;
 *  a failed save keeps the dialog open (the hooks toast the error). */
export function CatalogItemFormDialog({
  open,
  onOpenChange,
  item,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: CatalogItem | null;
}) {
  const { t, i18n } = useTranslation("werkbank");
  const create = useCreateCatalogItem();
  const update = useUpdateCatalogItem();
  const schema = useMemo(() => catalogItemSchema(t), [t]);
  const form = useForm<CatalogItemForm>({ resolver: zodResolver(schema), defaultValues: EMPTY });
  // Two quick submits can both pass validation before `isPending` renders; this guard keeps one
  // attempt to one write.
  const submitting = useRef(false);

  useEffect(() => {
    if (open) form.reset(item ? toFormValues(item, i18n.language) : EMPTY);
    else form.reset(EMPTY);
  }, [open, item, form, i18n.language]);

  const [labour, material] = form.watch(["labour_price", "material_price"]);
  const net = formatEuro((toCents(labour) + toCents(material)) / 100, i18n.language);

  const pending = create.isPending || update.isPending;
  const submit = form.handleSubmit((values) => {
    if (submitting.current) return;
    submitting.current = true;
    const options = {
      onSuccess: () => onOpenChange(false),
      onSettled: () => {
        submitting.current = false;
      },
    };
    if (item) update.mutate({ id: item.id, form: values }, options);
    else create.mutate(values, options);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? t("catalog.dialog.editTitle") : t("catalog.dialog.createTitle")}</DialogTitle>
          <DialogDescription>{t("catalog.dialog.description")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="item_no"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("catalog.dialog.itemNo")}</FormLabel>
                    <FormControl>
                      <Input autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("catalog.dialog.category")}</FormLabel>
                    <FormControl>
                      <Input autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("catalog.dialog.name")}</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("catalog.dialog.descriptionField")}</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="unit_code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("catalog.dialog.unit")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {UNIT_CODES.map((code) => (
                          <SelectItem key={code} value={code}>
                            {t(unitLabelKey(code))}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="vat_rate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("catalog.dialog.vat")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {VAT_RATES.map((rate) => (
                          <SelectItem key={rate} value={rate}>
                            {rate} %
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="labour_price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("catalog.dialog.labour")}</FormLabel>
                    <FormControl>
                      <Input inputMode="decimal" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="material_price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("catalog.dialog.material")}</FormLabel>
                    <FormControl>
                      <Input inputMode="decimal" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <p className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">{t("catalog.dialog.net")}</span>
              <span data-testid="net-total" className="font-medium tabular-nums">
                {net}
              </span>
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
