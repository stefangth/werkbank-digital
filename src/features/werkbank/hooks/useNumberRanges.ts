import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { fetchNumberRange, saveNumberRange, type NumberRangeKey, type NumberRangeSave } from "../data/numberRanges";
import { mapDbError } from "../lib/dbErrors";

/** Customer create and import advance the customer range, so they invalidate this key too. */
export const RANGES_KEY = ["werkbank", "number-ranges"] as const;

export function useNumberRange(key: NumberRangeKey) {
  const orgId = useAuth().currentOrg?.id;
  return useQuery({
    queryKey: [...RANGES_KEY, orgId, key],
    enabled: !!orgId,
    queryFn: () => fetchNumberRange(supabase, orgId!, key),
  });
}

export function useSaveNumberRange(key: NumberRangeKey) {
  const orgId = useAuth().currentOrg?.id;
  const qc = useQueryClient();
  const { t } = useTranslation("werkbank");
  return useMutation({
    mutationFn: (values: NumberRangeSave) => saveNumberRange(supabase, orgId!, key, values),
    onSuccess: () => toast.success(t("numbering.saved")),
    onError: (e) => toast.error(t(mapDbError(e))),
    onSettled: () => qc.invalidateQueries({ queryKey: RANGES_KEY }),
  });
}
