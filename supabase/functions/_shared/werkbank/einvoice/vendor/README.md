# Vendored: @e-invoice-eu/core

`e-invoice-eu-core-3.4.0.mjs` is the single-file Deno build of
[`@e-invoice-eu/core`](https://github.com/gflohr/e-invoice-eu) 3.4.0 as served by esm.sh. It is
vendored instead of imported as `npm:@e-invoice-eu/core`, because the npm import embeds the whole
package (every build, source maps, an Excel library) into the edge function bundle, which then
exceeds the Supabase upload limit (HTTP 413). Vendoring also fixes the exact bytes that render the
legally relevant e-invoice: nothing changes unless this file changes in git, and
`../vendor.test.ts` fails CI if the file no longer matches the sha256 in its header. Deploy and
runtime do not touch esm.sh; only `deno check` fetches the package's type declarations from there
(see below), so an esm.sh outage can fail a type-check run, never a deploy.

The build bundles the library's dependencies; each keeps its own license. Its direct
dependencies (versions as resolved by npm when this copy was taken; their own dependencies are
bundled too and keep their licenses):

| Package | License |
|---|---|
| `@e-invoice-eu/core` 3.4.0 | WTFPL (`LICENSE` here) |
| `@cantoo/pdf-lib` 2.11.1 | MIT |
| `@e965/xlsx` 0.20.3 | Apache-2.0 |
| `@esgettext/runtime` 1.3.10 | WTFPL |
| `ajv` 8.20.0 | MIT |
| `jsonpath-plus` 11.1.1 | MIT |
| `tmp-promise` 3.0.3 | MIT |
| `tslib` 2.8.1 | 0BSD |
| `xmlbuilder2` 4.0.3 | MIT |

The file imports only pinned Node polyfills from `https://deno.land/std@0.177.1/node/`, which the
Supabase bundler inlines at deploy time (so a deploy needs deno.land reachable, like other
functions that import `std`).

The sha256 in the file header is that of the downloaded build, before the header was added and the
source map comment removed.

Types come from the package's `dist/index.d.ts` (type-only import, no runtime effect).

## Refresh (new library version)

1. `curl -s "https://esm.sh/@e-invoice-eu/core@<version>/deno/core.bundle.mjs" -o core.bundle.mjs`
2. Note `shasum -a 256 core.bundle.mjs`, drop the trailing `//# sourceMappingURL=` line, prepend the
   header of the current file with the new version and hash, and save it as
   `e-invoice-eu-core-<version>.mjs` (delete the old file, update `LICENSE` if it changed).
3. Point `../renderEInvoice.ts` and `../facturx.ts` at the new version.
4. Point `../vendor.test.ts` at the new file name (it checks the header hash).
5. Run the Deno tests and the Mustang job (`einvoice-validate`); both must pass.
