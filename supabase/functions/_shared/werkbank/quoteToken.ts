// Quote link tokens and document hashes. The link carries 32 random bytes as hex; the
// database stores only the SHA-256 hex of that hex string, so a leaked table row cannot be
// turned back into a working link. The public actions look a token up with the same hash.

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** SHA-256 as lowercase hex. A string is hashed as its UTF-8 bytes. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view: digest() rejects SharedArrayBuffer views.
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

/** A fresh link token (64 hex characters) and the hash to store for it. */
export async function newQuoteToken(): Promise<{ token: string; hash: string }> {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  return { token, hash: await sha256Hex(token) };
}
