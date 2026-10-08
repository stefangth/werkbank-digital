#!/usr/bin/env -S deno run --allow-read
/**
 * Gate over Mustang `--action validate` output (stdout and stderr captured together).
 * Passes only when every summary is status="valid" and the report holds no <error>
 * or <warning> element. <notice> elements are ignored: the XRechnung-only rules
 * (BR-DE-5, BR-DE-15, BR-DE-21) always fire for a plain Factur-X EN 16931 file.
 * Usage: mustang-gate.ts <report-file>...   Exit 1 on the first failing report.
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
  for (const m of xml.matchAll(/<(error|warning)\b[^>]*>/g)) problems.push(`found ${m[0].slice(0, 160)}`);
  return problems;
}

if (import.meta.main) {
  let failed = false;
  for (const file of Deno.args) {
    const output = await Deno.readTextFile(file);
    const problems = gate(output);
    if (problems.length === 0) {
      console.log(`OK    ${file}`);
    } else {
      failed = true;
      console.log(`FAIL  ${file}\n  ${problems.join("\n  ")}\n----- report -----\n${output}\n------------------`);
    }
  }
  Deno.exit(failed || Deno.args.length === 0 ? 1 : 0);
}
