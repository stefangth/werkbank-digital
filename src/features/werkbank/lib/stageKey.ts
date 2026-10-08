/** i18n key (`werkbank` namespace) of a notice stage name, stage clamped to 1 to 3. */
export const stageKey = (stage: number | null | undefined) =>
  `dunning.stage.${Math.min(Math.max(stage ?? 1, 1), 3)}` as `dunning.stage.${1 | 2 | 3}`;
