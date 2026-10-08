/// <reference types="npm:@types/react@18.3.1" />
// The dunning email (spec R6), rendered through the registry path delivery uses for a handwerk
// org in German: the customer is addressed formally with "Sie".
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { assert, assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveTemplatePresentation, TEMPLATES, type TemplateData } from "../../transactional-email-templates/registry.ts";
import { DUNNING_STAGE_TITLES } from "../dunningDefaults.ts";

const FORMAL = /\b(Sie|Ihre?|Ihnen|Ihrem|Ihren|Ihres)\b/;
const INFORMAL = /\b(Du|Dein|Deine|Deinen|Dir|Dich)\b/;

async function rendered(data: TemplateData) {
  const p = resolveTemplatePresentation("dunning-sent", data, { kind: "handwerk", locale: "de" });
  assertExists(p, "dunning-sent is registered");
  const html = await renderAsync(React.createElement(TEMPLATES["dunning-sent"].component, p.props));
  const text = await renderAsync(React.createElement(TEMPLATES["dunning-sent"].component, p.props), { plainText: true });
  return { subject: p.subject, html, text };
}

const base = {
  companyName: "Muster Sanitär GmbH", invoiceNo: "RE-0012", openAmount: "100,00 €",
  paymentDeadline: "15.10.2026", message: "",
};

Deno.test("dunning-sent: subject and body per stage, Sie form", async () => {
  const expected = {
    1: "Zahlungserinnerung zu Rechnung RE-0012",
    2: "1. Mahnung zu Rechnung RE-0012",
    3: "2. und letzte Mahnung zu Rechnung RE-0012",
  } as const;
  for (const stage of [1, 2, 3] as const) {
    const r = await rendered({ ...base, stageTitle: DUNNING_STAGE_TITLES[stage] });
    assertEquals(r.subject, expected[stage]);
    assert(r.text.includes(DUNNING_STAGE_TITLES[stage]), "stage title in the body");
    assert(r.text.includes("RE-0012") && r.text.includes("100,00 €") && r.text.includes("15.10.2026"));
    assert(FORMAL.test(r.text), "Sie form");
    assert(!INFORMAL.test(r.text), "no Du form towards customers");
    assert(!/ShowFlow/i.test(r.text), "no booking product name");
  }
});

Deno.test("dunning-sent: the office message replaces the default intro", async () => {
  const r = await rendered({ ...base, stageTitle: "1. Mahnung", message: "Guten Tag Frau Muster,\nbitte zahlen Sie." });
  assert(r.text.includes("Guten Tag Frau Muster,") && r.text.includes("bitte zahlen Sie."));
  assert(!r.text.includes("sendet Ihnen"));
});

Deno.test("dunning-sent: no dashes and no exclamation marks in the copy", async () => {
  for (const stage of [1, 2, 3] as const) {
    const r = await rendered({ ...base, stageTitle: DUNNING_STAGE_TITLES[stage] });
    assert(!/[–—]/.test(r.subject + r.text), "no em or en dashes");
    assert(!r.text.includes("!"), "no exclamation marks");
  }
});
