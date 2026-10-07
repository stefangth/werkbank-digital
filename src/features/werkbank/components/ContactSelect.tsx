import { forwardRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Contact } from "../data/contacts";
import { useContacts } from "../hooks/useContacts";

const contactName = (c: Pick<Contact, "first_name" | "last_name">) =>
  [c.first_name, c.last_name].filter(Boolean).join(" ");

/** Contact select for a document: the contacts of the property first, then those of the
 *  customer. `value` is a contact id, "" for none. Controlled. */
export const ContactSelect = forwardRef<
  HTMLButtonElement,
  { id?: string; customerId: string; propertyId: string | null; value: string; onChange: (contactId: string) => void; disabled?: boolean }
>(function ContactSelect({ id, customerId, propertyId, value, onChange, disabled }, ref) {
  const { t } = useTranslation("werkbank");
  const [open, setOpen] = useState(false);
  const { data: propertyContacts } = useContacts(propertyId ? { propertyId } : undefined);
  const { data: customerContacts } = useContacts(customerId ? { customerId } : undefined);

  // A contact linked to both the property and the customer is listed once, under the property.
  const propertyIds = new Set((propertyContacts ?? []).map((c) => c.id));
  const groups = [
    { key: "property", heading: t("pickers.contact.property"), rows: propertyContacts ?? [] },
    { key: "customer", heading: t("pickers.contact.customer"), rows: (customerContacts ?? []).filter((c) => !propertyIds.has(c.id)) },
  ].filter((g) => g.rows.length > 0);
  const selected = groups.flatMap((g) => g.rows).find((c) => c.id === value);

  const pick = (contactId: string) => {
    onChange(contactId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
            {selected ? contactName(selected) : t("pickers.contact.placeholder")}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandList>
            <CommandGroup>
              <CommandItem value="none" onSelect={() => pick("")}>
                <Check className={`mr-2 h-4 w-4 ${value === "" ? "opacity-100" : "opacity-0"}`} />
                {t("pickers.contact.none")}
              </CommandItem>
            </CommandGroup>
            {groups.map((g) => (
              <CommandGroup key={g.key} heading={g.heading}>
                {g.rows.map((c) => (
                  <CommandItem key={c.id} value={c.id} onSelect={() => pick(c.id)}>
                    <Check className={`mr-2 h-4 w-4 ${c.id === value ? "opacity-100" : "opacity-0"}`} />
                    <span className="truncate">{contactName(c)}</span>
                    {c.role && <span className="ml-auto pl-2 text-muted-foreground">{c.role}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
