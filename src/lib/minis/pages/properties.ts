import type { MiniDef, MiniSteps } from '../types';

const STEP1 = {
  label: { en: 'Property', de: 'Liegenschaft' },
  text: {
    en: 'A property is the place you work at. Choose its customer first, then give it a name and an address.',
    de: 'Eine Liegenschaft ist der Ort, an dem du arbeitest. Wähle zuerst den Kunden, dann Name und Adresse.',
  },
};
const STEP2 = {
  label: { en: 'Invoice recipient', de: 'Rechnungsempfänger' },
  text: {
    en: 'Invoices go to the customer unless you switch on a different recipient. The detail page shows who gets the bill.',
    de: 'Rechnungen gehen an den Kunden, außer du schaltest einen abweichenden Empfänger ein. Die Detailseite zeigt, wer die Rechnung bekommt.',
  },
};
const STEP3 = {
  label: { en: 'Contacts on site', de: 'Ansprechpartner vor Ort' },
  text: {
    en: 'Add the people to call at the property, such as a caretaker or a tenant. Access notes help your fitters get in.',
    de: 'Trag die Leute ein, die du vor Ort anrufst, zum Beispiel Hausmeister oder Mieter. Zugangshinweise helfen deinen Monteuren hinein.',
  },
};

const admin: MiniSteps = [
  STEP1,
  STEP2,
  STEP3,
  {
    label: { en: 'Archive or delete', de: 'Archivieren oder löschen' },
    text: {
      en: 'A property still in use cannot be deleted, so archive it instead. You can bring it back any time.',
      de: 'Eine Liegenschaft, die noch verwendet wird, lässt sich nicht löschen, archiviere sie stattdessen. Du kannst sie jederzeit zurückholen.',
    },
  },
];

const producer: MiniSteps = [
  STEP1,
  STEP2,
  STEP3,
  {
    label: { en: 'Archive', de: 'Archivieren' },
    text: {
      en: 'Archive a property you no longer work at. You can bring it back any time. Deleting is an admin action.',
      de: 'Archiviere eine Liegenschaft, an der du nicht mehr arbeitest. Du kannst sie jederzeit zurückholen. Löschen darf nur ein Admin.',
    },
  },
];

export const propertiesMini: MiniDef = {
  page: 'properties',
  route: '/properties',
  eyebrow: { en: 'How properties work', de: 'So funktionieren Liegenschaften' },
  variants: { admin, producer },
};
