import { describe, it, expect } from "vitest";
import { defaultRecipient } from "./defaultRecipient";

describe("defaultRecipient", () => {
  it("prefers the invoice email, then the contact, then the customer email", () => {
    expect(defaultRecipient({ invoice_email: "a@x.de", email: "c@x.de" }, { email: "k@x.de" })).toBe("a@x.de");
    expect(defaultRecipient({ invoice_email: null, email: "c@x.de" }, { email: "k@x.de" })).toBe("k@x.de");
    expect(defaultRecipient({ email: "c@x.de" }, null)).toBe("c@x.de");
  });
  it("skips blank values and trims", () => {
    expect(defaultRecipient({ invoice_email: "  ", email: " c@x.de " }, { email: "" })).toBe("c@x.de");
  });
  it("returns an empty string without data", () => {
    expect(defaultRecipient(null, null)).toBe("");
  });
});
