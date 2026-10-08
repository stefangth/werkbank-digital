// Pure mapping from a dunning notice row, its invoice (with the issue-time snapshots), the
// property name and earlier notices to the object the notice PDF renders. Seller and buyer come
// from the invoice snapshots; only the stage text comes from the current company profile.
import type { Database } from "../../database.types.ts";
import type { BuyerSnapshot, CompanyProfileRow, InvoiceRow, SellerSnapshot } from "../einvoice/invoiceData.ts";
import { DUNNING_STAGE_TITLES, stageText } from "../dunningDefaults.ts";

export type DunningNoticeRow = Database["werkbank"]["Tables"]["dunning_notices"]["Row"];
type Stage = 1 | 2 | 3;

export interface DunningData {
  stage: Stage;
  title: string;
  noticeDate: string;
  paymentDeadline: string;
  invoice: { no: string; issueDate: string; dueDate: string; propertyName: string | null };
  invoiceGross: number;
  paidAmount: number;
  /** invoiceGross - paidAmount - openAmount (skonto, goodwill): the row that makes the table add up. */
  writtenOff: number;
  openAmount: number;
  text: string;
  earlierNotices: { stage: Stage; date: string }[];
  seller: SellerSnapshot;
  buyer: BuyerSnapshot;
  draft: boolean;
}

export interface DunningInput {
  notice: Pick<DunningNoticeRow, "stage" | "notice_date" | "payment_deadline" | "invoice_gross" | "paid_amount" | "open_amount">;
  invoice: InvoiceRow;
  propertyName: string | null;
  profile: CompanyProfileRow;
  earlier: Pick<DunningNoticeRow, "stage" | "notice_date">[];
  draft: boolean;
}

export function buildDunningData(input: DunningInput): DunningData {
  const { notice, invoice, profile } = input;
  const stage = notice.stage as Stage;
  const seller = invoice.seller_snapshot as unknown as SellerSnapshot | null;
  const buyer = invoice.buyer_snapshot as unknown as BuyerSnapshot | null;
  if (!seller || !buyer || !invoice.invoice_no || !invoice.issue_date || !invoice.due_date) throw new Error("invoice_snapshot_missing");
  return {
    stage,
    title: DUNNING_STAGE_TITLES[stage],
    noticeDate: notice.notice_date,
    paymentDeadline: notice.payment_deadline,
    invoice: { no: invoice.invoice_no, issueDate: invoice.issue_date, dueDate: invoice.due_date, propertyName: input.propertyName },
    invoiceGross: notice.invoice_gross,
    paidAmount: notice.paid_amount,
    // The snapshot holds no written-off amount; it is what the other three leave over (cents).
    writtenOff: Math.round((Number(notice.invoice_gross) - Number(notice.paid_amount) - Number(notice.open_amount)) * 100) / 100,
    openAmount: notice.open_amount,
    text: stageText(stage, profile),
    earlierNotices: input.earlier
      .map((e) => ({ stage: e.stage as Stage, date: e.notice_date }))
      .sort((a, b) => a.stage - b.stage),
    seller,
    buyer,
    draft: input.draft,
  };
}
