// Recipient rules shared by werkbank-quotes and werkbank-invoices: every address must look like
// an email, duplicates collapse case-insensitively (to before cc), at most MAX_RECIPIENTS in all.

export const MAX_RECIPIENTS = 10;
// Same shape as REPLY_TO_RE in send-transactional-email and the company_profiles.email check.
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type RecipientError = "invalid_recipient" | "too_many_recipients";

/** Validates and dedupes trimmed, non-empty addresses. */
export function checkRecipients(to: string[], cc: string[]): { to: string[]; cc: string[] } | { error: RecipientError } {
  if ([...to, ...cc].some((a) => !EMAIL_RE.test(a))) return { error: "invalid_recipient" };
  const seen = new Set<string>();
  const unique = (addrs: string[]) =>
    addrs.filter((a) => {
      const key = a.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const uniqueTo = unique(to);
  const uniqueCc = unique(cc);
  if (uniqueTo.length + uniqueCc.length > MAX_RECIPIENTS) return { error: "too_many_recipients" };
  return { to: uniqueTo, cc: uniqueCc };
}
