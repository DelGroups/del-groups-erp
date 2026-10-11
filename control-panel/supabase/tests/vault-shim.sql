-- Test-only stand-in for Supabase Vault (same function signatures, no encryption).
create schema if not exists vault;
create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  description text,
  secret text not null,
  updated_at timestamptz default now()
);
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id into v;
  return v;
end $$;
create or replace function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null)
returns void language plpgsql as $$
begin
  update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name),
    description = coalesce(new_description, description), updated_at = now() where id = secret_id;
end $$;
-- Supabase exposes the plain values through this view (only to privileged roles).
create or replace view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, updated_at from vault.secrets;
revoke all on schema vault from public;
