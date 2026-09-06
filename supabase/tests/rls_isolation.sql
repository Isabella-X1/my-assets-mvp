-- Runtime authorization smoke test for Step 4.
--
-- The entire test is transactional and rolls back, so it leaves no users or
-- financial records behind. Run against the linked project with:
--   npx supabase db query --linked --file supabase/tests/rls_isolation.sql

begin;

insert into auth.users (id, email)
values
  ('f4100000-0000-4000-8000-000000000001', 'rls-a@example.invalid'),
  ('f4100000-0000-4000-8000-000000000002', 'rls-b@example.invalid');

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'f4100000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"f4100000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

insert into public.accounts (id, name, type)
values (
  'f4200000-0000-4000-8000-000000000001',
  'RLS A account',
  '测试账户'
);

insert into public.assets (
  id,
  account_id,
  name,
  type,
  principal,
  current_value
)
values (
  'f4300000-0000-4000-8000-000000000001',
  'f4200000-0000-4000-8000-000000000001',
  'RLS A asset',
  '现金',
  100.00,
  105.00
);

do $test$
declare
  row_total integer;
begin
  select count(*) into row_total
  from public.accounts
  where id = 'f4200000-0000-4000-8000-000000000001';
  if row_total <> 1 then
    raise exception 'User A cannot read its own account';
  end if;

  select count(*) into row_total
  from public.asset_snapshots
  where asset_id = 'f4300000-0000-4000-8000-000000000001';
  if row_total <> 1 then
    raise exception 'Asset snapshot trigger did not create User A history';
  end if;
end
$test$;

select set_config(
  'request.jwt.claim.sub',
  'f4100000-0000-4000-8000-000000000002',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"f4100000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

do $test$
declare
  row_total integer;
  changed_rows integer;
begin
  select
    (select count(*) from public.profiles where id = 'f4100000-0000-4000-8000-000000000001')
    + (select count(*) from public.accounts where id = 'f4200000-0000-4000-8000-000000000001')
    + (select count(*) from public.assets where id = 'f4300000-0000-4000-8000-000000000001')
    + (select count(*) from public.asset_snapshots where asset_id = 'f4300000-0000-4000-8000-000000000001')
  into row_total;

  if row_total <> 0 then
    raise exception 'User B can read User A data';
  end if;

  update public.accounts
  set name = 'cross-user update must not happen'
  where id = 'f4200000-0000-4000-8000-000000000001';
  get diagnostics changed_rows = row_count;
  if changed_rows <> 0 then
    raise exception 'User B can update User A account';
  end if;

  delete from public.assets
  where id = 'f4300000-0000-4000-8000-000000000001';
  get diagnostics changed_rows = row_count;
  if changed_rows <> 0 then
    raise exception 'User B can delete User A asset';
  end if;

  begin
    insert into public.accounts (owner_id, name, type)
    values (
      'f4100000-0000-4000-8000-000000000001',
      'cross-user insert must fail',
      '测试账户'
    );
    raise exception 'User B can insert a row owned by User A';
  exception
    when insufficient_privilege then
      null;
  end;
end
$test$;

insert into public.accounts (id, name, type)
values (
  'f4200000-0000-4000-8000-000000000002',
  'RLS B account',
  '测试账户'
);

do $test$
declare
  actual_owner uuid;
begin
  select owner_id into actual_owner
  from public.accounts
  where id = 'f4200000-0000-4000-8000-000000000002';

  if actual_owner <> 'f4100000-0000-4000-8000-000000000002'::uuid then
    raise exception 'auth.uid() did not bind User B to its new row';
  end if;
end
$test$;

reset role;
rollback;
