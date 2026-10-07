/// <reference types="npm:@types/react@18.3.1" />
// quote-decision-confirmation: confirms the decision to the person who signed or declined on
// the public quote page; the accepted PDF is attached on accept. German copy uses "Sie".
import * as React from "npm:react@18.3.1";
import { Section, Text } from "npm:@react-email/components@0.0.22";
import type { TemplateData, TemplateEntry } from "../../transactional-email-templates/registry.ts";
import type { BrandDef } from "../../brand.ts";
import { EmailShell, emailRoleStyle } from "../../transactional-email-templates/_shell/EmailShell.tsx";
import { applyEmailTokens, EMAIL_COPY_DEFAULTS, type EmailCopy, type EmailLocale } from "../../transactional-email-templates/_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "../../transactional-email-templates/_shell/emailTheme.ts";

interface Props {
  quote_no?: string;
  company_name?: string;
  signer_name?: string;
  decision?: "accepted" | "rejected" | string;
  /** The decision date as printed, DD.MM.YYYY. */
  decided_at?: string;
  _emailCopy?: EmailCopy;
  _emailTheme?: EmailTheme;
  _emailFamily?: EmailFamily;
  _highlightRole?: EmailRoleKey;
  _emailLocale?: EmailLocale;
  _emailBrand?: BrandDef;
  appBaseUrl?: string;
}

const QuoteDecisionConfirmationEmail = ({
  quote_no,
  company_name,
  signer_name,
  decision,
  decided_at,
  _emailCopy = EMAIL_COPY_DEFAULTS as EmailCopy,
  _emailTheme = EMAIL_THEME_DEFAULTS,
  _emailFamily = "pine",
  _highlightRole,
  _emailLocale = "en",
  _emailBrand,
}: Props) => {
  const copy = _emailCopy;
  const theme = _emailTheme;
  const rejected = decision === "rejected";
  const values = {
    quoteNo: quote_no || "",
    signerName: signer_name || "",
    companyName: company_name || copy["quote-decision-confirmation.companyFallback"],
  };
  const body = { ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" };
  const data = { ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 8px" };

  // No call to action: the customer has decided, and the document is attached.
  return (
    <EmailShell family={_emailFamily} theme={theme} previewText={applyEmailTokens(copy["quote-decision-confirmation.previewText"], values)} heading={rejected ? copy["quote-decision-confirmation.headingRejected"] : copy["quote-decision-confirmation.headingAccepted"]} footer={copy["quote-decision-confirmation.footer"]} highlightRole={_highlightRole} lang={_emailLocale} brand={_emailBrand}>
      <Text style={body}>{signer_name ? applyEmailTokens(copy["quote-decision-confirmation.greeting"], values) : copy["quote-decision-confirmation.greetingAnonymous"]}</Text>
      <Text style={body}>{applyEmailTokens(rejected ? copy["quote-decision-confirmation.introRejected"] : copy["quote-decision-confirmation.introAccepted"], values)}</Text>
      {(quote_no || decided_at) && (
        <Section style={{ margin: "24px 0", padding: "16px 20px", backgroundColor: theme.base.colors.tileBg, borderRadius: `${theme.base.buttonRadius}px` }}>
          {quote_no && <Text style={data}><strong>{copy["quote-decision-confirmation.quoteLabel"]}</strong> {quote_no}</Text>}
          {decided_at && <Text style={{ ...data, margin: "0" }}><strong>{copy["quote-decision-confirmation.decidedAtLabel"]}</strong> {decided_at}</Text>}
        </Section>
      )}
      {!rejected && <Text style={{ ...body, margin: "0" }}>{applyEmailTokens(copy["quote-decision-confirmation.followupAccepted"], values)}</Text>}
    </EmailShell>
  );
};

export const template = {
  component: QuoteDecisionConfirmationEmail as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) => applyEmailTokens(
    data.decision === "rejected"
      ? EMAIL_COPY_DEFAULTS["quote-decision-confirmation.subjectRejected"]
      : EMAIL_COPY_DEFAULTS["quote-decision-confirmation.subjectAccepted"],
    { quoteNo: String(data.quote_no || "") },
  ),
  displayName: "Quote decision confirmation",
  previewData: {
    quote_no: "A-0042",
    company_name: "Muster Sanitär GmbH",
    signer_name: "Anna Muster",
    decision: "accepted",
    decided_at: "08.10.2026",
  },
} satisfies TemplateEntry;
