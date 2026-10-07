import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Token } from "@/components/ui/token";
import type { CatalogItem } from "../data/catalog";
import { useCatalogItems } from "../hooks/useCatalog";

/** Search over the active catalog items by number, name and category. Picking hands the item
 *  to `onPick`; the caller snapshots it into a line item. */
export function CatalogItemCombobox({ onPick }: { onPick: (item: CatalogItem) => void }) {
  const { t } = useTranslation("werkbank");
  const { data: items } = useCatalogItems();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const active = useMemo(() => (items ?? []).filter((i) => !i.archived_at), [items]);
  const needle = search.trim().toLowerCase();
  const matches = needle
    ? active.filter((i) => `${i.item_no ?? ""} ${i.name} ${i.category ?? ""}`.toLowerCase().includes(needle))
    : active;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Plus className="mr-1 h-4 w-4" />
          {t("pickers.catalog.trigger")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={t("pickers.catalog.search")} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandGroup>
              {matches.map((i) => (
                <CommandItem
                  key={i.id}
                  value={i.id}
                  onSelect={() => {
                    onPick(i);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <span className="truncate">{i.name}</span>
                  {i.item_no && <Token className="ml-auto pl-2 text-muted-foreground">{i.item_no}</Token>}
                </CommandItem>
              ))}
            </CommandGroup>
            {matches.length === 0 && <CommandEmpty>{t("pickers.catalog.none")}</CommandEmpty>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
