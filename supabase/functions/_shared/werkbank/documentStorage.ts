// Storage helpers shared by the Werkbank document functions (quotes, invoices, dunning, visit reports).
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import type { Deps } from "../deps.ts";

/** Issued documents (quotes, invoices, signatures), written only by the service role. */
export const DOCUMENTS_BUCKET = "werkbank-documents";
/** Company assets such as the logo (company_profiles.logo_path). */
export const ASSETS_BUCKET = "werkbank-assets";

/** Storage's "object exists" answer to an upload with upsert: false. */
export function isAlreadyExists(error: unknown): boolean {
  const e = error as { statusCode?: unknown; status?: unknown; message?: unknown };
  return String(e.statusCode) === "409" || e.status === 409 || /already exists/i.test(String(e.message ?? ""));
}

/** Technician visit photos and signatures (werkbank.visit_reports, visit_report_photos). */
export const VISITS_BUCKET = "werkbank-visits";

/** An image object as a data URL for a PDF, or undefined when it is missing, unreadable or not
 *  a PNG/JPEG. Downloaded with the service role. */
export async function imageDataUrl(
  deps: Pick<Deps, "admin">,
  bucket: string,
  path: string | null | undefined,
): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    const { data, error } = await deps.admin.storage.from(bucket).download(path);
    if (error || !data) return undefined;
    const blob = data as Blob;
    const lower = path.toLowerCase();
    const mime = blob.type?.startsWith("image/")
      ? blob.type
      : lower.endsWith(".png") ? "image/png" : /\.jpe?g$/.test(lower) ? "image/jpeg" : null;
    if (!mime) return undefined;
    return `data:${mime};base64,${encodeBase64(new Uint8Array(await blob.arrayBuffer()))}`;
  } catch {
    return undefined;
  }
}

/** The org's logo as a data URL for the PDF, or undefined when there is none or it cannot be read. */
export function logoDataUrl(deps: Pick<Deps, "admin">, path: string | null | undefined): Promise<string | undefined> {
  return imageDataUrl(deps, ASSETS_BUCKET, path);
}
