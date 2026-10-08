/** `onOpenAutoFocus` for a dialog whose first field has a DefaultHint beside its label: Radix would
 *  focus that hint button (its tooltip pops up, keyboard users need an extra Tab). Focuses the first
 *  real control instead (an enabled input, textarea or select, or an element marked
 *  `data-autofocus`), else the dialog itself. */
export function focusFirstField(event: Event): void {
  event.preventDefault();
  const content = (event.currentTarget ?? event.target) as HTMLElement | null;
  const field = content?.querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [data-autofocus]");
  (field ?? content)?.focus();
}
