import { describe, expect, it } from "vitest";
import { splitAddresses } from "./addresses";

describe("splitAddresses", () => {
  it("splits on comma, semicolon, line break and whitespace", () => {
    expect(splitAddresses("a@x.de, b@x.de;c@x.de\nd@x.de e@x.de")).toEqual(["a@x.de", "b@x.de", "c@x.de", "d@x.de", "e@x.de"]);
  });
  it("takes the address out of a pasted display name", () => {
    expect(splitAddresses("Max Mustermann <max@x.de>, \"Büro, Nord\" <buero@x.de>")).toEqual(["max@x.de", "buero@x.de"]);
  });
  it("keeps an address typed twice once, case-insensitively", () => {
    expect(splitAddresses("A@x.de a@x.de")).toEqual(["A@x.de"]);
  });
  it("returns nothing for blank input", () => {
    expect(splitAddresses("  ,; ")).toEqual([]);
  });
});
