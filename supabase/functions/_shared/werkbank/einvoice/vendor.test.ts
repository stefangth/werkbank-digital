// The vendored e-invoice build renders legally relevant invoices: a silent edit must fail CI.
// The header records the sha256 of the build as downloaded; the file is that build with the
// 5-line header prepended and the trailing source map comment removed (see vendor/README.md).
import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sha256Hex } from "../quoteToken.ts";

const HEADER_LINES = 5;
const SOURCE_MAP = "//# sourceMappingURL=core.bundle.mjs.map";

Deno.test("the vendored e-invoice build is byte for byte the build its header names", async () => {
  const text = await Deno.readTextFile(new URL("./vendor/e-invoice-eu-core-3.4.0.mjs", import.meta.url));
  const lines = text.split("\n");
  const header = lines.slice(0, HEADER_LINES).join("\n");
  const recorded = header.match(/sha256 ([0-9a-f]{64})/)?.[1] ?? "";
  assertMatch(recorded, /^[0-9a-f]{64}$/, "the header records a sha256");
  const original = lines.slice(HEADER_LINES).join("\n") + SOURCE_MAP;
  assertEquals(await sha256Hex(original), recorded);
});
