import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchStartCounts } from "../data/startList";

/** Counts for the dashboard start list. staleTime 0 (stated, not left to the default) makes
 *  the list refetch whenever the dashboard mounts, so rows created on the technician,
 *  catalog or customer pages show up without those mutations knowing about this key. */
export function useStartList(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["werkbank", "startList", orgId],
    enabled: !!orgId,
    staleTime: 0,
    queryFn: () => fetchStartCounts(supabase, orgId!),
  });
}
