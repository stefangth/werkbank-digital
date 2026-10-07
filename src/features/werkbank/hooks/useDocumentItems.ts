import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  addItem, deleteItem, fetchItems, refKey, reorderItems, updateItem, type DocumentRef, type ItemDraft,
} from "../data/documentItems";
import { mapDbError } from "../lib/dbErrors";
import { ORDERS_KEY } from "./useOrders";
import { QUOTES_KEY } from "./useQuotes";

const ITEMS_KEY = ["werkbank", "items"] as const;

export function useDocumentItems(ref: DocumentRef | undefined) {
  return useQuery({
    queryKey: [...ITEMS_KEY, ref ? refKey(ref) : undefined],
    enabled: !!ref,
    queryFn: () => fetchItems(supabase, ref!),
  });
}

/** Item mutations of one document. Every outcome refreshes the items and the parent's domain
 *  (quotes or orders), because the totals live on the parent. `onLocked` runs when the database
 *  rejects a write because the document was locked meanwhile (sent quote, closed order). */
export function useItemMutations(ref: DocumentRef, onLocked?: () => void) {
  const orgId = useAuth().currentOrg?.id;
  const qc = useQueryClient();
  const { t } = useTranslation("werkbank");
  const key = [...ITEMS_KEY, refKey(ref)] as const;

  function useWiring<V, R>(mutationFn: (vars: V) => Promise<R>) {
    return useMutation({
      mutationFn,
      onError: (e) => {
        const key = mapDbError(e);
        toast.error(t(key));
        if (key === "errors.quoteLocked" || key === "errors.orderLocked") onLocked?.();
      },
      onSettled: () => Promise.all([key, "orderId" in ref ? ORDERS_KEY : QUOTES_KEY].map((queryKey) => qc.invalidateQueries({ queryKey }))),
    });
  }

  return {
    add: useWiring((vars: { draft: ItemDraft; sortOrder: number }) => addItem(supabase, orgId!, ref, vars.draft, vars.sortOrder)),
    update: useWiring((vars: { id: string; patch: Partial<ItemDraft> }) => updateItem(supabase, vars.id, vars.patch)),
    remove: useWiring((id: string) => deleteItem(supabase, id)),
    reorder: useWiring((ids: string[]) => reorderItems(supabase, ref, ids)),
  };
}
