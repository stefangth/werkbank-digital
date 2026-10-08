// Deno test (run explicitly by the e-invoice workflow; named so vitest and tsc do not pick it up).
import { gate } from "./mustang-gate.ts";

const report = (messages: string, summaries = ["valid", "valid", "valid"]) =>
  `[main] INFO noise\n<?xml version="1.0"?>\n<validation filename="a.pdf">\n<pdf><summary status="${summaries[0]}"/></pdf>\n` +
  `<xml><summary status="${summaries[1]}"/><messages>${messages}</messages></xml>\n<messages></messages>\n<summary status="${summaries[2]}"/>\n</validation>\n`;

const notice = '<notice type="27" location="/x">[BR-DE-15] text</notice>';

function expectEqual(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("valid report without messages passes", () => expectEqual(gate(report("")), []));
Deno.test("report with only notices passes", () => expectEqual(gate(report(notice + notice)), []));
Deno.test("an error element fails", () => {
  if (gate(report('<error type="17">bad</error>')).length === 0) throw new Error("should fail");
});
Deno.test("an unknown severity element fails", () => {
  if (gate(report('<fatal type="1">x</fatal>' + notice)).length === 0) throw new Error("should fail");
});
Deno.test("an invalid summary fails", () => {
  if (gate(report("", ["valid", "invalid", "invalid"])).length === 0) throw new Error("should fail");
});
Deno.test("missing validation report fails", () => {
  expectEqual(gate("java.io.IOException: boom"), ["no <validation> report in the output"]);
});

Deno.test("wrong file count fails", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/a.report`, report(notice));
  const run = async (expect: string) =>
    (await new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-read", decodeURIComponent(new URL("./mustang-gate.ts", import.meta.url).pathname), "--expect", expect, `${dir}/a.report`],
      stdout: "null",
      stderr: "null",
    }).output()).code;
  expectEqual(await run("1"), 0);
  expectEqual(await run("4"), 1);
});
