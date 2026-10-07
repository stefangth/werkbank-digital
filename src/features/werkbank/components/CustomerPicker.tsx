import { forwardRef, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCustomers } from "../hooks/useCustomers";
import { customerDisplayName } from "../lib/displayName";

/** Searchable customer select. Lists active customers only, plus the currently selected one
 *  even when it is archived (marked "archiviert"), so editing a property of an archived
 *  customer does not force a change. Controlled, so it works as a react-hook-form field. */
export const CustomerPicker = forwardRef<
  HTMLButtonElement,
  { id?: string; value: string; onChange: (customerId: string) => void }
>(function CustomerPicker({ id, value, onChange }, ref) {
  const { t } = useTranslation("werkbank");
  const { data: customers } = useCustomers();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const options = useMemo(
    () =>
      (customers ?? [])
        .filter((c) => !c.archived_at || c.id === value)
        .map((c) => ({
          id: c.id,
          name: customerDisplayName(c),
          number: c.customer_no,
          archived: !!c.archived_at,
        })),
    [customers, value],
  );
  const label = (o: { name: string; archived: boolean }) =>
    o.archived ? `${o.name} (${t("properties.dialog.customerArchived")})` : o.name;

  const selected = options.find((o) => o.id === value);
  const needle = search.trim().toLowerCase();
  const matches = needle
    ? options.filter((o) => `${o.name} ${o.number}`.toLowerCase().includes(needle))
    : options;

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
          className="w-full justify-between font-normal"
        >
          <span className={selected ? "truncate" : "truncate text-muted-foreground"}>
            {selected ? label(selected) : t("properties.dialog.customerPlaceholder")}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        {/* Filtered here (shouldFilter=false) so the label and the number both match. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("properties.dialog.customerSearch")}
            value={search}
            onValueChange={setSearch}
          />
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
                  <span className="ml-auto pl-2 text-xs text-muted-foreground">{o.number}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {matches.length === 0 && <CommandEmpty>{t("properties.dialog.customerNone")}</CommandEmpty>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
