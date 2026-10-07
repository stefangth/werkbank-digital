import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTechnicians } from "../hooks/useTechnicians";

/** Searchable multi-select over the org's technicians. Selected ones show as removable chips.
 *  `disabled` blocks toggles (the list stays open), so the caller can serialize its saves. */
export function TechnicianMultiSelect({
  id, value, onChange, disabled = false,
}: { id?: string; value: string[]; onChange: (artistIds: string[]) => void; disabled?: boolean }) {
  const { t } = useTranslation("werkbank");
  const orgId = useAuth().currentOrg?.id;
  const { data: technicians } = useTechnicians(orgId);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const options = useMemo(() => technicians ?? [], [technicians]);
  const selected = useMemo(() => options.filter((o) => value.includes(o.id)), [options, value]);
  const needle = search.trim().toLowerCase();
  const matches = needle ? options.filter((o) => o.name.toLowerCase().includes(needle)) : options;
  const toggle = (artistId: string) =>
    !disabled && onChange(value.includes(artistId) ? value.filter((v) => v !== artistId) : [...value, artistId]);

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSearch(""); }}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
            <span className="truncate text-muted-foreground">{t("pickers.technician.placeholder")}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder={t("pickers.technician.search")} value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandGroup>
                {matches.map((o) => (
                  <CommandItem key={o.id} value={o.id} disabled={disabled} onSelect={() => toggle(o.id)}>
                    <Check className={`mr-2 h-4 w-4 ${value.includes(o.id) ? "opacity-100" : "opacity-0"}`} />
                    <span className="truncate">{o.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              {matches.length === 0 && <CommandEmpty>{t("pickers.technician.none")}</CommandEmpty>}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {selected.map((o) => (
            <li key={o.id}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={disabled}
                aria-label={t("pickers.technician.remove", { name: o.name })}
                onClick={() => toggle(o.id)}
              >
                {o.name}
                <X className="ml-1 h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
