// GENERATED FILE. Do not edit.
// Source: src/features/werkbank/lib/dunningDefaults.ts
// Regenerate: npm run sync:mirrors
/** Why a dunning notice cannot be created (SQL `detail` of `dunning_not_allowed`, same names). */
export type DunningBlocker = "not_issued" | "not_overdue" | "nothing_open" | "on_hold" | "previous_stage_open" | "max_stage";

export const DUNNING_STAGE_TITLES: Record<1 | 2 | 3, string> = {
  1: "Zahlungserinnerung",
  2: "1. Mahnung",
  3: "2. und letzte Mahnung",
};

/** Salutation-less body per stage ("Sie"); the PDF adds the amount and deadline sentence itself. */
export const DEFAULT_STAGE_TEXTS: Record<1 | 2 | 3, string> = {
  1: "sicher ist Ihnen im Alltag entgangen, dass die unten genannte Rechnung noch offen ist. Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.",
  2: "leider konnten wir zu der unten genannten Rechnung bis heute keinen vollständigen Zahlungseingang feststellen. Wir bitten Sie, den offenen Betrag nun umgehend zu begleichen.",
  3: "trotz unserer bisherigen Schreiben ist die unten genannte Rechnung weiterhin offen. Dies ist unsere letzte Mahnung. Nach Ablauf der Frist behalten wir uns weitere Schritte vor, ohne Sie erneut zu benachrichtigen.",
};

type StageTexts = { reminder_text?: string | null; dunning1_text?: string | null; dunning2_text?: string | null };

/** The text of a stage: the company profile column when not blank, else the default.
 *  Pure and import-free: it is mirrored to the edge runtime (scripts/mirrors.manifest.json). */
export function stageText(stage: 1 | 2 | 3, profile: StageTexts | null): string {
  const custom = stage === 1 ? profile?.reminder_text : stage === 2 ? profile?.dunning1_text : profile?.dunning2_text;
  return custom?.trim() ? custom : DEFAULT_STAGE_TEXTS[stage];
}
