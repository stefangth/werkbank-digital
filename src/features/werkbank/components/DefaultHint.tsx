import { CircleHelp } from "lucide-react";
import { IconTooltip } from "@/components/common/IconTooltip";
import { FormLabel, useFormField } from "@/components/ui/form";
import { Label } from "@/components/ui/label";

/** The id a field's DefaultHint gets, for the control's `aria-describedby`. */
export const hintId = (controlId: string) => `${controlId}-hint`;

/** A help icon beside a field label that explains a preset value: what the default is, where it
 *  comes from and whether it can be changed here (docs/ui-conventions.md, section 5). A real button,
 *  so the tooltip opens on keyboard focus too; its accessible name is the (visually hidden) text.
 *  Give it the `id` the control points to with `aria-describedby`, so the text becomes the
 *  control's description. */
export function DefaultHint({ text, id }: { text: string; id?: string }) {
  return (
    <IconTooltip label={text}>
      <button
        type="button"
        id={id}
        className="inline-flex rounded-pill text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CircleHelp className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {/* Text content, not aria-label: an aria-describedby reference reads it in every engine. */}
        <span className="sr-only">{text}</span>
      </button>
    </IconTooltip>
  );
}

/** A field label with its DefaultHint beside it, not inside the `<label>`, so the control's
 *  accessible name stays the label. The hint's id is `hintId(htmlFor)`. */
export function HintedLabel({ htmlFor, hint, children }: { htmlFor: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor}>{children}</Label>
      <DefaultHint id={hintId(htmlFor)} text={hint} />
    </div>
  );
}

/** HintedLabel inside a react-hook-form `FormItem`: the hint takes the item's description id, which
 *  `FormControl` already puts into the control's `aria-describedby`. */
export function FormHintedLabel({ hint, children }: { hint: string; children: React.ReactNode }) {
  const { formDescriptionId } = useFormField();
  return (
    <div className="flex items-center gap-1.5">
      <FormLabel>{children}</FormLabel>
      <DefaultHint id={formDescriptionId} text={hint} />
    </div>
  );
}
