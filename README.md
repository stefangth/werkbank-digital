# Werkbank Digital

Back-office SaaS for trade businesses (Handwerksbetriebe): customers, quotes, orders,
invoices with e-invoicing (ZUGFeRD), dunning, and a mobile view for technicians.

This repository is a fork of Showflow Pro with full history (see
[ADR-0014](docs/adr/0014-werkbank-as-separate-fork.md)). It runs on its own Supabase project
`wmtbjajmnjxefrhkchts`. Werkbank code lives in `src/features/werkbank/`; much of the rest is
still the Showflow platform and domain, to be trimmed in a later step.

Start with [CLAUDE.md](CLAUDE.md) for conventions, commands and the local stack.
