import { forwardRef, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePropertiesForCustomer } from "../hooks/useProperties";

/** Searchable property select for one customer. Empty and disabled while no customer is chosen.
 *  Lists active properties plus the selected one even when archived. Controlled. */
export const PropertyPicker = forwardRef<
  HTMLButtonElement,
  { id?: string; customerId: string; value: string; onChange: (propertyId: string) => void; disabled?: boolean }
>(function PropertyPicker({ id, customerId, value, onChange, disabled }, ref) {
  const { t } = useTranslation("werkbank");
  const { data: properties } = usePropertiesForCustomer(customerId || undefined);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const options = useMemo(
    () =>
      (customerId ? (properties ?? []) : [])
        .filter((p) => !p.archived_at || p.id === value)
        .map((p) => ({ id: p.id, name: p.name, number: p.object_no ?? "", archived: !!p.archived_at })),
    [customerId, properties, value],
  );
  const label = (o: { name: string; archived: boolean }) =>
    o.archived ? `${o.name} (${t("pickers.property.archived")})` : o.name;

  const selected = options.find((o) => o.id === value);
  const needle = search.trim().toLowerCase();
  const matches = needle ? options.filter((o) => `${o.name} ${o.number}`.toLowerCase().includes(needle)) : options;
  const placeholder = customerId ? t("pickers.property.placeholder") : t("pickers.property.needCustomer");

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={ref}
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || !customerId}
          className="w-full justify-between font-normal"
        >
          <span className={selected ? "truncate" : "truncate text-muted-foreground"}>
            {selected ? label(selected) : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={t("pickers.property.search")} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandGroup>
              {matches.map((o) => (
                <CommandItem
                  key={o.id}
                  value={o.id}
                  onSelect={() => {
                    onChange(o.id);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <Check className={`mr-2 h-4 w-4 ${o.id === value ? "opacity-100" : "opacity-0"}`} />
                  <span className="truncate">{label(o)}</span>
                  {o.number && <span className="ml-auto pl-2 text-muted-foreground">{o.number}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
            {matches.length === 0 && <CommandEmpty>{t("pickers.property.none")}</CommandEmpty>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
