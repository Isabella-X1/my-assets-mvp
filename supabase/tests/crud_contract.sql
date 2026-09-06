-- Step 5 database CRUD contract.
--
-- The whole script runs in one transaction and always rolls back. It creates
-- only synthetic users/records and leaves no test data behind.

begin;

insert into auth.users (id, email)
values ('f5100000-0000-4000-8000-000000000001', 'crud-owner@example.invalid');

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'f5100000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"f5100000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

-- Same-name rows must remain independent because all operations use UUIDs.
insert into public.accounts (id, name, type, currency)
values
  ('f5200000-0000-4000-8000-000000000001', '同名验收账户', '银行账户', 'CNY'),
  ('f5200000-0000-4000-8000-000000000002', '同名验收账户', '银行账户', 'CNY');

update public.accounts
set institution = '只修改第一条'
where id = 'f5200000-0000-4000-8000-000000000001';

do $test$
declare
  target_row_total integer;
  other_row_total integer;
  target_institution text;
  other_institution text;
begin
  select count(*), max(institution)
  into target_row_total, target_institution
  from public.accounts
  where id = 'f5200000-0000-4000-8000-000000000001';

  select count(*), max(institution)
  into other_row_total, other_institution
  from public.accounts
  where id = 'f5200000-0000-4000-8000-000000000002';

  if target_row_total <> 1
    or target_institution is distinct from '只修改第一条' then
    raise exception 'Target account was not updated by UUID';
  end if;

  if other_row_total <> 1
    or other_institution is distinct from null::text then
    raise exception 'Same-name account was modified accidentally';
  end if;
end
$test$;

-- This mirrors the browser adapter's idempotent create: retrying the same UUID
-- uses ON CONFLICT and must not create a duplicate row or duplicate snapshot.
insert into public.assets (
  id,
  account_id,
  name,
  type,
  principal,
  current_value,
  annual_rate,
  start_date,
  maturity_date,
  reminder_days,
  updated_at
)
values (
  'f5300000-0000-4000-8000-000000000001',
  'f5200000-0000-4000-8000-000000000001',
  '幂等验收资产',
  '现金',
  100.01,
  105.02,
  3.05,
  '2028-02-29',
  '2028-02-29',
  7,
  now() - interval '1 day'
)
on conflict (id) do update set
  account_id = excluded.account_id,
  name = excluded.name,
  type = excluded.type,
  principal = excluded.principal,
  current_value = excluded.current_value,
  annual_rate = excluded.annual_rate,
  start_date = excluded.start_date,
  maturity_date = excluded.maturity_date,
  reminder_days = excluded.reminder_days;

-- A name-only edit must refresh updated_at and must not create a value
-- snapshot. This runs before the retry below, while updated_at still has the
-- deliberately stale value supplied by the initial insert.
update public.assets
set name = '仅修改名称'
where id = 'f5300000-0000-4000-8000-000000000001';

do $test$
declare
  row_total integer;
  snapshot_total integer;
  actual_name text;
  asset_updated_at timestamptz;
begin
  select count(*), max(name), max(updated_at)
  into row_total, actual_name, asset_updated_at
  from public.assets
  where id = 'f5300000-0000-4000-8000-000000000001';

  if row_total <> 1
    or actual_name is distinct from '仅修改名称' then
    raise exception 'Name-only asset edit did not update the target row';
  end if;
  if asset_updated_at is distinct from now() then
    raise exception 'updated_at trigger did not refresh the name-only asset edit';
  end if;

  select count(*) into snapshot_total
  from public.asset_snapshots
  where asset_id = 'f5300000-0000-4000-8000-000000000001';
  if snapshot_total <> 1 then
    raise exception 'Metadata-only edit created an unexpected snapshot';
  end if;
end
$test$;

insert into public.assets (
  id,
  account_id,
  name,
  type,
  principal,
  current_value,
  annual_rate,
  start_date,
  maturity_date,
  reminder_days
)
values (
  'f5300000-0000-4000-8000-000000000001',
  'f5200000-0000-4000-8000-000000000001',
  '幂等验收资产',
  '现金',
  100.01,
  105.02,
  3.05,
  '2028-02-29',
  '2028-02-29',
  7
)
on conflict (id) do update set
  account_id = excluded.account_id,
  name = excluded.name,
  type = excluded.type,
  principal = excluded.principal,
  current_value = excluded.current_value,
  annual_rate = excluded.annual_rate,
  start_date = excluded.start_date,
  maturity_date = excluded.maturity_date,
  reminder_days = excluded.reminder_days;

