import { useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { parseDateOnly, toDateKey } from "@/lib/dates";

/** A popover with a Monday-first calendar around any trigger. `value` and the reported date are
 *  `YYYY-MM-DD`; days before `minDate` cannot be picked. */
export function DatePopover({
  value, onSelect, minDate, children,
}: {
  value: string | null;
  onSelect: (date: string) => void;
  minDate?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          weekStartsOn={1}
          selected={value ? parseDateOnly(value) : undefined}
          defaultMonth={value ? parseDateOnly(value) : undefined}
          disabled={minDate ? { before: parseDateOnly(minDate) } : undefined}
          onSelect={(d) => {
            if (!d) return;
            onSelect(toDateKey(d));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
