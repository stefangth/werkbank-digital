import { CircleHelp } from "lucide-react";
import { IconTooltip } from "@/components/common/IconTooltip";

/** A help icon after a field label that explains a preset value: what the default is, where it
 *  comes from and whether it can be changed here (docs/ui-conventions.md, section 5). */
export function DefaultHint({ text }: { text: string }) {
  return (
    <IconTooltip label={text}>
      <span role="img" aria-label={text} className="inline-flex">
        <CircleHelp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </span>
    </IconTooltip>
  );
}
