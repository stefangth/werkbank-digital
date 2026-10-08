import { describe, it, expect } from "vitest";
import { DEFAULT_STAGE_TEXTS, DUNNING_STAGE_TITLES, stageText } from "./dunningDefaults";

const profile = { reminder_text: "R", dunning1_text: null, dunning2_text: "   " };

describe("dunningDefaults", () => {
  it("has the stage titles", () => {
    expect(DUNNING_STAGE_TITLES).toEqual({ 1: "Zahlungserinnerung", 2: "1. Mahnung", 3: "2. und letzte Mahnung" });
  });
  it("starts the default texts as specified", () => {
    expect(DEFAULT_STAGE_TEXTS[1]).toMatch(/^sicher ist Ihnen im Alltag entgangen/);
    expect(DEFAULT_STAGE_TEXTS[2]).toMatch(/^leider konnten wir/);
    expect(DEFAULT_STAGE_TEXTS[3]).toMatch(/^trotz unserer bisherigen Schreiben/);
  });
  it("uses the profile column when filled, else the default", () => {
    expect(stageText(1, profile)).toBe("R");
    expect(stageText(2, profile)).toBe(DEFAULT_STAGE_TEXTS[2]);
    expect(stageText(3, profile)).toBe(DEFAULT_STAGE_TEXTS[3]);
    expect(stageText(1, null)).toBe(DEFAULT_STAGE_TEXTS[1]);
  });
});
