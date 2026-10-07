import { describe, it, expect } from "vitest";
import { customerDisplayName } from "./displayName";

const base = { company_name: null, first_name: null, last_name: null };

describe("customerDisplayName", () => {
  it("returns the company name for a property manager", () => {
    expect(customerDisplayName({ ...base, kind: "property_manager", company_name: "Hausverwaltung Nord" })).toBe(
      "Hausverwaltung Nord",
    );
  });

  it("returns 'last, first' for a private customer", () => {
    expect(customerDisplayName({ ...base, kind: "private", first_name: "Anna", last_name: "Muster" })).toBe(
      "Muster, Anna",
    );
  });

  it("returns only the last name without a first name", () => {
    expect(customerDisplayName({ ...base, kind: "private", last_name: "Muster" })).toBe("Muster");
  });
});
