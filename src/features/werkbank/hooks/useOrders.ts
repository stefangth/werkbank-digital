import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  createOrder, createOrderFromQuote, deleteOrder, fetchOrder, fetchOrderIdForQuote, fetchOrderList, setOrderStatus, setOrderTechnicians, updateOrder,
  type Order, type OrderDraft, type OrderPatch,
} from "../data/orders";
import { mapDbError } from "../lib/dbErrors";
import { RANGES_KEY } from "./useNumberRanges";
import { QUOTES_KEY } from "./useQuotes";

export const ORDERS_KEY = ["werkbank", "orders"] as const;

export function useOrderList() {
  const orgId = useAuth().currentOrg?.id;
  return useQuery({
    queryKey: [...ORDERS_KEY, orgId],
    enabled: !!orgId,
    queryFn: () => fetchOrderList(supabase, orgId!),
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: [...ORDERS_KEY, "detail", id],
    enabled: !!id,
    queryFn: () => fetchOrder(supabase, id!),
  });
}

/** The order made from a quote, if any; the quote page links to it. */
export function useOrderIdForQuote(quoteId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...ORDERS_KEY, "for-quote", quoteId],
    enabled: !!quoteId && enabled,
    queryFn: () => fetchOrderIdForQuote(supabase, quoteId!),
  });
}

/** All order mutations: a database error toasts its translated copy, and every outcome refreshes
 *  the orders domain. Creating draws a number; creating from a quote also changes the quote's
 *  `has_order`, so the quotes domain is refreshed too. */
export function useOrderMutations() {
  const orgId = useAuth().currentOrg?.id;
  const qc = useQueryClient();
  const { t } = useTranslation("werkbank");

  function useWiring<V, R>(mutationFn: (vars: V) => Promise<R>, extraKeys: ReadonlyArray<readonly string[]> = []) {
    return useMutation({
      mutationFn,
      onError: (e) => toast.error(t(mapDbError(e))),
      onSettled: () => Promise.all([ORDERS_KEY, ...extraKeys].map((queryKey) => qc.invalidateQueries({ queryKey }))),
    });
  }

  return {
    create: useWiring((draft: OrderDraft) => createOrder(supabase, orgId!, draft), [RANGES_KEY]),
    createFromQuote: useWiring((quoteId: string) => createOrderFromQuote(supabase, quoteId), [QUOTES_KEY, RANGES_KEY]),
    update: useWiring((vars: { id: string; patch: OrderPatch }) => updateOrder(supabase, vars.id, vars.patch)),
    setStatus: useWiring((vars: { id: string; status: Order["status"] }) => setOrderStatus(supabase, vars.id, vars.status)),
    // An order made from a quote frees the quote again (`has_order`), so quotes refresh too.
    remove: useWiring((id: string) => deleteOrder(supabase, id), [QUOTES_KEY]),
    setTechnicians: useWiring((vars: { orderId: string; artistIds: string[] }) =>
      setOrderTechnicians(supabase, orgId!, vars.orderId, vars.artistIds)),
  };
}
