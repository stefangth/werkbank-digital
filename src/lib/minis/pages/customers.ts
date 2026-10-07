import type { MiniDef, MiniSteps } from '../types';

const STEP1 = {
  label: { en: 'Type', de: 'Art' },
  text: {
    en: 'Pick first whether the customer is a property manager or a private person. The form asks for the matching name.',
    de: 'Wähle zuerst, ob der Kunde eine Hausverwaltung oder eine Privatperson ist. Das Formular fragt dann den passenden Namen ab.',
  },
};
const STEP3 = {
  label: { en: 'Properties', de: 'Liegenschaften' },
  text: {
    en: 'Properties and invoices always belong to one customer. The list shows how many each customer has.',
    de: 'Liegenschaften und Rechnungen gehören immer zu einem Kunden. Die Liste zeigt, wie viele es je Kunde sind.',
  },
};
const STEP4 = {
  label: { en: 'Contacts', de: 'Ansprechpartner' },
  text: {
    en: 'Open a customer to keep its contacts and properties together. Archive a customer you no longer serve.',
    de: 'Öffne einen Kunden, dann liegen Ansprechpartner und Liegenschaften beisammen. Archiviere Kunden, die du nicht mehr betreust.',
  },
};

const admin: MiniSteps = [
  STEP1,
  {
    label: { en: 'Numbers', de: 'Nummern' },
    text: {
      en: 'Leave the customer number empty and the next one is assigned. Prefix and next number live in Settings.',
      de: 'Lass die Kundennummer leer, dann vergibt die App die nächste. Präfix und nächste Nummer stellst du in den Einstellungen ein.',
    },
  },
  STEP3,
  STEP4,
];

const producer: MiniSteps = [
  STEP1,
  {
    label: { en: 'Numbers', de: 'Nummern' },
    text: {
      en: 'Leave the customer number empty and the next one is assigned. An admin sets prefix and next number.',
      de: 'Lass die Kundennummer leer, dann vergibt die App die nächste. Präfix und nächste Nummer stellt ein Admin ein.',
    },
  },
  STEP3,
  STEP4,
];

export const customersMini: MiniDef = {
  page: 'customers',
  route: '/customers',
  eyebrow: { en: 'How customers work', de: 'So funktionieren Kunden' },
  variants: { admin, producer },
};
