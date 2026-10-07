import type { MiniDef, MiniSteps } from '../types';

const steps: MiniSteps = [
  {
    label: { en: 'Unit', de: 'Einheit' },
    text: {
      en: 'Every item has a unit, such as hours, pieces, metres or a flat rate. The price always refers to one unit.',
      de: 'Jede Leistung hat eine Einheit, zum Beispiel Stunden, Stück, Meter oder pauschal. Der Preis gilt immer für eine Einheit.',
    },
  },
  {
    label: { en: 'Labour and material', de: 'Lohn und Material' },
    text: {
      en: 'Enter labour and material as two net prices. Kept apart, they show the labour share needed for the §35a tax relief.',
      de: 'Trag Lohn und Material als zwei Nettopreise ein. Getrennt zeigen sie den Lohnanteil, den Kunden für die Steuerermäßigung nach §35a brauchen.',
    },
  },
  {
    label: { en: 'VAT', de: 'MwSt.' },
    text: {
      en: 'Choose the VAT rate per item. The list shows the net total, labour plus material.',
      de: 'Wähle den Steuersatz je Leistung. Die Liste zeigt die Summe netto, Lohn plus Material.',
    },
  },
  {
    label: { en: 'Into quotes', de: 'In Angebote' },
    text: {
      en: 'Later you pick items when you write a quote. The price is copied into it, so edits here never change a sent quote.',
      de: 'Später wählst du Leistungen im Angebot aus. Der Preis wird dort übernommen, spätere Änderungen hier ändern kein verschicktes Angebot.',
    },
  },
];

export const catalogMini: MiniDef = {
  page: 'catalog',
  route: '/catalog',
  eyebrow: { en: 'How the catalog works', de: 'So funktionieren Leistungen' },
  variants: { admin: steps, producer: steps },
};
