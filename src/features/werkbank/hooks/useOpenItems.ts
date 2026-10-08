import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { clearDunningHold, fetchDunningDue, fetchDunningHold, fetchDunningNotices, setDunningHold } from "../data/dunning";
import {
  fetchBalanceMap, fetchInvoiceBalance, fetchInvoiceEntries, fetchCustomerCredit, fetchOpenItems, fetchTransferTargets, recordInvoiceEntry, reverseInvoiceEntry, transferInvoiceEntry,
  type EntryKind, type WriteOffReason,
} from "../data/invoiceEntries";
import { mapDbError } from "../lib/dbErrors";
import { INVOICES_KEY } from "./useInvoices";

export const OPEN_ITEMS_KEY = ["werkbank", "open-items"] as const;

export type OpenItemsQuery = { search: string; customerId?: string; overdueOnly?: boolean };

function useOrgQuery<T>(parts: unknown[], enabled: boolean, fn: (orgId: string) => Promise<T>, keepPrevious = false) {
  const orgId = useAuth().currentOrg?.id;
  return useQuery({
    queryKey: [...OPEN_ITEMS_KEY, orgId, ...parts], enabled: !!orgId && enabled, queryFn: () => fn(orgId!),
    ...(keepPrevious ? { placeholderData: keepPreviousData } : {}),
  });
}

export const useInvoiceBalance = (invoiceId: string | undefined) =>
  useOrgQuery(["balance", invoiceId], !!invoiceId, (o) => fetchInvoiceBalance(supabase, o, invoiceId!));
export const useInvoiceEntries = (invoiceId: string | undefined) =>
  useOrgQuery(["entries", invoiceId], !!invoiceId, (o) => fetchInvoiceEntries(supabase, o, invoiceId!));
export const useOpenItems = (q: OpenItemsQuery) => useOrgQuery(["list", q], true, (o) => fetchOpenItems(supabase, o, q), true);
export const useBalanceMap = () => useOrgQuery(["balance-map"], true, (o) => fetchBalanceMap(supabase, o));
export const useCustomerCredit = () => useOrgQuery(["credit"], true, (o) => fetchCustomerCredit(supabase, o));
export const useDunningDue = () => useOrgQuery(["due"], true, (o) => fetchDunningDue(supabase, o));
export const useDunningNotices = (invoiceId: string | undefined) =>
  useOrgQuery(["notices", invoiceId], !!invoiceId, (o) => fetchDunningNotices(supabase, o, invoiceId!));
export const useDunningHold = (invoiceId: string | undefined) =>
  useOrgQuery(["hold", invoiceId], !!invoiceId, (o) => fetchDunningHold(supabase, o, invoiceId!));

/** Ledger and hold mutations: a database error toasts its translated copy, and every outcome
 *  refreshes open items and invoices (the invoice list shows the payment state). */
function useLedgerMutation<V, R>(mutationFn: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  const { t } = useTranslation("werkbank");
  return useMutation({
    mutationFn,
    onError: (e) => toast.error(t(mapDbError(e))),
    onSettled: () => Promise.all([OPEN_ITEMS_KEY, INVOICES_KEY].map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}

export const useRecordEntry = () =>
  useLedgerMutation((v: { invoiceId: string; kind: EntryKind; amount: number; bookedOn: string; note?: string; writeOffReason?: WriteOffReason }) =>
    recordInvoiceEntry(supabase, v));
export const useReverseEntry = () =>
  useLedgerMutation((v: { entryId: string; reason: string }) => reverseInvoiceEntry(supabase, v.entryId, v.reason));
export const useTransferEntry = () =>
  useLedgerMutation((v: { entryId: string; targetInvoiceId: string; reason: string }) =>
    transferInvoiceEntry(supabase, v.entryId, v.targetInvoiceId, v.reason));
export const useSetDunningHold = () =>
  useLedgerMutation((v: { invoiceId: string; reason: string; until: string | null }) => setDunningHold(supabase, v.invoiceId, v.reason, v.until));
export const useClearDunningHold = () => useLedgerMutation((invoiceId: string) => clearDunningHold(supabase, invoiceId));

/** Issued invoices of the customer a payment can move to; only asked for while the dialog is open. */
export const useTransferTargets = (customerId: string | undefined, excludeInvoiceId: string, enabled: boolean) =>
  useOrgQuery(["transfer-targets", customerId, excludeInvoiceId], !!customerId && enabled,
    (o) => fetchTransferTargets(supabase, o, customerId!, excludeInvoiceId));
