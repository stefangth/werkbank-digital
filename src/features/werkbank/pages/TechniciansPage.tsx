import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HardHat } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { usePendingArtistInvitations } from "@/hooks/usePendingArtistInvitations";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import type { Tone } from "@/components/ui/tones";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddTechnicianDialog } from "../components/AddTechnicianDialog";
import { TechnicianInviteError, type TechnicianAccount } from "../data/technicians";
import { useCreateTechnician, useTechnicianInvitationActions, useTechnicians } from "../hooks/useTechnicians";

const ACCOUNT_TONE: Record<TechnicianAccount, Tone> = {
  active: "confirmed",
  invited: "waiting",
  none: "neutral",
};

/** Office view of the org's technicians: who has an app account, who is invited, and the
 *  add-and-invite flow. */
export function TechniciansPage() {
  const { t } = useTranslation("werkbank");
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id;
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: technicians, isLoading, isError } = useTechnicians(orgId);
  const { data: pendingInvitations, isError: invitationsFailed } = usePendingArtistInvitations(orgId);
  const canAdd = useCan("add_artists");
  const create = useCreateTechnician(orgId);
  const { invite, resend, revoke } = useTechnicianInvitationActions(orgId);
  // Two quick submits can both pass form validation before `isPending` renders; this guard
  // keeps one attempt to one insert.
  const submitting = useRef(false);

  const invitationByArtist = useMemo(() => {
    const map = new Map<string, string>();
    (pendingInvitations ?? []).forEach((inv) => {
      if (inv.artistId) map.set(inv.artistId, inv.id);
    });
    return map;
  }, [pendingInvitations]);

  const openDialog = () => setDialogOpen(true);

  const submitTechnician = (values: { name: string; email: string; phone: string | null }) => {
    if (submitting.current) return;
    submitting.current = true;
    create.mutate(values, {
      onSuccess: () => setDialogOpen(false),
      // The row was saved even though the invite failed: close, so a retry cannot insert it again.
      onError: (e) => {
        if (e instanceof TechnicianInviteError) setDialogOpen(false);
      },
      onSettled: () => {
        submitting.current = false;
      },
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("technicians.title")}
        sub={t("technicians.sub")}
        actions={canAdd ? <Button onClick={openDialog}>{t("technicians.add")}</Button> : undefined}
      />

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("technicians.loadFailed")}
        </p>
      ) : !technicians || technicians.length === 0 ? (
        <EmptyState
          icon={HardHat}
          title={t("technicians.empty.title")}
          body={canAdd ? t("technicians.empty.body") : t("technicians.empty.reason")}
          {...(canAdd
            ? { action: { label: t("technicians.empty.action"), onClick: openDialog } }
            : { reason: t("technicians.empty.reason") })}
        />
      ) : (
        <>
        {invitationsFailed && (
          <p role="alert" className="text-sm text-destructive">
            {t("technicians.invitationsFailed")}
          </p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("technicians.columns.name")}</TableHead>
              <TableHead>{t("technicians.columns.email")}</TableHead>
              <TableHead>{t("technicians.columns.phone")}</TableHead>
              <TableHead>{t("technicians.columns.account")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("technicians.columns.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {technicians.map((tech) => {
              const invitationId = tech.account === "invited" ? invitationByArtist.get(tech.id) : undefined;
              return (
                <TableRow key={tech.id}>
                  <TableCell className="font-medium">{tech.name}</TableCell>
                  <TableCell>{tech.email}</TableCell>
                  <TableCell>{tech.phone}</TableCell>
                  <TableCell>
                    <StatusPill tone={ACCOUNT_TONE[tech.account]}>{t(`technicians.account.${tech.account}`)}</StatusPill>
                  </TableCell>
                  <TableCell>
                    {tech.account === "none" && tech.email && (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={invite.isPending}
                          onClick={() => invite.mutate({ artistId: tech.id, email: tech.email! })}
                        >
                          {t("technicians.actions.invite")}
                        </Button>
                      </div>
                    )}
                    {invitationId && (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={resend.isPending}
                          onClick={() => resend.mutate(invitationId)}
                        >
                          {t("technicians.actions.resend")}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={revoke.isPending}
                          onClick={() => revoke.mutate(invitationId)}
                        >
                          {t("technicians.actions.revoke")}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </>
      )}

      <AddTechnicianDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        submitting={create.isPending}
        onSubmit={submitTechnician}
      />
    </div>
  );
}
