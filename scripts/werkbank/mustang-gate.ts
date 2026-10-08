#!/usr/bin/env -S deno run --allow-read
/**
 * Gate over Mustang `--action validate` output (stdout and stderr captured together).
 * Passes only when the report has three summaries, all status="valid", and every
 * element inside a <messages> block is a <notice>. Notices are allowlisted because the
 * XRechnung-only rules (BR-DE-5, BR-DE-15, BR-DE-21) always fire for a plain Factur-X
 * EN 16931 file; any other severity (error, warning, or one Mustang adds later) fails.
 * Usage: mustang-gate.ts --expect <count> <report-file>...   Exit 1 on any failure,
 * including a report count different from <count>.
 */

export function gate(output: string): string[] {
  const start = output.indexOf("<validation");
  const end = output.lastIndexOf("</validation>");
  if (start < 0 || end < 0) return ["no <validation> report in the output"];
  const xml = output.slice(start, end);
  const problems: string[] = [];
  const summaries = [...xml.matchAll(/<summary\s+status="([^"]*)"/g)].map((m) => m[1]);
  // Expect pdf, xml and overall summaries.
  if (summaries.length < 3) problems.push(`expected 3 summaries, found ${summaries.length}`);
  for (const s of summaries) if (s !== "valid") problems.push(`summary status="${s}"`);
  for (const block of xml.matchAll(/<messages>([\s\S]*?)<\/messages>/g)) {
    for (const m of block[1].matchAll(/<([A-Za-z][\w:-]*)\b[^>]*>/g)) {
      if (m[1] !== "notice") problems.push(`non-notice message ${m[0].slice(0, 160)}`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const args = [...Deno.args];
  const i = args.indexOf("--expect");
  const expected = i >= 0 ? Number(args.splice(i, 2)[1]) : NaN;
  if (!Number.isInteger(expected) || expected < 1) {
    console.error("usage: mustang-gate.ts --expect <count> <report-file>...");
    Deno.exit(2);
  }
  let failed = false;
  if (args.length !== expected) {
    failed = true;
    console.log(`FAIL  expected ${expected} reports, got ${args.length}`);
  }
  for (const file of args) {
    const output = await Deno.readTextFile(file);
    const problems = gate(output);
    if (problems.length === 0) {
      console.log(`OK    ${file}`);
    } else {
      failed = true;
      console.log(`FAIL  ${file}\n  ${problems.join("\n  ")}\n----- report -----\n${output}\n------------------`);
    }
  }
  Deno.exit(failed ? 1 : 0);
}
