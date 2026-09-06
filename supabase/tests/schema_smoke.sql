-- Read-only structural acceptance test for the initial cloud database.
do $$
declare
  business_table_count integer;
  rls_table_count integer;
  policy_count integer;
  trigger_count integer;
  planned_asset_column_count integer;
  exact_money_column_count integer;
  deferred_account_fk_count integer;
begin
  select count(*)
  into business_table_count
  from information_schema.tables
  where table_schema = 'public'
    and table_name in ('profiles', 'accounts', 'assets', 'asset_snapshots');

  if business_table_count <> 4 then
    raise exception 'Expected 4 business tables, found %', business_table_count;
  end if;

  select count(*)
  into planned_asset_column_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'assets'
    and column_name in (
      'account_id', 'name', 'type', 'principal', 'current_value',
      'annual_rate', 'start_date', 'maturity_date', 'reminder_days',
      'notes', 'created_at', 'updated_at'
    );

  if planned_asset_column_count <> 12 then
    raise exception 'Expected 12 planned asset columns, found %', planned_asset_column_count;
  end if;

  select count(*)
  into exact_money_column_count
  from information_schema.columns
  where table_schema = 'public'
    and (
      (table_name = 'assets' and column_name in ('principal', 'current_value'))
      or (table_name = 'asset_snapshots' and column_name in ('value', 'principal'))
    )
    and data_type = 'numeric'
    and numeric_precision = 20
    and numeric_scale = 2;

  if exact_money_column_count <> 4 then
    raise exception 'Expected 4 numeric(20,2) money columns, found %', exact_money_column_count;
  end if;

  select count(*)
  into rls_table_count
  from pg_catalog.pg_tables
  where schemaname = 'public'
    and tablename in ('profiles', 'accounts', 'assets', 'asset_snapshots')
    and rowsecurity;

  if rls_table_count <> 4 then
    raise exception 'Expected RLS on 4 business tables, found %', rls_table_count;
  end if;

  select count(*)
  into policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename in ('profiles', 'accounts', 'assets', 'asset_snapshots');

  if policy_count <> 16 then
    raise exception 'Expected 16 RLS policies, found %', policy_count;
  end if;

  select count(*)
  into trigger_count
  from information_schema.triggers
  where trigger_name in (
    'on_auth_user_created',
    'profiles_set_updated_at',
    'accounts_set_updated_at',
    'assets_set_updated_at',
    'asset_snapshots_set_updated_at',
    'assets_capture_initial_snapshot',
    'assets_capture_changed_snapshot'
  );

  if trigger_count <> 7 then
    raise exception 'Expected 7 application triggers, found %', trigger_count;
  end if;

  select count(*)
  into deferred_account_fk_count
  from information_schema.table_constraints
  where constraint_schema = 'public'
    and table_name = 'assets'
    and constraint_name = 'assets_account_owner_fkey'
    and constraint_type = 'FOREIGN KEY'
    and is_deferrable = 'YES'
    and initially_deferred = 'YES';

  if deferred_account_fk_count <> 1 then
    raise exception 'Expected deferred account foreign key';
  end if;
end;
$$;

select
  'schema_ok' as result,
  4 as business_tables,
  16 as rls_policies,
  7 as application_triggers,
  'numeric(20,2)' as money_type;
