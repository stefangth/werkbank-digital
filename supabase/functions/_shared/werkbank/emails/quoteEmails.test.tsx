/// <reference types="npm:@types/react@18.3.1" />
// The three quote emails (spec R7), rendered through the registry path delivery uses for a
// handwerk org in German: customer emails say "Sie", the office email says "Du".
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { assert, assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveTemplatePresentation, TEMPLATES, type TemplateData } from "../../transactional-email-templates/registry.ts";
import type { EmailLocale } from "../../transactional-email-templates/_shell/emailCopy.ts";

const FORMAL = /\b(Sie|Ihre?|Ihnen|Ihrem|Ihren|Ihres)\b/;
const INFORMAL = /\b(Du|Dein|Deine|Deinen|Dir|Dich)\b/;

async function rendered(name: string, data: TemplateData, locale: EmailLocale = "de") {
  const p = resolveTemplatePresentation(name, data, { kind: "handwerk", locale });
  assertExists(p, `${name} is registered`);
  const html = await renderAsync(React.createElement(TEMPLATES[name].component, p.props));
  const text = await renderAsync(React.createElement(TEMPLATES[name].component, p.props), { plainText: true });
  return { subject: p.subject, html, text };
}

const sent = {
  quote_no: "A-0042", company_name: "Muster Sanitär GmbH", subject: "Badsanierung", valid_until: "06.11.2026",
  message: "", link: "https://werkbank.test/quote/abc",
};

Deno.test("quote-sent addresses the customer formally and carries the link", async () => {
  const r = await rendered("quote-sent", sent);
  assertEquals(r.subject, "Angebot A-0042 · Muster Sanitär GmbH");
  assert(r.text.includes("https://werkbank.test/quote/abc"), "paste link");
  assert(r.html.includes('href="https://werkbank.test/quote/abc"'), "button link");
  assert(r.text.includes("A-0042") && r.text.includes("06.11.2026") && r.text.includes("Badsanierung"));
  assert(FORMAL.test(r.text), "Sie form");
  assert(!INFORMAL.test(r.text), "no Du form towards customers");
  assert(!/ShowFlow/i.test(r.text), "no booking product name");
});

Deno.test("quote-sent prints the office message instead of the default intro", async () => {
  const r = await rendered("quote-sent", { ...sent, message: "Sehr geehrte Frau Muster,\nanbei das Angebot." });
  assert(r.text.includes("Sehr geehrte Frau Muster,"));
  assert(r.text.includes("anbei das Angebot."));
  assert(!r.text.includes("sendet Ihnen das Angebot"), "the default intro steps aside");
});

const decided = {
  quote_no: "A-0042", customer_name: "Anna Muster", signer_name: "Anna Muster", decision: "accepted",
  comment: "Bitte im November.", link: "https://werkbank.test/quotes/q-1",
};

Deno.test("quote-decided tells the office in Du form, per decision", async () => {
  const accepted = await rendered("quote-decided", decided);
  assertEquals(accepted.subject, "Angebot A-0042 wurde angenommen");
  assert(accepted.text.includes("Bitte im November."));
  assert(accepted.html.includes('href="https://werkbank.test/quotes/q-1"'));
  assert(INFORMAL.test(accepted.text), "Du form towards the office");
  assert(!FORMAL.test(accepted.text));

  const rejected = await rendered("quote-decided", { ...decided, decision: "rejected" });
  assertEquals(rejected.subject, "Angebot A-0042 wurde abgelehnt");
  assert(rejected.text.includes("abgelehnt"));
});

const confirmation = { quote_no: "A-0042", company_name: "Muster Sanitär GmbH", signer_name: "Anna Muster", decision: "accepted", decided_at: "08.10.2026" };

Deno.test("quote-decision-confirmation confirms to the signer formally", async () => {
  const accepted = await rendered("quote-decision-confirmation", confirmation);
  assertEquals(accepted.subject, "Bestätigung: Sie haben das Angebot A-0042 angenommen");
  assert(accepted.text.includes("Anna Muster") && accepted.text.includes("08.10.2026"));
  assert(FORMAL.test(accepted.text));
  assert(!INFORMAL.test(accepted.text));

  const rejected = await rendered("quote-decision-confirmation", { ...confirmation, decision: "rejected" });
  assertEquals(rejected.subject, "Bestätigung: Sie haben das Angebot A-0042 abgelehnt");
  assert(!INFORMAL.test(rejected.text));
});

Deno.test("the English base map is a real fallback, not German", async () => {
  // Delivery forces locale "de" for customer emails; English renders only if an org has
  // lost language_packages, and then it must still read correctly.
  const r = await rendered("quote-sent", sent, "en");
  assertEquals(r.subject, "Quote A-0042 · Muster Sanitär GmbH");
});
