import type { DunningDueRow } from "../data/dunning";
import { defaultRecipient } from "./defaultRecipient";

/** The address a due row's notice goes to (the server resolves the same one for `send: {}`). */
export const dueRecipient = (r: DunningDueRow) =>
  defaultRecipient({ invoice_email: r.customer_invoice_email, email: r.customer_email }, { email: r.contact_email });
