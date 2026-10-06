// Module manifest: i18n namespaces that plugins add on top of the core catalogs. Keep
// this file free of React; it imports only JSON catalogs and types. A plugin adds an
// entry keyed by its namespace, e.g. `werkbank: { en: enWerkbank, de: deWerkbank }`.
// src/i18n/index.ts spreads these into `resources` and `ns`, the typed-resource
// declaration and the key-parity test pick them up from here.
export const MODULE_I18N = {} as const satisfies Record<
  string,
  { en: Record<string, unknown>; de: Record<string, unknown> }
>;
