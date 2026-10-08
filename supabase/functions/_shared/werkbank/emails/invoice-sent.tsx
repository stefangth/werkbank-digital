/// <reference types="npm:@types/react@18.3.1" />
// invoice-sent: the invoice (or cancellation invoice) to the business's customer, Factur-X PDF
// attached. German copy addresses the customer with "Sie". Modelled on quote-sent; there is no
// public invoice page, so the email has no call-to-action button.
import * as React from "npm:react@18.3.1";
import { Section, Text } from "npm:@react-email/components@0.0.22";
import type { TemplateData, TemplateEntry } from "../../transactional-email-templates/registry.ts";
import type { BrandDef } from "../../brand.ts";
import { DEFAULT_APP_BASE_URL, EmailShell, emailRoleStyle } from "../../transactional-email-templates/_shell/EmailShell.tsx";
import { applyEmailTokens, EMAIL_COPY_DEFAULTS, type EmailCopy, type EmailLocale } from "../../transactional-email-templates/_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "../../transactional-email-templates/_shell/emailTheme.ts";

interface Props {
  companyName?: string;
  invoiceNo?: string;
  kind?: "invoice" | "cancellation";
  /** The cancelled invoice's number, for a cancellation. */
  precedingNo?: string;
  grossFormatted?: string;
  dueDateFormatted?: string;
  /** The office's own message from the send dialog; replaces greeting and intro when set. */
  message?: string;
  _emailCopy?: EmailCopy;
  _emailTheme?: EmailTheme;
  _emailFamily?: EmailFamily;
  _highlightRole?: EmailRoleKey;
  _emailLocale?: EmailLocale;
  _emailBrand?: BrandDef;
}

const InvoiceSentEmail = ({
  companyName,
  invoiceNo,
  kind,
  precedingNo,
  grossFormatted,
  dueDateFormatted,
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
  const cancellation = kind === "cancellation";
  const values = {
    invoiceNo: invoiceNo || "",
    precedingNo: precedingNo || "",
    companyName: companyName || copy["invoice-sent.companyFallback"],
  };
  const body = { ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" };
  const data = { ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 8px" };
  const paragraphs = (message ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  return (
    <EmailShell family={_emailFamily} theme={theme} previewText={applyEmailTokens(copy[cancellation ? "invoice-sent.previewTextCancellation" : "invoice-sent.previewText"], values)} heading={copy[cancellation ? "invoice-sent.headingCancellation" : "invoice-sent.heading"]} footer={copy["invoice-sent.footer"]} highlightRole={_highlightRole} lang={_emailLocale} brand={_emailBrand}>
      {paragraphs.length > 0
        ? paragraphs.map((p, i) => <Text key={i} style={{ ...body, whiteSpace: "pre-line" }}>{p}</Text>)
        : <>
          <Text style={body}>{copy["invoice-sent.greeting"]}</Text>
          <Text style={body}>{applyEmailTokens(copy[cancellation ? "invoice-sent.introCancellation" : "invoice-sent.intro"], values)}</Text>
        </>}
      <Section style={{ margin: "24px 0", padding: "16px 20px", backgroundColor: theme.base.colors.tileBg, borderRadius: `${theme.base.buttonRadius}px` }}>
        {invoiceNo && <Text style={data}><strong>{copy[cancellation ? "invoice-sent.cancellationLabel" : "invoice-sent.invoiceLabel"]}</strong> {invoiceNo}</Text>}
        {cancellation && precedingNo && <Text style={data}><strong>{copy["invoice-sent.precedingLabel"]}</strong> {precedingNo}</Text>}
        {grossFormatted && <Text style={data}><strong>{copy["invoice-sent.amountLabel"]}</strong> {grossFormatted}</Text>}
        {!cancellation && dueDateFormatted && <Text style={{ ...data, margin: "0" }}><strong>{copy["invoice-sent.dueLabel"]}</strong> {dueDateFormatted}</Text>}
      </Section>
    </EmailShell>
  );
};

export const template = {
  component: InvoiceSentEmail as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) => applyEmailTokens(
    EMAIL_COPY_DEFAULTS[data.kind === "cancellation" ? "invoice-sent.subjectCancellation" : "invoice-sent.subject"],
    {
      invoiceNo: String(data.invoiceNo || ""),
      precedingNo: String(data.precedingNo || ""),
      companyName: String(data.companyName || EMAIL_COPY_DEFAULTS["invoice-sent.companyFallback"]),
    },
  ),
  displayName: "Invoice sent",
  previewData: {
    companyName: "Muster Sanitär GmbH",
    invoiceNo: "RE-0001",
    kind: "invoice",
    grossFormatted: "40,11 €",
    dueDateFormatted: "22.10.2026",
    message: "",
  },
} satisfies TemplateEntry;
