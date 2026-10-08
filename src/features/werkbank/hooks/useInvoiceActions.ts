import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { invoiceDownloadUrl, issueInvoice, previewInvoice, sendInvoice, type InvoiceSendBody } from "../data/invoiceActions";
import { INVOICES_KEY } from "./useInvoices";
import { RANGES_KEY } from "./useNumberRanges";
import { ORDERS_KEY } from "./useOrders";

/** Issue: draws the number and may flip the order to invoiced, so it refreshes the invoices, orders and
 *  numbering domains. Errors are left to the caller, which shows them in context (InvoiceActionError). */
export function useIssueInvoice() {
  const orgId = useAuth().currentOrg?.id;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { invoiceId: string; send?: InvoiceSendBody }) => issueInvoice(supabase, orgId!, vars.invoiceId, vars.send),
    // Also after a failure: render_failed and send_failed leave the invoice issued.
    onSettled: () => Promise.all([INVOICES_KEY, ORDERS_KEY, RANGES_KEY].map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}

export function useSendInvoice() {
  const orgId = useAuth().currentOrg?.id;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { invoiceId: string; body: InvoiceSendBody }) => sendInvoice(supabase, orgId!, vars.invoiceId, vars.body),
    onSettled: () => qc.invalidateQueries({ queryKey: INVOICES_KEY }),
  });
}

/** Resolves to the base64 of the watermarked draft PDF. */
export function usePreviewInvoice() {
  const orgId = useAuth().currentOrg?.id;
  return useMutation({ mutationFn: (invoiceId: string) => previewInvoice(supabase, orgId!, invoiceId) });
}

export function useInvoiceDownload() {
  const orgId = useAuth().currentOrg?.id;
  return useMutation({ mutationFn: (invoiceId: string) => invoiceDownloadUrl(supabase, orgId!, invoiceId) });
}
