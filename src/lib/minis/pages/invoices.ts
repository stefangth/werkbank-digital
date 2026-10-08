import type { MiniDef, MiniSteps } from '../types';

const steps: MiniSteps = [
  {
    label: { en: 'Create', de: 'Anlegen' },
    text: {
      en: 'Turn a done order into an invoice with one click, or start a free invoice for a customer.',
      de: 'Mache aus einem erledigten Auftrag mit einem Klick eine Rechnung oder starte eine freie Rechnung für einen Kunden.',
    },
  },
  {
    label: { en: 'Check', de: 'Prüfen' },
    text: {
      en: 'Review items, service date and payment terms. Missing details are listed before you can issue.',
      de: 'Prüfe Positionen, Leistungsdatum und Zahlungsbedingungen. Fehlende Angaben werden vor dem Ausstellen aufgelistet.',
    },
  },
  {
    label: { en: 'Issue', de: 'Ausstellen' },
    text: {
      en: 'Issuing assigns the number, creates the PDF and locks the invoice. You can send it by email right away.',
      de: 'Beim Ausstellen vergibst du die Nummer, das PDF entsteht und die Rechnung wird gesperrt. Per E-Mail senden kannst du sofort.',
    },
  },
  {
    label: { en: 'Correct', de: 'Korrigieren' },
    text: {
      en: 'An issued invoice is never edited. Cancel it with a cancellation invoice and start again from a copy.',
      de: 'Eine ausgestellte Rechnung änderst du nie. Storniere sie mit einer Stornorechnung und starte neu mit einer Kopie.',
    },
  },
];

export const invoicesMini: MiniDef = {
  page: 'invoices',
  route: '/invoices',
  eyebrow: { en: 'How invoices work', de: 'So funktionieren Rechnungen' },
  variants: { admin: steps, producer: steps },
};
