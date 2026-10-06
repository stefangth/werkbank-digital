-- Org kinds as data. A kind used to be a CHECK constraint on organizations.org_kind; it is now a
-- row in public.org_kinds so a plugin can register a new kind without touching this schema.
-- Behaviour that used to be implied by the literal kind names is carried by flags:
--   seeds_starter_catalog     provision_org copies the starter catalog into a new org of this kind.
--   switchable_by_org_admin   an org admin may switch an org into or out of this kind
--                             (super-admins always may).

create table public.org_kinds (
  kind                    text primary key,
  seeds_starter_catalog   boolean not null,
  switchable_by_org_admin boolean not null
);

comment on table public.org_kinds is
  'Registry of workspace types (organizations.org_kind). Read-only for clients; rows are added by migrations.';

alter table public.org_kinds enable row level security;
create policy org_kinds_read on public.org_kinds
  for select to authenticated using (true);
-- No write policies: only migrations and service role change the registry.

insert into public.org_kinds (kind, seeds_starter_catalog, switchable_by_org_admin) values
  ('production', true, true),
  ('staffing',   true, true);

alter table public.organizations
  drop constraint organizations_org_kind_check,
  add constraint organizations_org_kind_fkey foreign key (org_kind) references public.org_kinds(kind);

comment on column public.organizations.org_kind is
  'Workspace type, a key of public.org_kinds. Drives UI vocabulary and presentation only; never data or booking behaviour.';

-- set_org_kind: validate against the registry. The switch flags are enforced by the guard
-- trigger below, so direct updates cannot bypass them. Signature and grants unchanged.
create or replace function public.set_org_kind(p_org uuid, p_kind text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_caller uuid := auth.uid();
begin
  if not public.has_org_role(v_caller, p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  if p_kind is null or not exists (select 1 from public.org_kinds where kind = p_kind) then
    raise exception 'Unknown workspace type' using errcode = '22023';
  end if;
  update public.organizations
     set org_kind = p_kind, org_kind_set_at = now()
   where id = p_org;
end;
$$;
revoke all on function public.set_org_kind(uuid, text) from public, anon;
grant execute on function public.set_org_kind(uuid, text) to authenticated, service_role;

-- provision_org: validate against the registry and seed the starter catalog only for kinds
-- that ask for it. Signature and grants unchanged from 20260914120000_org_kind.sql.
create or replace function public.provision_org(
  p_name text, p_slug text, p_admin_email text, p_role app_role default 'admin', p_org_kind text default 'production'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_token text; v_uid uuid := auth.uid(); v_seeds boolean;
begin
  if not public.is_super_admin(v_uid) then
    raise exception 'Forbidden: platform admin only' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name),'') = '' or coalesce(btrim(p_slug),'') = '' or coalesce(btrim(p_admin_email),'') = '' then
    raise exception 'name, slug and admin_email are required' using errcode = '22023';
  end if;
  select k.seeds_starter_catalog into v_seeds from public.org_kinds k where k.kind = p_org_kind;
  if not found then
    raise exception 'Unknown workspace type' using errcode = '22023';
  end if;

  insert into public.organizations (name, slug, created_by, org_kind, org_kind_set_at)
  values (btrim(p_name), lower(btrim(p_slug)), v_uid, p_org_kind, now())
  returning id into v_org;            -- duplicate slug bubbles up as 23505

  if v_seeds then
    perform public.seed_org_starter_catalog(v_org);
  end if;

  insert into public.org_invitations (org_id, email, role, invited_by)
  values (v_org, lower(btrim(p_admin_email)), p_role, v_uid)
  returning token into v_token;

  return jsonb_build_object('org_id', v_org, 'token', v_token);
end;
$$;
revoke all on function public.provision_org(text,text,text,app_role,text) from public, anon;
grant execute on function public.provision_org(text,text,text,app_role,text) to authenticated;

-- Guard: an org admin may not switch an org into or out of a kind that is not
-- switchable_by_org_admin. Super-admins and server-side callers (no auth.uid()) pass.
create or replace function public.guard_org_kind_switch()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.org_kind is distinct from old.org_kind
     and auth.uid() is not null
     and not public.is_super_admin(auth.uid())
     and exists (
       select 1 from public.org_kinds k
        where k.kind in (old.org_kind, new.org_kind) and not k.switchable_by_org_admin
     ) then
    raise exception 'Forbidden: this workspace type can only be changed by a platform admin'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger organizations_org_kind_guard
  before update of org_kind on public.organizations
  for each row execute function public.guard_org_kind_switch();
