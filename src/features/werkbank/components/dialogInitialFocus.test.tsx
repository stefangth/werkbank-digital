import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const m = vi.hoisted(() => {
  const act = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    profile: {
      data: {
        company_name: "Muster GmbH", street: "Weg 1", postal_code: "01067", city: "Dresden",
        email: "info@muster.de", tax_number: "123", vat_id: null, iban: "DE02120300000000202051", dunning_deadline_days: 7,
      } as unknown,
      isLoading: false, isError: false,
    },
    items: { data: [{ id: "i1", kind: "item" }] as unknown[], isLoading: false },
    contacts: { data: [] as unknown[] },
    customer: { data: { id: "c1", email: "kunde@example.de", invoice_email: "rechnung@example.de", street: "S 1", postal_code: "01067", city: "Dresden" }, isError: false },
    property: { data: null as unknown, isError: false },
    a: act(), b: act(), c: act(), d: act(),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("../hooks/useCompanyProfile", () => ({ useCompanyProfile: () => m.profile }));
vi.mock("../hooks/useDocumentItems", () => ({ useDocumentItems: () => m.items }));
vi.mock("../hooks/useContacts", () => ({ useContacts: () => m.contacts }));
vi.mock("../hooks/useCustomers", () => ({ useCustomer: () => m.customer }));
vi.mock("../hooks/useProperties", () => ({ useProperty: () => m.property }));
vi.mock("../hooks/useInvoiceActions", () => ({ useIssueInvoice: () => m.a, useSendInvoice: () => m.b }));
vi.mock("../hooks/useQuoteActions", () => ({ useQuoteActions: () => ({ preview: m.a, send: m.b, resend: m.c }) }));
vi.mock("../hooks/useDunningActions", () => ({ useIssueDunning: () => m.a, usePreviewDunning: () => m.b, useSendDunning: () => m.c }));
vi.mock("../hooks/useOpenItems", () => ({ useRecordEntry: () => m.d }));

import { IssueInvoiceDialog } from "./IssueInvoiceDialog";
import { SendQuoteDialog } from "./SendQuoteDialog";
import { CreateDunningDialog } from "./CreateDunningDialog";
import { SendDunningDialog } from "./SendDunningDialog";
import { RecordEntryDialog } from "./RecordEntryDialog";

const render = (ui: React.ReactElement) =>
  renderWithProviders(ui, { authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never } });
const noop = vi.fn();

const CASES: [string, () => React.ReactElement, RegExp][] = [
  ["IssueInvoiceDialog", () => <IssueInvoiceDialog invoice={{ id: "i1", customer_id: "c1", property_id: null, contact_id: null, type: "invoice", service_date_from: "2026-10-01", invoice_no: null } as never} mode="issue" open onOpenChange={noop} onStateChanged={noop} />, /^An$/],
  ["SendQuoteDialog", () => <SendQuoteDialog quote={{ id: "q1", customer_id: "c1", property_id: null, contact_id: null, status: "draft", valid_until: "2999-01-01", quote_no: 7, version: 1 } as never} open onOpenChange={noop} onResend={noop} />, /^An$/],
  ["CreateDunningDialog", () => <CreateDunningDialog invoice={{ id: "i1", customer_id: "c1", contact_id: null }} stage={1} onOpenChange={noop} />, /^Empfänger$/],
  ["SendDunningDialog", () => <SendDunningDialog notice={{ id: "n1", invoice_id: "i1", stage: 1, sent_to: null } as never} invoice={{ customer_id: "c1", contact_id: null }} retry={false} onOpenChange={noop} />, /^Empfänger$/],
  ["RecordEntryDialog (payment)", () => <RecordEntryDialog invoiceId="i1" mode="payment" openAmount={100} refreshing={false} onStale={noop} onOpenChange={noop} />, /^Buchungsdatum$/],
];

describe("dialogs focus the first field, not the hint", () => {
  beforeEach(async () => {
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => {
    localStorage.removeItem(STORAGE_KEY);
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it.each(CASES)("%s", async (_name, ui, label) => {
    render(ui());
    const first = await screen.findByLabelText(label);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(first).toHaveFocus();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
