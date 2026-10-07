import type { MiniDef, MiniSteps } from '../types';

const steps: MiniSteps = [
  {
    label: { en: 'Create', de: 'Anlegen' },
    text: {
      en: 'An accepted quote becomes an order with one click. For work without a quote, create a direct order.',
      de: 'Aus einem angenommenen Angebot machst du mit einem Klick einen Auftrag. Für Arbeiten ohne Angebot legst du einen direkten Auftrag an.',
    },
  },
  {
    label: { en: 'Schedule', de: 'Einplanen' },
    text: {
      en: 'Set a date, optionally a time, and assign technicians. Orders without a date show under Not scheduled.',
      de: 'Lege ein Datum fest, auf Wunsch eine Uhrzeit, und weise Monteure zu. Aufträge ohne Datum findest du unter Nicht eingeplant.',
    },
  },
  {
    label: { en: 'Edit', de: 'Anpassen' },
    text: {
      en: 'Change quantities, prices and lines while the job runs. The order shows how far it moved from the quote.',
      de: 'Passe Mengen, Preise und Positionen an, während der Auftrag läuft. Der Auftrag zeigt, wie weit er vom Angebot abweicht.',
    },
  },
  {
    label: { en: 'Finish', de: 'Abschließen' },
    text: {
      en: 'Start, complete or cancel an order. A finished order is locked, but you can reopen it.',
      de: 'Beginne, erledige oder storniere einen Auftrag. Ein erledigter Auftrag ist gesperrt, du kannst ihn aber wieder öffnen.',
    },
  },
];

export const ordersMini: MiniDef = {
  page: 'orders',
  route: '/orders',
  eyebrow: { en: 'How orders work', de: 'So funktionieren Aufträge' },
  variants: { admin: steps, producer: steps },
};
