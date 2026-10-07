import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { contactSchema, toContactRow } from "./contact";

const t = ((key: string) => key) as unknown as TFunction;
const base = { first_name: "", last_name: "Meier", role: "", phone: "", mobile: "", email: "", notes: "", is_primary: false };
const ok = (v: unknown) => contactSchema(t).safeParse(v).success;

describe("contactSchema", () => {
  it("accepts a contact with only a last name", () => {
    expect(ok(base)).toBe(true);
  });

  it("requires a last name", () => {
    expect(ok({ ...base, last_name: "  " })).toBe(false);
  });

  it("accepts blank emails and rejects malformed ones", () => {
    expect(ok({ ...base, email: "a@b.de" })).toBe(true);
    expect(ok({ ...base, email: "a b@c.de" })).toBe(false);
    expect(ok({ ...base, email: "ab.de" })).toBe(false);
  });
});

describe("toContactRow", () => {
  it("turns blank optionals into null and trims", () => {
    expect(toContactRow({ ...base, last_name: " Meier ", first_name: " Anna ", is_primary: true })).toEqual({
      first_name: "Anna", last_name: "Meier", role: null, phone: null, mobile: null, email: null, notes: null, is_primary: true,
    });
  });
});
