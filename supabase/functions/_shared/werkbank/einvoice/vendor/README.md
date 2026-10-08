# Vendored: @e-invoice-eu/core

`e-invoice-eu-core-3.4.0.mjs` is the single-file Deno build of
[`@e-invoice-eu/core`](https://github.com/gflohr/e-invoice-eu) 3.4.0 as served by esm.sh. It is
vendored instead of imported as `npm:@e-invoice-eu/core`, because the npm import embeds the whole
package (every build, source maps, an Excel library) into the edge function bundle, which then
exceeds the Supabase upload limit (HTTP 413). Vendoring also fixes the exact bytes that render the
legally relevant e-invoice: nothing changes unless this file changes in git.

The build bundles the library's dependencies (among them `@cantoo/pdf-lib`, `@e965/xlsx`, `ajv`,
`xmlbuilder2`, `jsonpath-plus`); each keeps its own license. It imports only pinned Node polyfills
from `https://deno.land/std@0.177.1/node/`.

Types come from the package's `dist/index.d.ts` (type-only import, no runtime effect).

## Refresh (new library version)

1. `curl -s "https://esm.sh/@e-invoice-eu/core@<version>/deno/core.bundle.mjs" -o core.bundle.mjs`
2. Note `shasum -a 256 core.bundle.mjs`, drop the trailing `//# sourceMappingURL=` line, prepend the
   header of the current file with the new version and hash, and save it as
   `e-invoice-eu-core-<version>.mjs` (delete the old file, update `LICENSE` if it changed).
3. Point `../renderEInvoice.ts` and `../facturx.ts` at the new version.
4. Run the Deno tests and the Mustang job (`einvoice-validate`); both must pass.
