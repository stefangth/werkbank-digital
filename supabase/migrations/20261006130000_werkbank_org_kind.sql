-- Werkbank plugin: register the handwerk org kind. Locked kind: it neither seeds the
-- starter catalog nor can an org admin switch into or out of it; only super-admins
-- create or change handwerk orgs (see org_kinds and the organizations kind guard).
insert into public.org_kinds (kind, seeds_starter_catalog, switchable_by_org_admin)
values ('handwerk', false, false);
