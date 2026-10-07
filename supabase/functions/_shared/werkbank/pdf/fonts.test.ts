import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { inflateFontGzB64 } from "../../pdf/fontInflate.ts";
import { registerQuoteFonts } from "./fonts.ts";

Deno.test("a failed font registration is not cached: the next call retries", async () => {
  await assertRejects(() => registerQuoteFonts(() => Promise.reject(new Error("inflate failed"))), Error, "inflate failed");
  let calls = 0;
  await registerQuoteFonts((b64) => {
    calls += 1;
    return inflateFontGzB64(b64);
  });
  assertEquals(calls, 3, "the retry inflated all three weights");
  // Once registered, later calls reuse the registration.
  await registerQuoteFonts(() => Promise.reject(new Error("not called")));
});
