import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  cancelInvoice, copyInvoice, createFreeInvoice, createInvoiceFromOrder, deleteInvoice, fetchActiveInvoiceForOrder,
  fetchCancellationOf, fetchInvoice, fetchInvoices, updateInvoice, type InvoiceDefaults, type InvoiceListQuery, type InvoicePatch,
} from "../data/invoices";
import { mapDbError } from "../lib/dbErrors";
import { RANGES_KEY } from "./useNumberRanges";
import { ORDERS_KEY } from "./useOrders";

export const INVOICES_KEY = ["werkbank", "invoices"] as const;

export function useInvoices(query: InvoiceListQuery) {
  const orgId = useAuth().currentOrg?.id;
  return useQuery({
    queryKey: [...INVOICES_KEY, orgId, query],
    enabled: !!orgId,
    queryFn: () => fetchInvoices(supabase, orgId!, query),
  });
}

export function useInvoice(id: string | undefined) {
  const orgId = useAuth().currentOrg?.id;
  return useQuery({
    queryKey: [...INVOICES_KEY, orgId, "detail", id],
    enabled: !!orgId && !!id,
    queryFn: () => fetchInvoice(supabase, orgId!, id!),
  });
}

/** The live invoice of an order, for the order page's "Rechnung" link. */
export function useActiveInvoiceForOrder(orderId: string | undefined) {
  const orgId = useAuth().currentOrg?.id;
  return useQuery({
    queryKey: [...INVOICES_KEY, orgId, "for-order", orderId],
    enabled: !!orgId && !!orderId,
    queryFn: () => fetchActiveInvoiceForOrder(supabase, orgId!, orderId!),
  });
}

/** The cancellation document of an invoice (the "cancelled by" link); only asked for when `enabled`. */
export function useCancellationOf(invoiceId: string | undefined, enabled: boolean) {
  const orgId = useAuth().currentOrg?.id;
  return useQuery({
    queryKey: [...INVOICES_KEY, orgId, "cancellation-of", invoiceId],
    enabled: !!orgId && !!invoiceId && enabled,
    queryFn: () => fetchCancellationOf(supabase, orgId!, invoiceId!),
  });
}

/** All invoice mutations: a database error toasts its translated copy, and every outcome refreshes
 *  the invoices domain. Those that can change an order's status (from order, cancel) refresh orders
 *  too; creating or copying draws no number (numbers are assigned on issue). */
export function useInvoiceMutations() {
  const orgId = useAuth().currentOrg?.id;
  const qc = useQueryClient();
  const { t } = useTranslation("werkbank");

  function useWiring<V, R>(mutationFn: (vars: V) => Promise<R>, alsoRefresh: (readonly string[])[] = []) {
    return useMutation({
      mutationFn,
      onError: (e) => toast.error(t(mapDbError(e))),
      onSettled: () => Promise.all([INVOICES_KEY, ...alsoRefresh].map((queryKey) => qc.invalidateQueries({ queryKey }))),
    });
  }

  return {
    create: useWiring((vars: { customerId: string; propertyId?: string | null; profile: InvoiceDefaults | null }) => createFreeInvoice(supabase, orgId!, vars)),
    update: useWiring((vars: { id: string; patch: InvoicePatch }) => updateInvoice(supabase, orgId!, vars.id, vars.patch)),
    remove: useWiring((id: string) => deleteInvoice(supabase, orgId!, id)),
    fromOrder: useWiring((orderId: string) => createInvoiceFromOrder(supabase, orderId), [ORDERS_KEY]),
    cancel: useWiring((id: string) => cancelInvoice(supabase, id), [ORDERS_KEY, RANGES_KEY]),
    copy: useWiring((id: string) => copyInvoice(supabase, id)),
  };
}
