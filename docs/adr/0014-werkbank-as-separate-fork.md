# ADR-0014: Werkbank Digital runs as a separate fork of Showflow

**Status:** Accepted
**Date:** 2026-10-07
**Deciders:** Owner
**Supersedes:** [ADR-0013](0013-werkbank-as-removable-module.md)

## Context

ADR-0013 placed Werkbank Digital as a removable module inside the Showflow codebase and its
Supabase project. Teil 1 of that plan (org kind `handwerk`, brand registry, kind-aware
surfaces, technicians page, empty `werkbank` schema, isolation guards) was merged into
Showflow as PR #386 on 2026-10-06.

On 2026-10-07 the owner decided to run Werkbank Digital separately from Showflow instead:
its own repository and its own Supabase project, so the two products no longer share a
database, a deploy or a release train.

## Decision

1. **This repository (`stefangth/werkbank-digital`) is a fork of `showflow-pro` with full
   history**, taken at Showflow `main` `3b49409b`, which includes all of Werkbank Teil 1.
2. **It runs on its own Supabase project `wmtbjajmnjxefrhkchts`.** The project ref in
   `supabase/config.toml`, the deploy and migration-check workflows and the scripts points
   there. `private.functions_base_url()` defaults to this project
   (`20261007130000_functions_base_url_werkbank.sql`), so pg_cron and trigger dispatches
   never call Showflow.
3. **Showflow reverted Teil 1** (showflow-pro PR #387) and withdrew ADR-0013 there. The two
   codebases evolve independently from here; fixes are not synced automatically.
4. **The Showflow domain stays in place for now.** Removing what Werkbank does not need
   (shows, bookings, hire orders, Airtable sync, the production and staffing kinds) is a
   later, separate step with its own spec.

## Options Considered

| Option | Summary | Verdict |
|---|---|---|
| Module inside Showflow (ADR-0013) | One codebase and backend, removable by construction | Withdrawn: the owner wants separate data, deploys and release trains |
| **Fork with full history, own Supabase project** | Starts from everything Teil 1 built, including the platform layer | **Chosen** |
| New repository, port the platform layer selectively | Clean start | Rejected: weeks of porting auth, orgs, invites, email and PDF before any Werkbank feature |

## Consequences

- The fork inherits the Showflow domain: about 1100 domain-coupled files and 246 migrations
  up to Teil 1. A fresh database applies all of them; the Showflow tables stay empty.
- The isolation rules of ADR-0013 (plugin paths, `werkbank` schema, guards) still hold in
  this repository and keep the later clean-up tractable, but they are no longer required for
  removability.
- Platform-layer fixes made in Showflow after the fork must be ported by hand when needed.
- Project setup that no migration can do is manual: Auth URLs, mail sender, edge-function
  secrets, the `werkbank` entry under "Exposed schemas" (after the migrations), and the
  GitHub secrets `SUPABASE_ACCESS_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN`.
