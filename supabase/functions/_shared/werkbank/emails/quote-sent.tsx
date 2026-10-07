/// <reference types="npm:@types/react@18.3.1" />
// quote-sent: the quote to the business's customer, PDF attached, with the link to the public
// quote page. German copy addresses the customer with "Sie". Modelled on hire-order-issued.
import * as React from "npm:react@18.3.1";
import { Section, Text } from "npm:@react-email/components@0.0.22";
import type { TemplateData, TemplateEntry } from "../../transactional-email-templates/registry.ts";
import type { BrandDef } from "../../brand.ts";
import { DEFAULT_APP_BASE_URL, EmailShell, emailRoleStyle } from "../../transactional-email-templates/_shell/EmailShell.tsx";
import { applyEmailTokens, EMAIL_COPY_DEFAULTS, type EmailCopy, type EmailLocale } from "../../transactional-email-templates/_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "../../transactional-email-templates/_shell/emailTheme.ts";

interface Props {
  quote_no?: string;
  company_name?: string;
  subject?: string;
  valid_until?: string;
  /** The office's own message from the send dialog; replaces greeting and intro when set. */
  message?: string;
  link?: string;
  _emailCopy?: EmailCopy;
  _emailTheme?: EmailTheme;
  _emailFamily?: EmailFamily;
  _highlightRole?: EmailRoleKey;
  _emailLocale?: EmailLocale;
  _emailBrand?: BrandDef;
  appBaseUrl?: string;
}

const QuoteSentEmail = ({
  quote_no,
  company_name,
  subject,
  valid_until,
  message,
  link,
  _emailCopy = EMAIL_COPY_DEFAULTS as EmailCopy,
  _emailTheme = EMAIL_THEME_DEFAULTS,
  _emailFamily = "pine",
  _highlightRole,
  _emailLocale = "en",
  _emailBrand,
  appBaseUrl = DEFAULT_APP_BASE_URL,
}: Props) => {
  const copy = _emailCopy;
  const theme = _emailTheme;
  const values = { quoteNo: quote_no || "", companyName: company_name || copy["quote-sent.companyFallback"] };
  const href = link || appBaseUrl;
  const body = { ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" };
  const data = { ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 8px" };
  const paragraphs = (message ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  return (
    <EmailShell family={_emailFamily} theme={theme} previewText={applyEmailTokens(copy["quote-sent.previewText"], values)} heading={copy["quote-sent.heading"]} footer={copy["quote-sent.footer"]} cta={{ href, label: copy["quote-sent.ctaLabel"] }} highlightRole={_highlightRole} lang={_emailLocale} brand={_emailBrand}>
      {paragraphs.length > 0
        ? paragraphs.map((p, i) => <Text key={i} style={{ ...body, whiteSpace: "pre-line" }}>{p}</Text>)
        : <>
          <Text style={body}>{copy["quote-sent.greeting"]}</Text>
          <Text style={body}>{applyEmailTokens(copy["quote-sent.intro"], values)}</Text>
        </>}
      <Section style={{ margin: "24px 0", padding: "16px 20px", backgroundColor: theme.base.colors.tileBg, borderRadius: `${theme.base.buttonRadius}px` }}>
        {quote_no && <Text style={data}><strong>{copy["quote-sent.quoteLabel"]}</strong> {quote_no}</Text>}
        {subject && <Text style={data}><strong>{copy["quote-sent.subjectLabel"]}</strong> {subject}</Text>}
        {valid_until && <Text style={{ ...data, margin: "0" }}><strong>{copy["quote-sent.validUntilLabel"]}</strong> {valid_until}</Text>}
      </Section>
      <Text style={body}>{copy["quote-sent.acceptPrompt"]}</Text>
      <Text style={{ ...emailRoleStyle(theme, "footer", _highlightRole), margin: "0 0 8px" }}>{copy["quote-sent.pasteLink"]}</Text>
      <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0" }}>{href}</Text>
    </EmailShell>
  );
};

export const template = {
  component: QuoteSentEmail as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) => applyEmailTokens(EMAIL_COPY_DEFAULTS["quote-sent.subject"], {
    quoteNo: String(data.quote_no || ""),
    companyName: String(data.company_name || EMAIL_COPY_DEFAULTS["quote-sent.companyFallback"]),
  }),
  displayName: "Quote sent",
  previewData: {
    quote_no: "A-0042",
    company_name: "Muster Sanitär GmbH",
    subject: "Badsanierung Obergeschoss",
    valid_until: "06.11.2026",
    message: "",
    link: `${DEFAULT_APP_BASE_URL}/quote/preview`,
  },
} satisfies TemplateEntry;
