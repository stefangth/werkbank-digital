import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Textarea } from "@/components/ui/textarea";
import type { Order, OrderPatch } from "../data/orders";
import { DocumentHeaderFields, Fact, FormField } from "./DocumentHeaderFields";

/** The order's header fields: the shared document header plus notes. Saves like the quote
 *  header (text on leaving the field, pickers at once); read only it is plain text. */
export function OrderHeaderForm({
  order, readOnly, names, onPatch,
}: {
  order: Order;
  readOnly: boolean;
  names: { customer: string | null; property: string | null };
  onPatch: (patch: OrderPatch) => void;
}) {
  const { t } = useTranslation("werkbank");
  const [notes, setNotes] = useState(order.notes ?? "");

  if (readOnly) {
    return (
      <dl className="m-0 grid gap-x-6 gap-y-3 text-sm md:grid-cols-2">
        <DocumentHeaderFields doc={order} readOnly idPrefix="order" names={names} onPatch={onPatch} />
        <Fact label={t("orders.header.notes")}>{order.notes ?? t("quotes.header.none")}</Fact>
      </dl>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <DocumentHeaderFields doc={order} readOnly={false} idPrefix="order" names={names} onPatch={onPatch} />
      <div className="md:col-span-2">
        <FormField id="order-notes" label={t("orders.header.notes")}>
          <Textarea
            id="order-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              const value = notes.trim();
              if (value !== (order.notes ?? "")) onPatch({ notes: value === "" ? null : value });
            }}
          />
        </FormField>
      </div>
    </div>
  );
}
