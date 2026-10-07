import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  createProperty,
  deleteProperty,
  fetchProperties,
  fetchPropertiesForCustomer,
  fetchProperty,
  setPropertyArchived,
  updateProperty,
} from "../data/properties";
import { mapDbError } from "../lib/dbErrors";
import type { PropertyForm } from "../schemas/property";

const PROPERTIES_KEY = ["werkbank", "properties"] as const;
const CUSTOMERS_KEY = ["werkbank", "customers"] as const;

export function useProperties() {
  const orgId = useAuth().currentOrg?.id;
  return useQuery({
    queryKey: [...PROPERTIES_KEY, orgId],
    enabled: !!orgId,
    queryFn: () => fetchProperties(supabase, orgId!),
  });
}

export function useProperty(id: string | undefined) {
  return useQuery({
    queryKey: [...PROPERTIES_KEY, "detail", id],
    enabled: !!id,
    queryFn: () => fetchProperty(supabase, id!),
  });
}

export function usePropertiesForCustomer(customerId: string | undefined) {
  return useQuery({
    queryKey: [...PROPERTIES_KEY, "customer", customerId],
    enabled: !!customerId,
    queryFn: () => fetchPropertiesForCustomer(supabase, customerId!),
  });
}

/** Shared mutation wiring: a database error toasts its translated copy, and every outcome
 *  refreshes the properties domain and the customers (their property counts change). */
function usePropertyMutation<V, R = void>(mutationFn: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  const { t } = useTranslation("werkbank");
  return useMutation({
    mutationFn,
    onError: (e) => toast.error(t(mapDbError(e))),
    onSettled: () =>
      Promise.all([qc.invalidateQueries({ queryKey: PROPERTIES_KEY }), qc.invalidateQueries({ queryKey: CUSTOMERS_KEY })]),
  });
}

export function useCreateProperty() {
  const orgId = useAuth().currentOrg?.id;
  return usePropertyMutation((form: PropertyForm) => createProperty(supabase, orgId!, form));
}

export function useUpdateProperty() {
  return usePropertyMutation((vars: { id: string; form: PropertyForm }) => updateProperty(supabase, vars.id, vars.form));
}

export function useArchiveProperty() {
  return usePropertyMutation((vars: { id: string; archived: boolean }) =>
    setPropertyArchived(supabase, vars.id, vars.archived),
  );
}

export function useDeleteProperty() {
  return usePropertyMutation((id: string) => deleteProperty(supabase, id));
}
