import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(
  new URL('../supabase/migrations/20260811000100_initial_schema.sql', import.meta.url),
  'utf8',
);

test('initial migration defines the four planned data tables', () => {
  for (const table of ['profiles', 'accounts', 'assets', 'asset_snapshots']) {
    assert.match(sql, new RegExp(`create table public\\.${table} \\(`));
  }
});

test('money columns use exact database numerics', () => {
  assert.match(sql, /principal numeric\(20, 2\)/);
  assert.match(sql, /current_value numeric\(20, 2\)/);
  assert.match(sql, /value numeric\(20, 2\)/);
});

test('asset schema keeps the planned relationships and database timestamps', () => {
  for (const field of [
    'account_id',
    'name',
    'type',
    'principal',
    'current_value',
    'annual_rate',
    'start_date',
    'maturity_date',
    'reminder_days',
    'notes',
    'created_at',
    'updated_at',
  ]) {
    assert.match(sql, new RegExp(`\\b${field}\\b`));
  }
  assert.match(sql, /on delete no action\s+deferrable initially deferred/);
  assert.match(sql, /assets_annual_rate_range_check[\s\S]*between 0 and 10000/);
});

test('snapshot dates follow the product calendar timezone', () => {
  assert.match(sql, /recorded_on date not null default \(timezone\('Asia\/Shanghai', now\(\)\)\)::date/);
});
