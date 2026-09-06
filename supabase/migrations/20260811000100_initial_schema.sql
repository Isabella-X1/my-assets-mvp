-- Asset-management data is private by default. Every application row is owned
-- by an auth.users record and is protected again by row-level security below.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_display_name_length_check check (
    display_name is null
    or char_length(btrim(display_name)) between 1 and 100
  )
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  name text not null,
  type text not null,
  institution text,
  last_four text,
  currency text not null default 'CNY',
  notes text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint accounts_id_owner_id_key unique (id, owner_id),
  constraint accounts_name_length_check check (
    char_length(btrim(name)) between 1 and 120
  ),
  constraint accounts_type_length_check check (
    char_length(btrim(type)) between 1 and 50
  ),
  constraint accounts_institution_length_check check (
    institution is null or char_length(btrim(institution)) between 1 and 120
  ),
  constraint accounts_last_four_check check (
    last_four is null or last_four ~ '^[0-9]{4}$'
  ),
  constraint accounts_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint accounts_notes_length_check check (
    notes is null or char_length(notes) <= 5000
  )
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  account_id uuid not null,
  name text not null,
  type text not null,
  principal numeric(20, 2) not null default 0,
  current_value numeric(20, 2) not null default 0,
  annual_rate numeric(12, 6),
  start_date date,
  maturity_date date,
  reminder_days smallint not null default 7,
  notes text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint assets_id_owner_id_key unique (id, owner_id),
  constraint assets_account_owner_fkey foreign key (account_id, owner_id)
    references public.accounts (id, owner_id)
    on delete no action
    deferrable initially deferred,
  constraint assets_name_length_check check (
    char_length(btrim(name)) between 1 and 160
  ),
  constraint assets_type_length_check check (
    char_length(btrim(type)) between 1 and 50
  ),
  constraint assets_principal_range_check check (
    principal between 0 and 1000000000000
  ),
  constraint assets_current_value_range_check check (
    current_value between 0 and 1000000000000
  ),
  constraint assets_annual_rate_range_check check (
    annual_rate is null or annual_rate between 0 and 10000
  ),
  constraint assets_date_order_check check (
    start_date is null
    or maturity_date is null
    or maturity_date >= start_date
  ),
  constraint assets_reminder_days_check check (reminder_days between 0 and 365),
  constraint assets_notes_length_check check (
    notes is null or char_length(notes) <= 5000
  )
);

create table public.asset_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  asset_id uuid not null,
  recorded_on date not null default (timezone('Asia/Shanghai', now()))::date,
  value numeric(20, 2) not null,
  principal numeric(20, 2) not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint asset_snapshots_asset_owner_fkey foreign key (asset_id, owner_id)
    references public.assets (id, owner_id)
    on delete cascade,
  constraint asset_snapshots_value_range_check check (
    value between 0 and 1000000000000
  ),
  constraint asset_snapshots_principal_range_check check (
    principal between 0 and 1000000000000
  ),
  constraint asset_snapshots_notes_length_check check (
    notes is null or char_length(notes) <= 5000
  )
);

-- Keep updated_at authoritative on the database side.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger accounts_set_updated_at
before update on public.accounts
for each row execute function public.set_updated_at();

create trigger assets_set_updated_at
before update on public.assets
for each row execute function public.set_updated_at();

create trigger asset_snapshots_set_updated_at
before update on public.asset_snapshots
for each row execute function public.set_updated_at();

-- Start the historical series automatically whenever a value is first saved
-- or its principal/current value changes. The trigger runs with the caller's
-- privileges, so the snapshot INSERT is still checked by RLS.
create or replace function public.capture_asset_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.asset_snapshots (
    owner_id,
    asset_id,
    value,
    principal
  ) values (
    new.owner_id,
    new.id,
    new.current_value,
    new.principal
  );

  return new;
end;
$$;

create trigger assets_capture_initial_snapshot
after insert on public.assets
for each row execute function public.capture_asset_snapshot();

create trigger assets_capture_changed_snapshot
after update of principal, current_value on public.assets
for each row
when (
  old.principal is distinct from new.principal
  or old.current_value is distinct from new.current_value
)
execute function public.capture_asset_snapshot();

