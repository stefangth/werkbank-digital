/// <reference types="npm:@types/react@18.3.1" />
// dunning-sent: a payment reminder or dunning notice to the business's customer, the notice PDF and
// the original invoice attached. German copy addresses the customer with "Sie". Modelled on
// invoice-sent; the stage title ("Zahlungserinnerung", "1. Mahnung", ...) arrives as data.
import * as React from "npm:react@18.3.1";
import { Section, Text } from "npm:@react-email/components@0.0.22";
import type { TemplateData, TemplateEntry } from "../../transactional-email-templates/registry.ts";
import type { BrandDef } from "../../brand.ts";
import { EmailShell, emailRoleStyle } from "../../transactional-email-templates/_shell/EmailShell.tsx";
import { applyEmailTokens, EMAIL_COPY_DEFAULTS, type EmailCopy, type EmailLocale } from "../../transactional-email-templates/_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "../../transactional-email-templates/_shell/emailTheme.ts";

interface Props {
  companyName?: string;
  stageTitle?: string;
  invoiceNo?: string;
  openAmount?: string;
  paymentDeadline?: string;
  /** The office's own message from the send dialog; replaces greeting and intro when set. */
  message?: string;
  _emailCopy?: EmailCopy;
  _emailTheme?: EmailTheme;
  _emailFamily?: EmailFamily;
  _highlightRole?: EmailRoleKey;
  _emailLocale?: EmailLocale;
  _emailBrand?: BrandDef;
}

const DunningSentEmail = ({
  companyName,
  stageTitle,
  invoiceNo,
  openAmount,
  paymentDeadline,
  message,
  _emailCopy = EMAIL_COPY_DEFAULTS as EmailCopy,
  _emailTheme = EMAIL_THEME_DEFAULTS,
  _emailFamily = "pine",
  _highlightRole,
  _emailLocale = "en",
  _emailBrand,
}: Props) => {
  const copy = _emailCopy;
  const theme = _emailTheme;
  const values = {
    stageTitle: stageTitle || "",
    invoiceNo: invoiceNo || "",
    companyName: companyName || copy["dunning-sent.companyFallback"],
  };
  const body = { ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" };
  const data = { ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 8px" };
  const paragraphs = (message ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  return (
    <EmailShell family={_emailFamily} theme={theme} previewText={applyEmailTokens(copy["dunning-sent.previewText"], values)} heading={applyEmailTokens(copy["dunning-sent.heading"], values)} footer={copy["dunning-sent.footer"]} highlightRole={_highlightRole} lang={_emailLocale} brand={_emailBrand}>
      {paragraphs.length > 0
        ? paragraphs.map((p, i) => <Text key={i} style={{ ...body, whiteSpace: "pre-line" }}>{p}</Text>)
        : <>
          <Text style={body}>{copy["dunning-sent.greeting"]}</Text>
          <Text style={body}>{applyEmailTokens(copy["dunning-sent.intro"], values)}</Text>
        </>}
      <Section style={{ margin: "24px 0", padding: "16px 20px", backgroundColor: theme.base.colors.tileBg, borderRadius: `${theme.base.buttonRadius}px` }}>
        {invoiceNo && <Text style={data}><strong>{copy["dunning-sent.invoiceLabel"]}</strong> {invoiceNo}</Text>}
        {openAmount && <Text style={data}><strong>{copy["dunning-sent.amountLabel"]}</strong> {openAmount}</Text>}
        {paymentDeadline && <Text style={{ ...data, margin: "0" }}><strong>{copy["dunning-sent.deadlineLabel"]}</strong> {paymentDeadline}</Text>}
      </Section>
    </EmailShell>
  );
};

export const template = {
  component: DunningSentEmail as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) => applyEmailTokens(EMAIL_COPY_DEFAULTS["dunning-sent.subject"], {
    stageTitle: String(data.stageTitle || ""),
    invoiceNo: String(data.invoiceNo || ""),
    companyName: String(data.companyName || EMAIL_COPY_DEFAULTS["dunning-sent.companyFallback"]),
  }),
  displayName: "Dunning notice sent",
  previewData: {
    companyName: "Muster Sanitär GmbH",
    stageTitle: "1. Mahnung",
    invoiceNo: "RE-0012",
    openAmount: "100,00 €",
    paymentDeadline: "15.10.2026",
    message: "",
  },
} satisfies TemplateEntry;
