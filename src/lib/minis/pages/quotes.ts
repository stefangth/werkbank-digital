import type { MiniDef, MiniSteps } from '../types';

const steps: MiniSteps = [
  {
    label: { en: 'Draft', de: 'Entwurf' },
    text: {
      en: 'Create a quote for a customer and add items from your services or free ones. Sums and VAT update as you type.',
      de: 'Lege ein Angebot für einen Kunden an und füge Leistungen aus deinem Katalog oder freie Positionen hinzu. Summen und MwSt. rechnen sich mit.',
    },
  },
  {
    label: { en: 'Number', de: 'Nummer' },
    text: {
      en: 'The number is assigned when you create the draft. A revision keeps it and adds a version.',
      de: 'Die Nummer wird beim Anlegen des Entwurfs vergeben. Eine Überarbeitung behält sie und bekommt eine Version.',
    },
  },
  {
    label: { en: 'Sent', de: 'Versendet' },
    text: {
      en: 'A sent quote is locked. To change it, revise it: that creates the next version as a draft.',
      de: 'Ein versendetes Angebot ist gesperrt. Zum Ändern überarbeitest du es: Das legt die nächste Version als Entwurf an.',
    },
  },
  {
    label: { en: 'Answer', de: 'Antwort' },
    text: {
      en: 'The history shows when the customer accepted or declined, with name and signature. You can extend the validity or block the link.',
      de: 'Der Verlauf zeigt, wann der Kunde angenommen oder abgelehnt hat, mit Name und Unterschrift. Du kannst die Gültigkeit verlängern oder den Link sperren.',
    },
  },
];

export const quotesMini: MiniDef = {
  page: 'quotes',
  route: '/quotes',
  eyebrow: { en: 'How quotes work', de: 'So funktionieren Angebote' },
  variants: { admin: steps, producer: steps },
};
