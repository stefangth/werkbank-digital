import type { MiniDef, MiniSteps } from '../types';

const steps: MiniSteps = [
  {
    label: { en: 'Overview', de: 'Überblick' },
    text: {
      en: 'See what customers still owe, how much of it is overdue and which customers hold a credit.',
      de: 'Sieh, was Kunden noch schulden, wie viel davon überfällig ist und wer ein Guthaben hat.',
    },
  },
  {
    label: { en: 'Payments', de: 'Zahlungen' },
    text: {
      en: 'Record payments on the invoice. The payment state here updates by itself.',
      de: 'Erfasse Zahlungen an der Rechnung. Der Zahlstatus hier aktualisiert sich von selbst.',
    },
  },
  {
    label: { en: 'Notices', de: 'Mahnungen' },
    text: {
      en: 'Overdue invoices appear under Due a notice. Select several and send them in one go.',
      de: 'Überfällige Rechnungen erscheinen unter Mahnfällig. Wähle mehrere aus und versende sie in einem Rutsch.',
    },
  },
  {
    label: { en: 'Holds', de: 'Sperren' },
    text: {
      en: 'Pause dunning for an invoice with a hold, for example during a complaint. The reason stays visible.',
      de: 'Pausiere die Mahnung einer Rechnung mit einer Mahnsperre, etwa bei einer Reklamation. Der Grund bleibt sichtbar.',
    },
  },
];

export const openItemsMini: MiniDef = {
  page: 'openItems',
  route: '/open-items',
  eyebrow: { en: 'How open items work', de: 'So funktionieren Offene Posten' },
  variants: { admin: steps, producer: steps },
};