-- Create the application profile in the same transaction as an Auth signup.
-- SECURITY DEFINER is required because Auth writes do not run as the new user.
-- An empty search_path plus fully-qualified names prevents search-path attacks.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inferred_name text;
begin
  inferred_name := nullif(
    left(
      btrim(
        coalesce(
          new.raw_user_meta_data ->> 'full_name',
          new.raw_user_meta_data ->> 'name',
          split_part(coalesce(new.email, ''), '@', 1)
        )
      ),
      100
    ),
    ''
  );

  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, inferred_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Cover any Auth users that existed before this initial migration.
insert into public.profiles (id, email, display_name, created_at, updated_at)
select
  users.id,
  users.email,
  nullif(
    left(
      btrim(
        coalesce(
          users.raw_user_meta_data ->> 'full_name',
          users.raw_user_meta_data ->> 'name',
          split_part(coalesce(users.email, ''), '@', 1)
        )
      ),
      100
    ),
    ''
  ),
  coalesce(users.created_at, now()),
  now()
from auth.users as users
on conflict (id) do nothing;

-- Index common owner-scoped list, dashboard, maturity, and history queries.
create index accounts_owner_active_updated_idx
  on public.accounts (owner_id, is_archived, updated_at desc);

create index assets_owner_account_idx
  on public.assets (owner_id, account_id);

create index assets_owner_active_updated_idx
  on public.assets (owner_id, is_archived, updated_at desc);

create index assets_owner_type_idx
  on public.assets (owner_id, type);

create index assets_owner_maturity_idx
  on public.assets (owner_id, maturity_date)
  where maturity_date is not null and is_archived = false;

create index asset_snapshots_asset_recorded_idx
  on public.asset_snapshots (asset_id, owner_id, recorded_on desc, created_at desc);

create index asset_snapshots_owner_recorded_idx
  on public.asset_snapshots (owner_id, recorded_on desc, created_at desc);

-- RLS is the authorization boundary for browser clients using the publishable
-- anon key. Policies deliberately grant no anonymous access.
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.assets enable row level security;
alter table public.asset_snapshots enable row level security;

create policy profiles_select_own
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

create policy profiles_update_own
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy profiles_delete_own
on public.profiles
for delete
to authenticated
using ((select auth.uid()) = id);

create policy accounts_select_own
on public.accounts
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy accounts_insert_own
on public.accounts
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy accounts_update_own
on public.accounts
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy accounts_delete_own
on public.accounts
for delete
to authenticated
using ((select auth.uid()) = owner_id);

create policy assets_select_own
on public.assets
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy assets_insert_own
on public.assets
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy assets_update_own
on public.assets
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy assets_delete_own
on public.assets
for delete
to authenticated
using ((select auth.uid()) = owner_id);

create policy asset_snapshots_select_own
on public.asset_snapshots
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy asset_snapshots_insert_own
on public.asset_snapshots
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy asset_snapshots_update_own
on public.asset_snapshots
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy asset_snapshots_delete_own
on public.asset_snapshots
for delete
to authenticated
using ((select auth.uid()) = owner_id);

-- Explicit grants limit the Data API surface to signed-in CRUD. RLS still
-- evaluates every granted operation. service_role is intentionally untouched.
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.accounts from anon, authenticated;
revoke all on table public.assets from anon, authenticated;
revoke all on table public.asset_snapshots from anon, authenticated;

grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.accounts to authenticated;
grant select, insert, update, delete on table public.assets to authenticated;
grant select, insert, update, delete on table public.asset_snapshots to authenticated;

-- Trigger functions are not application RPC endpoints.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.capture_asset_snapshot() from public, anon, authenticated;

comment on table public.profiles is 'Private application profile for each Supabase Auth user.';
comment on table public.accounts is 'User-owned financial account containers; store only a four-digit account suffix.';
comment on table public.assets is 'User-owned asset records. annual_rate is stored as percentage points, e.g. 3.05.';
comment on table public.asset_snapshots is 'Historical, user-owned asset value observations.';
comment on column public.assets.annual_rate is 'Annual rate in percentage points (3.05 means 3.05%).';
