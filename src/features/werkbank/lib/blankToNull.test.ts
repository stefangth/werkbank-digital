import { describe, it, expect } from "vitest";
import { blankToNull } from "./blankToNull";

describe("blankToNull", () => {
  it("trims strings, nulls blanks and keeps other values", () => {
    expect(blankToNull({ a: " ", b: "x ", c: 3 })).toEqual({ a: null, b: "x", c: 3 });
  });

  it("keeps null and boolean values", () => {
    expect(blankToNull({ a: null, b: false })).toEqual({ a: null, b: false });
  });
});
