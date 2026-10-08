import { ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Skeleton } from "@/components/ui/skeleton";
import { DefaultHint } from "../components/DefaultHint";
import { useAssignments } from "../hooks/useAssignments";
import { groupAssignments, type GroupKey } from "../lib/assignments";
import { AssignmentCard } from "./AssignmentCard";
import { InstallHint } from "./InstallHint";
import { MobileShell } from "./MobileShell";
import { TechnicianRoute } from "./TechnicianRoute";

const HINTED: Partial<Record<GroupKey, "upcoming" | "done">> = { upcoming: "upcoming", done: "done" };

function List() {
  const { t } = useTranslation("werkbank");
  const { data, isLoading, isError } = useAssignments();
  if (isLoading) return <Skeleton role="status" aria-busy="true" className="h-40 w-full" />;
  if (isError) return <Alert variant="destructive">{t("app.loadFailed")}</Alert>;
  const groups = groupAssignments(data ?? []);
  if (groups.length === 0) {
    return <EmptyState icon={ClipboardList} title={t("app.emptyTitle")} body={t("app.emptyBody")} reason={t("app.emptyReason")} />;
  }
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`group-${g.key}`}>
          <div className="mb-2 flex items-center gap-1.5">
            <h2 id={`group-${g.key}`} className="m-0"><Eyebrow>{t(`app.groups.${g.key}`)}</Eyebrow></h2>
            {HINTED[g.key] && <DefaultHint text={t(`app.groupHints.${HINTED[g.key]}`)} />}
          </div>
          <ul className="m-0 list-none space-y-2 p-0">
            {g.rows.map((r) => <li key={r.id}><AssignmentCard row={r} /></li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The technician's list of assigned orders, grouped by the server's group key. */
export function AssignmentsPage() {
  const { t } = useTranslation("werkbank");
  return (
    <MobileShell title={t("app.assignmentsTitle")}>
      <TechnicianRoute>
        <InstallHint />
        <List />
      </TechnicianRoute>
    </MobileShell>
  );
}
