/** Signatures stored as signature.png whose `sign_visit_report` failed, by report id. They outlive
 *  the sign step (back to the report, sheet closed and reopened), so a retry signs the stored
 *  image and never a redrawn one, which the upload would answer with "already exists". */
export const uploadedSignatures = new Map<string, { png: Blob; signerName: string }>();

/** Sign out: a stored signature must not outlive the user who took it on a shared phone. */
export function clearUploadedSignatures(): void {
  uploadedSignatures.clear();
}
