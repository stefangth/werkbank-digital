// Storage helpers shared by the Werkbank document functions (werkbank-quotes, werkbank-invoices).
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

/** The org's logo as a data URL for the PDF, or undefined when there is none or it cannot be read. */
export async function logoDataUrl(deps: Deps, path: string | null | undefined): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    const { data, error } = await deps.admin.storage.from(ASSETS_BUCKET).download(path);
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