do $test$
declare
  row_total integer;
  snapshot_total integer;
  actual_owner uuid;
begin
  select count(*)
  into row_total
  from public.assets
  where id = 'f5300000-0000-4000-8000-000000000001';

  select owner_id
  into actual_owner
  from public.assets
  where id = 'f5300000-0000-4000-8000-000000000001';

  if row_total <> 1 then
    raise exception 'Idempotent retry created % asset rows', row_total;
  end if;
  if actual_owner is distinct from
    'f5100000-0000-4000-8000-000000000001'::uuid then
    raise exception 'Asset owner was not bound to auth.uid()';
  end if;

  select count(*) into snapshot_total
  from public.asset_snapshots
  where asset_id = 'f5300000-0000-4000-8000-000000000001';
  if snapshot_total <> 1 then
    raise exception 'Idempotent retry created % initial snapshots', snapshot_total;
  end if;
end
$test$;

-- A value change creates exactly one additional snapshot.
update public.assets
set current_value = 110.03
where id = 'f5300000-0000-4000-8000-000000000001';

do $test$
declare
  snapshot_total integer;
  matching_value_total integer;
begin
  select count(*) into snapshot_total
  from public.asset_snapshots
  where asset_id = 'f5300000-0000-4000-8000-000000000001';
  if snapshot_total <> 2 then
    raise exception 'Value edit should produce 2 snapshots, found %', snapshot_total;
  end if;

  select count(*) into matching_value_total
  from public.asset_snapshots
  where asset_id = 'f5300000-0000-4000-8000-000000000001'
    and value = 110.03;
  if matching_value_total <> 1 then
    raise exception 'Expected one snapshot with value 110.03, found %', matching_value_total;
  end if;
end
$test$;

-- Moving an asset changes only account_id and keeps the value history count.
update public.assets
set account_id = 'f5200000-0000-4000-8000-000000000002'
where id = 'f5300000-0000-4000-8000-000000000001';

do $test$
declare
  actual_account uuid;
  snapshot_total integer;
begin
  select account_id into actual_account
  from public.assets
  where id = 'f5300000-0000-4000-8000-000000000001';
  if actual_account is distinct from
    'f5200000-0000-4000-8000-000000000002'::uuid then
    raise exception 'Asset was not moved to the target account';
  end if;

  select count(*) into snapshot_total
  from public.asset_snapshots
  where asset_id = 'f5300000-0000-4000-8000-000000000001';
  if snapshot_total <> 2 then
    raise exception 'Moving an asset changed its value history';
  end if;
end
$test$;

-- Force the deferred FK to immediate mode so the expected failure is caught
-- inside this transaction instead of at commit time.
set constraints assets_account_owner_fkey immediate;

do $test$
begin
  begin
    delete from public.accounts
    where id = 'f5200000-0000-4000-8000-000000000002';
    raise exception 'Account with an asset was deleted unexpectedly';
  exception
    when foreign_key_violation then
      null;
  end;
end
$test$;

-- Asset deletion cascades its snapshots; both accounts can then be deleted.
delete from public.assets
where id = 'f5300000-0000-4000-8000-000000000001';

do $test$
begin
  if exists (
    select 1 from public.asset_snapshots
    where asset_id = 'f5300000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Deleting an asset did not cascade its snapshots';
  end if;
end
$test$;

do $test$
declare
  deleted_accounts integer;
begin
  delete from public.accounts
  where id in (
    'f5200000-0000-4000-8000-000000000001',
    'f5200000-0000-4000-8000-000000000002'
  );
  get diagnostics deleted_accounts = row_count;

  if deleted_accounts <> 2 then
    raise exception 'Expected to delete 2 empty accounts, deleted %',
      deleted_accounts;
  end if;
end
$test$;

reset role;
rollback;

select 'crud_contract_ok' as result;
