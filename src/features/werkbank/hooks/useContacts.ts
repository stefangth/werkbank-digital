import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  createContact,
  deleteContact,
  fetchContacts,
  setPrimaryContact,
  updateContact,
  type ContactParent,
} from "../data/contacts";
import { mapDbError } from "../lib/dbErrors";
import type { ContactForm } from "../schemas/contact";

const CONTACTS_KEY = ["werkbank", "contacts"] as const;

/** `["werkbank","contacts","customer" | "property", parentId]` */
const parentKey = (parent: ContactParent) =>
  "customerId" in parent ? (["customer", parent.customerId] as const) : (["property", parent.propertyId] as const);

export function useContacts(parent: ContactParent | undefined) {
  return useQuery({
    queryKey: [...CONTACTS_KEY, ...(parent ? parentKey(parent) : [])],
    enabled: !!parent,
    queryFn: () => fetchContacts(supabase, parent!),
  });
}

/** Shared mutation wiring: a database error toasts its translated copy, and every outcome
 *  refreshes the contacts domain. */
function useContactMutation<V, R = void>(mutationFn: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  const { t } = useTranslation("werkbank");
  return useMutation({
    mutationFn,
    onError: (e) => toast.error(t(mapDbError(e))),
    onSettled: () => qc.invalidateQueries({ queryKey: CONTACTS_KEY }),
  });
}

export function useCreateContact() {
  const orgId = useAuth().currentOrg?.id;
  return useContactMutation((vars: { parent: ContactParent; form: ContactForm }) =>
    createContact(supabase, orgId!, vars.parent, vars.form),
  );
}

export function useUpdateContact() {
  return useContactMutation((vars: { parent: ContactParent; id: string; form: ContactForm }) =>
    updateContact(supabase, vars.parent, vars.id, vars.form),
  );
}

export function useSetPrimaryContact() {
  return useContactMutation((vars: { parent: ContactParent; id: string }) =>
    setPrimaryContact(supabase, vars.parent, vars.id),
  );
}

export function useDeleteContact() {
  return useContactMutation((id: string) => deleteContact(supabase, id));
}
