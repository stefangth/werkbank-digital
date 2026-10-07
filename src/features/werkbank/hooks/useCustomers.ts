import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  createCustomer,
  deleteCustomer,
  fetchCustomer,
  fetchCustomers,
  setCustomerArchived,
  updateCustomer,
} from "../data/customers";
import { mapDbError } from "../lib/dbErrors";
import { RANGES_KEY } from "./useNumberRanges";
import type { CustomerForm } from "../schemas/customer";

const CUSTOMERS_KEY = ["werkbank", "customers"] as const;

export function useCustomers() {
  const orgId = useAuth().currentOrg?.id;
  return useQuery({
    queryKey: [...CUSTOMERS_KEY, orgId],
    enabled: !!orgId,
    queryFn: () => fetchCustomers(supabase, orgId!),
  });
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: [...CUSTOMERS_KEY, "detail", id],
    enabled: !!id,
    queryFn: () => fetchCustomer(supabase, id!),
  });
}

/** Shared mutation wiring: a database error toasts its translated copy, and every outcome
 *  refreshes the customers domain (list and detail) plus any `alsoInvalidate` keys. */
function useCustomerMutation<V, R = void>(
  mutationFn: (vars: V) => Promise<R>,
  alsoInvalidate: readonly (readonly unknown[])[] = [],
) {
  const qc = useQueryClient();
  const { t } = useTranslation("werkbank");
  return useMutation({
    mutationFn,
    onError: (e) => toast.error(t(mapDbError(e))),
    onSettled: () =>
      Promise.all([CUSTOMERS_KEY, ...alsoInvalidate].map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}

/** A new customer may take a number from the range, so the numbering tab is refreshed too. */
export function useCreateCustomer() {
  const orgId = useAuth().currentOrg?.id;
  return useCustomerMutation((form: CustomerForm) => createCustomer(supabase, orgId!, form), [RANGES_KEY]);
}

/** Runs after a customer import: refreshes the customers domain and the customer number range,
 *  which the import advances. */
export function useRefreshAfterCustomerImport() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: CUSTOMERS_KEY });
    void qc.invalidateQueries({ queryKey: RANGES_KEY });
  };
}

export function useUpdateCustomer() {
  return useCustomerMutation((vars: { id: string; form: CustomerForm }) => updateCustomer(supabase, vars.id, vars.form));
}

export function useArchiveCustomer() {
  return useCustomerMutation((vars: { id: string; archived: boolean }) =>
    setCustomerArchived(supabase, vars.id, vars.archived),
  );
}

export function useDeleteCustomer() {
  return useCustomerMutation((id: string) => deleteCustomer(supabase, id));
}
