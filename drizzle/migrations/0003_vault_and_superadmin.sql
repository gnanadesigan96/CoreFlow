-- ============ superadmin role ============
-- Runs as its own statement so it commits before anything below in this
-- file references the new label (Postgres enum-value-add rule).
alter type public.app_role add value if not exists 'superadmin';

-- superadmin is a superset of admin, which is a superset of agent — every
-- existing "is_admin()"/"is_agent()" gated policy now also allows superadmin.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('admin','superadmin'))
$$;

create or replace function public.is_agent()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('agent','admin','superadmin'))
$$;

-- Strict check — true only for the superadmin role itself. Used to gate the
-- vault below and to stop a plain admin from granting/revoking superadmin.
create or replace function public.is_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'superadmin')
$$;

-- Replaces the "roles admin write" policy from 0000/0001: admins keep write
-- access to guest/agent/admin rows, but only an existing superadmin can
-- create or remove a row whose role is 'superadmin'.
drop policy if exists "roles admin write" on public.user_roles;
create policy "roles admin write" on public.user_roles for all to authenticated
  using (public.is_admin() and (role <> 'superadmin' or public.is_superadmin()))
  with check (public.is_admin() and (role <> 'superadmin' or public.is_superadmin()));

-- ============ vault: encrypted secret storage ============
-- Uses Supabase's built-in Vault (pgsodium-encrypted at rest in vault.secrets,
-- readable only through vault.decrypted_secrets). If this line errors with a
-- permissions error, enable "Vault" first under Supabase Dashboard ->
-- Database -> Extensions, then re-run the rest of this file.
create extension if not exists supabase_vault;

-- Metadata only — no value column, so even a table-level RLS bypass bug
-- could never leak a secret through this table. The encrypted value lives in
-- vault.secrets, addressed by vault_id.
create table public.app_secrets (
  key text primary key,
  description text not null default '',
  vault_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
grant select on public.app_secrets to authenticated;
grant all on public.app_secrets to service_role;
alter table public.app_secrets enable row level security;

create policy "secrets superadmin only" on public.app_secrets for select to authenticated
  using (public.is_superadmin());

-- Create or replace a secret's value. Superadmin only. The value is written
-- once and never read back through this function — the UI only ever shows
-- the key, description and last-updated metadata.
create or replace function public.vault_upsert_secret(_key text, _value text, _description text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  existing_vault_id uuid;
  existing_description text;
  new_vault_id uuid;
begin
  if not public.is_superadmin() then
    raise exception 'forbidden: superadmin only';
  end if;

  select vault_id, description into existing_vault_id, existing_description
    from public.app_secrets where key = _key;

  if existing_vault_id is not null then
    perform vault.update_secret(existing_vault_id, _value, _key, coalesce(_description, existing_description));
    update public.app_secrets
      set description = coalesce(_description, existing_description), updated_at = now(), updated_by = auth.uid()
      where key = _key;
  else
    select vault.create_secret(_value, _key, coalesce(_description, '')) into new_vault_id;
    insert into public.app_secrets (key, description, vault_id, updated_by)
      values (_key, coalesce(_description, ''), new_vault_id, auth.uid());
  end if;
end;
$$;
revoke all on function public.vault_upsert_secret(text, text, text) from public;
grant execute on function public.vault_upsert_secret(text, text, text) to authenticated;

-- Remove a secret entirely. Superadmin only.
create or replace function public.vault_delete_secret(_key text)
returns void language plpgsql security definer set search_path = public as $$
declare
  target_vault_id uuid;
begin
  if not public.is_superadmin() then
    raise exception 'forbidden: superadmin only';
  end if;

  select vault_id into target_vault_id from public.app_secrets where key = _key;
  if target_vault_id is null then
    return;
  end if;

  delete from public.app_secrets where key = _key;
  delete from vault.secrets where id = target_vault_id;
end;
$$;
revoke all on function public.vault_delete_secret(text) from public;
grant execute on function public.vault_delete_secret(text) to authenticated;

-- Internal-only decrypted read. Deliberately NOT granted to `authenticated`
-- (or even checked against is_superadmin — service_role bypasses RLS-style
-- checks anyway) so the only way to read a secret's value is from trusted
-- server code using the service-role client, never a user session.
create or replace function public.vault_read_secret(_key text)
returns text language sql stable security definer set search_path = public as $$
  select s.decrypted_secret
  from public.app_secrets a
  join vault.decrypted_secrets s on s.id = a.vault_id
  where a.key = _key
$$;
revoke all on function public.vault_read_secret(text) from public, authenticated;
grant execute on function public.vault_read_secret(text) to service_role;
