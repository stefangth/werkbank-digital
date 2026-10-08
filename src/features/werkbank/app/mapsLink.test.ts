import { describe, it, expect } from "vitest";
import { mapsLink } from "./mapsLink";

describe("mapsLink", () => {
  it("encodes the full address", () => {
    expect(mapsLink({ street: "Hauptstr. 1", postal_code: "10115", city: "Berlin" }))
      .toBe("https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent("Hauptstr. 1, 10115 Berlin"));
  });
  it("is null without a street or without a city", () => {
    expect(mapsLink({ postal_code: "10115", city: "Berlin" })).toBeNull();
    expect(mapsLink({ street: "Hauptstr. 1", city: "  " })).toBeNull();
  });
  it("encodes umlauts", () => {
    expect(mapsLink({ street: "Müllerstraße 2", city: "Köln" })).toContain("M%C3%BCllerstra%C3%9Fe%202%2C%20K%C3%B6ln");
  });
});
