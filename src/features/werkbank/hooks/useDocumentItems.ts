import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  addItem, deleteItem, fetchItems, refKey, reorderItems, updateItem, type DocumentRef, type ItemDraft,
} from "../data/documentItems";
import { mapDbError } from "../lib/dbErrors";
import { QUOTES_KEY } from "./useQuotes";

const ITEMS_KEY = ["werkbank", "items"] as const;

export function useDocumentItems(ref: DocumentRef | undefined) {
  return useQuery({
    queryKey: [...ITEMS_KEY, ref ? refKey(ref) : undefined],
    enabled: !!ref,
    queryFn: () => fetchItems(supabase, ref!),
  });
}

/** Item mutations of one document. Every outcome refreshes the items and the quotes domain,
 *  because the totals live on the parent. */
export function useItemMutations(ref: DocumentRef) {
  const orgId = useAuth().currentOrg?.id;
  const qc = useQueryClient();
  const { t } = useTranslation("werkbank");
  const key = [...ITEMS_KEY, refKey(ref)] as const;

  function useWiring<V, R>(mutationFn: (vars: V) => Promise<R>) {
    return useMutation({
      mutationFn,
      onError: (e) => toast.error(t(mapDbError(e))),
      onSettled: () => Promise.all([key, QUOTES_KEY].map((queryKey) => qc.invalidateQueries({ queryKey }))),
    });
  }

  return {
    add: useWiring((vars: { draft: ItemDraft; sortOrder: number }) => addItem(supabase, orgId!, ref, vars.draft, vars.sortOrder)),
    update: useWiring((vars: { id: string; patch: Partial<ItemDraft> }) => updateItem(supabase, vars.id, vars.patch)),
    remove: useWiring((id: string) => deleteItem(supabase, id)),
    reorder: useWiring((ids: string[]) => reorderItems(supabase, ref, ids)),
  };
}
