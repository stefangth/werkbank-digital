/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { assertEquals, assertExists } from "../test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../testing.ts";
import { APP_URL } from "../app-url.ts";
import { handle } from "../../provision-org/index.ts";
import { resolveTemplatePresentation, TEMPLATES, type TemplateData } from "../transactional-email-templates/registry.ts";
import type { EmailLocale } from "../transactional-email-templates/_shell/emailCopy.ts";
import { WERKBANK_PROVISIONING } from "./registry.ts";

// The invitation a handwerk org sends must read as Werkbank Digital: no ShowFlow, and no
// wording from the booking product. The override is the one provision-org seeds, and the
// template data is the data provision-org actually sends for the first invitee. Links
// still point at the Showflow origin until the Werkbank domain exists (go-live checklist),
// so the deployment origin is masked before the wording is checked.

const ORG = "org-9";
const BOOKING_WORDS = /ShowFlow|bucht|gebucht|Engagement|\bbooks?\b|booked|booking/i;
const ROLES = ["admin", "producer", "artist"] as const;

function fake(locale: EmailLocale) {
  return makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      platform_admins: { data: { user_id: "u1" }, error: null },
      organizations: [{ when: { id: ORG }, data: { org_kind: "handwerk" } }],
      app_settings: [{ when: { key: "org_language" }, data: [{ org_id: ORG, value: locale }] }],
    },
    rpcs: {
      provision_org: { data: { org_id: ORG, token: "tok-9" }, error: null },
      is_feature_enabled: { data: true, error: null },
    },
    usersById: {},
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" } }, error: null },
  });
}

async function sentInvitation(locale: EmailLocale, role: (typeof ROLES)[number]) {
  const { deps, calls, invokeCalls } = fake(locale);
  const res = await handle(makeRequest({
    headers: { Authorization: "Bearer x" },
    body: {
      name: "Acme Bau", slug: "acme-bau", admin_email: "a@acme.com", role,
      app_origin: "https://app.test", org_kind: "handwerk",
    },
  }), deps);
  assertEquals(res.status, 200);
  const upserted = calls
    .filter((c) => c.table === "app_settings" && c.method === "upsert")
    .flatMap((c) => c.args[0] as { key: string; value: unknown }[]);
  const copy = upserted.find((r) => r.key === "email_copy")?.value;
  assertExists(copy);
  const sent = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(sent);
  const data = (sent.body as { templateData: TemplateData }).templateData;
  const presentation = resolveTemplatePresentation("org-invitation", data, {
    copyOverride: copy as Record<string, string>,
    copyIsExplicit: true,
    locale,
    kind: "handwerk",
  });
  assertExists(presentation);
  const element = React.createElement(TEMPLATES["org-invitation"].component, presentation.props);
  const masked = (value: string) => value.split(APP_URL).join("{{APP_URL}}");
  return {
    subject: presentation.subject,
    html: masked(await renderAsync(element)),
    // The plain-text renderer wraps long lines; compare the words, not the line breaks.
    text: masked(await renderAsync(element, { plainText: true })).replace(/\s+/g, " "),
  };
}

for (const locale of ["de", "en"] as const) {
  for (const role of ROLES) {
    Deno.test(`werkbank invitation (${locale}, ${role}): no ShowFlow and no booking wording`, async () => {
      const email = await sentInvitation(locale, role);
      assertEquals(BOOKING_WORDS.exec(email.subject), null);
      assertEquals(BOOKING_WORDS.exec(email.text), null);
      assertEquals(BOOKING_WORDS.exec(email.html), null);
      assertEquals(email.subject.includes("Werkbank Digital"), true);
      assertEquals(email.text.includes("Werkbank Digital"), true);
    });
  }
}

Deno.test("werkbank invitation (de): the Werkbank copy is rendered", async () => {
  const admin = await sentInvitation("de", "admin");
  assertEquals(admin.subject, "Einladung zu Acme Bau bei Werkbank Digital");
  assertEquals(admin.text.includes("Werkbank Digital ist die Software, mit der Acme Bau Kunden, Aufträge und Rechnungen verwaltet."), true);
  assertEquals(admin.text.includes("Du bekommst volle Kontrolle über den Betrieb, inklusive Personen und Einstellungen."), true);
  assertEquals(admin.html.includes("Nimm die Einladung an und leg los."), true);
  assertEquals(admin.text.includes("Eingeladen von Werkbank Digital."), true);

  const office = await sentInvitation("de", "producer");
  assertEquals(office.text.includes("Du erstellst Angebote, Aufträge und Rechnungen und planst die Monteure ein."), true);

  const technician = await sentInvitation("de", "artist");
  assertEquals(technician.text.includes("Du siehst deine Aufträge und meldest sie als erledigt."), true);
});

Deno.test("werkbank invitation: the seeded override only touches org-invitation keys", () => {
  const copy = WERKBANK_PROVISIONING.handwerk.settings.email_copy;
  for (const key of Object.keys(copy)) assertEquals(key.startsWith("org-invitation."), true);
});
