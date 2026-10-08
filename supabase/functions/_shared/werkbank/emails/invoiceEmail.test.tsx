/// <reference types="npm:@types/react@18.3.1" />
// The invoice email (spec R7), rendered through the registry path delivery uses for a handwerk
// org in German: the customer is addressed formally with "Sie".
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { assert, assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveTemplatePresentation, TEMPLATES, type TemplateData } from "../../transactional-email-templates/registry.ts";

const FORMAL = /\b(Sie|Ihre?|Ihnen|Ihrem|Ihren|Ihres)\b/;
const INFORMAL = /\b(Du|Dein|Deine|Deinen|Dir|Dich)\b/;

async function rendered(data: TemplateData) {
  const p = resolveTemplatePresentation("invoice-sent", data, { kind: "handwerk", locale: "de" });
  assertExists(p, "invoice-sent is registered");
  const html = await renderAsync(React.createElement(TEMPLATES["invoice-sent"].component, p.props));
  const text = await renderAsync(React.createElement(TEMPLATES["invoice-sent"].component, p.props), { plainText: true });
  return { subject: p.subject, html, text };
}

const invoice = {
  companyName: "Muster Sanitär GmbH", invoiceNo: "RE-0001", kind: "invoice",
  grossFormatted: "40,11 €", dueDateFormatted: "22.10.2026", message: "",
};

Deno.test("invoice-sent: subject, amount and due date for an invoice, Sie form", async () => {
  const r = await rendered(invoice);
  assertEquals(r.subject, "Rechnung RE-0001 von Muster Sanitär GmbH");
  assert(r.text.includes("RE-0001") && r.text.includes("40,11 €") && r.text.includes("22.10.2026"));
  assert(FORMAL.test(r.text), "Sie form");
  assert(!INFORMAL.test(r.text), "no Du form towards customers");
  assert(!/ShowFlow/i.test(r.text), "no booking product name");
});

Deno.test("invoice-sent: a cancellation names the cancelled invoice and has no due date", async () => {
  const r = await rendered({ ...invoice, invoiceNo: "RE-0002", kind: "cancellation", precedingNo: "RE-0001", grossFormatted: "-40,11 €" });
  assertEquals(r.subject, "Stornorechnung RE-0002 zu RE-0001");
  assert(r.text.includes("Stornorechnung RE-0002") && r.text.includes("RE-0001"));
  assert(!r.text.includes("22.10.2026"), "a cancellation has no due date");
  assert(FORMAL.test(r.text));
});

Deno.test("invoice-sent: the office message replaces the default intro", async () => {
  const r = await rendered({ ...invoice, message: "Sehr geehrte Frau Muster,\nanbei die Rechnung." });
  assert(r.text.includes("Sehr geehrte Frau Muster,") && r.text.includes("anbei die Rechnung."));
  assert(!r.text.includes("sendet Ihnen die Rechnung"));
});

Deno.test("invoice-sent: no dashes and no exclamation marks in the copy", async () => {
  for (const data of [invoice, { ...invoice, kind: "cancellation", precedingNo: "RE-0001" }]) {
    const r = await rendered(data);
    assert(!/[–—]/.test(r.subject + r.text), "no em or en dashes");
    assert(!r.text.includes("!"), "no exclamation marks");
  }
});
