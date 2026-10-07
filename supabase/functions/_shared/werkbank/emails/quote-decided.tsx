/// <reference types="npm:@types/react@18.3.1" />
// quote-decided: tells the office (admins and producers of the org) that a customer accepted
// or declined a quote online. Office copy, so the German base uses "Du".
import * as React from "npm:react@18.3.1";
import { Section, Text } from "npm:@react-email/components@0.0.22";
import type { TemplateData, TemplateEntry } from "../../transactional-email-templates/registry.ts";
import type { BrandDef } from "../../brand.ts";
import { DEFAULT_APP_BASE_URL, EmailShell, emailRoleStyle } from "../../transactional-email-templates/_shell/EmailShell.tsx";
import { applyEmailTokens, EMAIL_COPY_DEFAULTS, type EmailCopy, type EmailLocale } from "../../transactional-email-templates/_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "../../transactional-email-templates/_shell/emailTheme.ts";

interface Props {
  quote_no?: string;
  customer_name?: string;
  signer_name?: string;
  decision?: "accepted" | "rejected" | string;
  comment?: string;
  /** The quote page in the app, /quotes/:id. */
  link?: string;
  _emailCopy?: EmailCopy;
  _emailTheme?: EmailTheme;
  _emailFamily?: EmailFamily;
  _highlightRole?: EmailRoleKey;
  _emailLocale?: EmailLocale;
  _emailBrand?: BrandDef;
  appBaseUrl?: string;
}

const QuoteDecidedEmail = ({
  quote_no,
  customer_name,
  signer_name,
  decision,
  comment,
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
  const rejected = decision === "rejected";
  const values = {
    quoteNo: quote_no || "",
    signerName: signer_name || copy["quote-decided.signerFallback"],
    customerName: customer_name || copy["quote-decided.customerFallback"],
  };
  const href = link || appBaseUrl;
  const body = { ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" };

  return (
    <EmailShell family={_emailFamily} theme={theme} previewText={applyEmailTokens(copy["quote-decided.previewText"], values)} heading={rejected ? copy["quote-decided.headingRejected"] : copy["quote-decided.headingAccepted"]} footer={copy["quote-decided.footer"]} cta={{ href, label: copy["quote-decided.ctaLabel"] }} highlightRole={_highlightRole} lang={_emailLocale} brand={_emailBrand}>
      <Text style={body}>{applyEmailTokens(rejected ? copy["quote-decided.introRejected"] : copy["quote-decided.introAccepted"], values)}</Text>
      {comment && (
        <Section style={{ margin: "24px 0", padding: "16px 20px", backgroundColor: theme.base.colors.tileBg, borderRadius: `${theme.base.buttonRadius}px` }}>
          <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0", whiteSpace: "pre-line" }}><strong>{copy["quote-decided.commentLabel"]}</strong> {comment}</Text>
        </Section>
      )}
    </EmailShell>
  );
};

export const template = {
  component: QuoteDecidedEmail as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) => applyEmailTokens(
    data.decision === "rejected" ? EMAIL_COPY_DEFAULTS["quote-decided.subjectRejected"] : EMAIL_COPY_DEFAULTS["quote-decided.subjectAccepted"],
    { quoteNo: String(data.quote_no || "") },
  ),
  displayName: "Quote decided",
  previewData: {
    quote_no: "A-0042",
    customer_name: "Anna Muster",
    signer_name: "Anna Muster",
    decision: "accepted",
    comment: "Bitte im November ausführen.",
    link: `${DEFAULT_APP_BASE_URL}/quotes/preview`,
  },
} satisfies TemplateEntry;
