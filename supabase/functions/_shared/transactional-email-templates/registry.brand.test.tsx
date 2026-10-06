/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { assertEquals, assertExists } from "../test-asserts.ts";
import { APP_URL } from "../app-url.ts";
import type { OrgKind } from "../orgKind.ts";
import { brandAppUrl, brandForKind, type BrandDef } from "../brand.ts";
import type { EmailLocale } from "./_shell/emailCopy.ts";
import { resolveTemplatePresentation, TEMPLATES, type TemplateData } from "./registry.ts";

// Byte-identity guard for the brand refactor: every registered template, rendered for the
// showflow kinds through the same registry path delivery uses, must match the render that
// was captured before brands existed. The deployment origin is replaced by a placeholder so
// the baseline does not depend on the APP_URL secret of the machine running the tests.
// HTML and plain text are stored as SHA-256 digests to keep the fixture small; the subject
// is stored verbatim. Regenerate deliberately with EMAIL_RENDER_BASELINE_UPDATE=1 when a
// template changes on purpose.
const BASELINE_URL = new URL("./__fixtures__/render-baseline.json", import.meta.url);
const APP_URL_PLACEHOLDER = "{{APP_URL}}";

// Fixed data so nothing in the render depends on the clock. "preview" exercises the full
// template; "empty" exercises every fallback branch (default links, fallback nouns).
const FIXED_OVERRIDES: Record<string, TemplateData> = {
  "org-invitation": { expiresOn: "November 5, 2026" },
};

function fixtures(name: string): Record<string, TemplateData> {
  return {
    preview: { ...(TEMPLATES[name].previewData ?? {}), ...(FIXED_OVERRIDES[name] ?? {}) },
    empty: {},
  };
}

const KINDS: readonly OrgKind[] = ["production", "staffing"];
const LOCALES: readonly EmailLocale[] = ["en", "de"];

interface RenderedEmail {
  subject: string;
  /** SHA-256 of the normalized HTML. */
  html: string;
  /** SHA-256 of the normalized plain-text alternative. */
  text: string;
}

function normalize(value: string): string {
  return value.split(APP_URL).join(APP_URL_PLACEHOLDER);
}

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalize(value))));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function renderAll(): Promise<Record<string, RenderedEmail>> {
  const out: Record<string, RenderedEmail> = {};
  for (const name of Object.keys(TEMPLATES).sort()) {
    for (const [fixtureName, data] of Object.entries(fixtures(name))) {
      for (const kind of KINDS) {
        for (const locale of LOCALES) {
          const presentation = resolveTemplatePresentation(name, data, { kind, locale });
          assertExists(presentation);
          const element = React.createElement(TEMPLATES[name].component, presentation.props);
          out[`${name}/${fixtureName}/${kind}/${locale}`] = {
            subject: normalize(presentation.subject),
            html: await digest(await renderAsync(element)),
            text: await digest(await renderAsync(element, { plainText: true })),
          };
        }
      }
    }
  }
  return out;
}

Deno.test("every registered template renders byte-identically to the pre-brand baseline", async () => {
  const actual = await renderAll();
  if (Deno.env.get("EMAIL_RENDER_BASELINE_UPDATE") === "1") {
    await Deno.writeTextFile(BASELINE_URL, `${JSON.stringify(actual, null, 2)}\n`);
  }
  const expected = JSON.parse(await Deno.readTextFile(BASELINE_URL)) as Record<string, RenderedEmail>;
  assertEquals(Object.keys(actual).sort(), Object.keys(expected).sort(), "same render matrix");
  for (const key of Object.keys(expected)) {
    assertEquals(actual[key].subject, expected[key].subject, `${key}: subject`);
    assertEquals(actual[key].html, expected[key].html, `${key}: html`);
    assertEquals(actual[key].text, expected[key].text, `${key}: text`);
  }
});

const TEST_BRAND: BrandDef = {
  key: "test",
  name: "Test Brand",
  markSvgPath: null,
  emailMarkPath: "/t.png",
  faviconPath: "/t.svg",
  appUrl: "https://t.example",
  hosts: [],
  defaultFrom: null,
};

Deno.test("a brand passed to the registry supplies the template base URL, mark and name", async () => {
  const presentation = resolveTemplatePresentation("org-invitation", { orgName: "Acme", token: "tok" }, {
    kind: "production",
    brand: TEST_BRAND,
  });
  assertExists(presentation);
  assertEquals(presentation.props.appBaseUrl, "https://t.example");
  const html = await renderAsync(React.createElement(TEMPLATES["org-invitation"].component, presentation.props));
  assertEquals(html.includes("https://t.example/accept-invite?token=tok"), true, "accept link uses the brand origin");
  assertEquals(html.includes("https://t.example/t.png"), true, "shell mark uses the brand origin and mark");
  assertEquals(html.includes("Test Brand"), true, "shell wordmark uses the brand name");
});

Deno.test("the registry defaults the brand to the kind's brand", () => {
  const presentation = resolveTemplatePresentation("org-invitation", { token: "tok" }, { kind: "production" });
  assertExists(presentation);
  assertEquals(presentation.props._emailBrand, brandForKind("production"));
  assertEquals(presentation.props.appBaseUrl, brandAppUrl(brandForKind("production"), APP_URL));
});

for (const name of Object.keys(TEMPLATES).sort()) {
  Deno.test(`${name}: with a non-default brand no link or image falls back to the deployment origin`, async () => {
    const presentation = resolveTemplatePresentation(name, {}, { kind: "production", brand: TEST_BRAND });
    assertExists(presentation);
    const html = await renderAsync(React.createElement(TEMPLATES[name].component, presentation.props));
    assertEquals(html.includes(APP_URL), false, `${name} renders no ${APP_URL} link`);
    assertEquals(html.includes("https://t.example/t.png"), true, `${name} renders the brand mark`);
  });
}
