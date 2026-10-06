import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/features/i18n/LanguageContext";
import { ORG_KINDS, ORG_KIND_LABELS, coerceOrgKind, isSwitchableByOrgAdmin, type OrgKind } from "@/lib/orgKind";

interface Props {
  id: string;
  value: OrgKind;
  onChange: (kind: OrgKind) => void;
  disabled?: boolean;
  /** Super-admin surfaces list every kind; org admins (the default) only see kinds they may switch to. */
  includeLocked?: boolean;
}

/** The one Workspace type picker, reused by Settings > Organization and the Platform org dialogs.
 *  Get running's WorkspaceStep does not use this component, it hand-rolls its own radio-card layout.
 *  Titles and descriptions come from the registry (ORG_KIND_LABELS), not from a locale file,
 *  so the edge mirror and the app can never disagree about what a kind is called.
 *  Locked kinds (not switchable by org admins) are hidden unless `includeLocked`; an org already
 *  on a locked kind sees a disabled select showing only that kind. */
export function OrgKindSelect({ id, value, onChange, disabled, includeLocked = false }: Props): JSX.Element {
  const { lang } = useLanguage();
  const currentLocked = !includeLocked && !isSwitchableByOrgAdmin(coerceOrgKind(value));
  const kinds = currentLocked ? [coerceOrgKind(value)] : includeLocked ? ORG_KINDS : ORG_KINDS.filter(isSwitchableByOrgAdmin);
  return (
    <Select value={value} onValueChange={(v) => onChange(coerceOrgKind(v))} disabled={disabled || currentLocked}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {kinds.map((kind) => (
          <SelectItem key={kind} value={kind}>
            <span className="flex flex-col">
              <span>{ORG_KIND_LABELS[kind][lang].title}</span>
              <span className="text-control text-muted-foreground">{ORG_KIND_LABELS[kind][lang].desc}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
