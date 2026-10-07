import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { fetchCompanyProfile, type CompanyProfile, logoUrl, saveCompanyProfile, uploadLogo } from "../data/companyProfile";
import { mapDbError } from "../lib/dbErrors";
import type { CompanyProfileRow } from "../schemas/companyProfile";

const KEY = ["werkbank", "company-profile"] as const;

export function useCompanyProfile() {
  const orgId = useAuth().currentOrg?.id;
  return useQuery({
    queryKey: [...KEY, orgId],
    enabled: !!orgId,
    queryFn: () => fetchCompanyProfile(supabase, orgId!),
  });
}

export function useSaveCompanyProfile() {
  const orgId = useAuth().currentOrg?.id;
  const qc = useQueryClient();
  const { t } = useTranslation("werkbank");
  return useMutation({
    mutationFn: (row: CompanyProfileRow) => {
      // The stored logo, so a replaced or removed one is cleaned up after the save.
      const stored = qc.getQueryData<CompanyProfile | null>([...KEY, orgId]);
      return saveCompanyProfile(supabase, orgId!, row, stored?.logo_path);
    },
    onSuccess: () => toast.success(t("company.saved")),
    onError: (e) => toast.error(t(mapDbError(e))),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUploadLogo() {
  const orgId = useAuth().currentOrg?.id;
  const { t } = useTranslation("werkbank");
  return useMutation({
    mutationFn: (file: File) => uploadLogo(supabase, orgId!, file),
    onError: () => toast.error(t("company.logo.uploadFailed")),
  });
}

/** Signed preview URL of a stored logo; refreshed before the 600 s expiry. */
export function useLogoUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: [...KEY, "logo-url", path],
    enabled: !!path,
    staleTime: 5 * 60 * 1000,
    queryFn: () => logoUrl(supabase, path!),
  });
}
