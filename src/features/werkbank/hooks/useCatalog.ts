import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  createCatalogItem,
  deleteCatalogItem,
  fetchCatalogItems,
  setCatalogItemArchived,
  updateCatalogItem,
} from "../data/catalog";
import { mapDbError } from "../lib/dbErrors";
import type { CatalogItemForm } from "../schemas/catalogItem";

const CATALOG_KEY = ["werkbank", "catalog"] as const;

export function useCatalogItems() {
  const orgId = useAuth().currentOrg?.id;
  return useQuery({
    queryKey: [...CATALOG_KEY, orgId],
    enabled: !!orgId,
    queryFn: () => fetchCatalogItems(supabase, orgId!),
  });
}

/** Shared mutation wiring: a database error toasts its translated copy, and every outcome
 *  refreshes the catalog domain. */
function useCatalogMutation<V>(mutationFn: (vars: V) => Promise<void>) {
  const qc = useQueryClient();
  const { t } = useTranslation("werkbank");
  return useMutation({
    mutationFn,
    onError: (e) => toast.error(t(mapDbError(e))),
    onSettled: () => qc.invalidateQueries({ queryKey: CATALOG_KEY }),
  });
}

export function useCreateCatalogItem() {
  const orgId = useAuth().currentOrg?.id;
  return useCatalogMutation((form: CatalogItemForm) => createCatalogItem(supabase, orgId!, form));
}

export function useUpdateCatalogItem() {
  return useCatalogMutation((vars: { id: string; form: CatalogItemForm }) =>
    updateCatalogItem(supabase, vars.id, vars.form),
  );
}

export function useArchiveCatalogItem() {
  return useCatalogMutation((vars: { id: string; archived: boolean }) =>
    setCatalogItemArchived(supabase, vars.id, vars.archived),
  );
}

export function useDeleteCatalogItem() {
  return useCatalogMutation((id: string) => deleteCatalogItem(supabase, id));
}
