import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useLanguage } from "@/features/i18n/LanguageContext";
import { setOrgKind } from "@/data/orgs";
import { ORG_KINDS, ORG_KIND_LABELS, DEFAULT_ORG_KIND, isSwitchableByOrgAdmin, type OrgKind } from "@/lib/orgKind";
import { WizardFooterAction } from "@/components/getRunning/v3/WizardFooterAction";
import { Card } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The `workspace` step body (first step of Get dates in): pick the workspace type.
 * Preselects the org's stored kind; Continue always saves (even the default) because the
 * step's done signal is "an admin decided", not "the value differs from the default".
 * Admin-only: producers see the choice read-only with a note, like SourceStep's readOnly.
 */
export function WorkspaceStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const { lang } = useLanguage();
  const { currentOrg, refreshOrgs, hasRole } = useAuth();
  const canChoose = hasRole("admin");
  const [selected, setSelected] = useState<OrgKind | null>(null);
  const active: OrgKind = selected ?? currentOrg?.org_kind ?? DEFAULT_ORG_KIND;
  // An org already on a kind org admins cannot switch to sees that kind read-only and nothing is saved.
  const lockedCurrent = !isSwitchableByOrgAdmin(active);
  const cardKinds = lockedCurrent ? [active] : ORG_KINDS.filter(isSwitchableByOrgAdmin);
  const choosable = canChoose && !lockedCurrent;

  const save = useMutation({
    mutationFn: (kind: OrgKind) => setOrgKind(supabase, orgId as string, kind),
    onSuccess: async () => {
      await refreshOrgs();
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const continueButton = (
    <Button type="button" size="sm" disabled={!orgId || save.isPending} onClick={() => (lockedCurrent ? onDone() : save.mutate(active))}>
      {t("body.workspace.continue")}
    </Button>
  );

  return (
    <div data-testid="step-body-workspace" className="space-y-3">
      <RadioGroup
        value={active}
        onValueChange={(v) => setSelected(v as OrgKind)}
        aria-label={t("body.workspace.heading")}
        className="gap-2"
      >
        {cardKinds.map((kind) => (
          <Card
            key={kind}
            className={cn(
              "px-3 py-2.5",
              active === kind && "border-primary ring-1 ring-primary",
              !choosable && "opacity-60",
            )}
          >
            <label
              htmlFor={`workspace-${kind}`}
              className={cn("flex items-start gap-2.5", choosable ? "cursor-pointer" : "cursor-not-allowed")}
            >
              <RadioGroupItem id={`workspace-${kind}`} value={kind} disabled={!choosable} className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span className="text-control font-medium text-foreground">{ORG_KIND_LABELS[kind][lang].title}</span>
                <span className="text-xs text-muted-foreground">{ORG_KIND_LABELS[kind][lang].desc}</span>
              </span>
            </label>
          </Card>
        ))}
      </RadioGroup>
      {canChoose ? (
        <WizardFooterAction>{continueButton}</WizardFooterAction>
      ) : (
        <p className="text-xs text-muted-foreground">{t("body.workspace.readOnly")}</p>
      )}
    </div>
  );
}
