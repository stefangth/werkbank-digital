import { describe, it, expect } from "vitest";
import { UNIT_CODES, unitLabelKey } from "./units";
import de from "../i18n/de.json";
import en from "../i18n/en.json";

describe("units", () => {
  it("builds the label key", () => {
    expect(unitLabelKey("HUR")).toBe("units.HUR");
  });

  it.each(UNIT_CODES)("has a label for %s in both languages", (code) => {
    const units = (catalog: unknown) => (catalog as { units: Record<string, string> }).units;
    expect(units(de)[code]).toBeTruthy();
    expect(units(en)[code]).toBeTruthy();
  });
});
