import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DONE_WINDOW_DAYS, PHOTO_MAX_BYTES, UPCOMING_DAYS } from "./visitDefaults";

// werkbank.assignment_group spells the two windows as literals; this keeps them in step with
// the values the app shows in its DefaultHints.
const migration = readFileSync("supabase/migrations/20261008180000_werkbank_visit_report_logic.sql", "utf8");

describe("assignment group windows", () => {
  it("match the SQL grouping in werkbank.assignment_group", () => {
    expect(migration).toContain(`p_scheduled <= p_today + ${UPCOMING_DAYS} then 'upcoming'`);
    expect(migration).toContain(`>= p_today - ${DONE_WINDOW_DAYS} then 'done'`);
  });
  it("keep the photo size limit equal to the werkbank-visits bucket limit", () => {
    expect(migration).toContain(`'werkbank-visits', 'werkbank-visits', false, ${PHOTO_MAX_BYTES}`);
  });
});
