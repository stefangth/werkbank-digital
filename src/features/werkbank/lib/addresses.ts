/** Addresses typed or pasted into a recipient field: separated by comma, semicolon or whitespace;
 *  a pasted `Name <address>` (also with a quoted name) counts as its address; an address typed
 *  twice is kept once (compared case-insensitively). Format checks stay on the server. */
export function splitAddresses(value: string): string[] {
  const flat = value
    .replace(/"[^"]*"/g, " ")
    .replace(/[^,;\n<>]*<([^<>\s]+)>/g, ",$1,");
  const seen = new Set<string>();
  return flat.split(/[,;\s]+/).filter((a) => {
    const key = a.toLowerCase();
    if (!a || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
