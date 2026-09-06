import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(new URL('../supabase/tests/crud_contract.sql', import.meta.url), 'utf8');

test('the database CRUD contract is transactional and rolls back all fixtures', () => {
  assert.match(sql, /^begin;/m);
  assert.match(sql, /rollback;\s*select 'crud_contract_ok' as result;\s*$/);
  assert.doesNotMatch(sql, /records_left_after_rollback/);
  assert.doesNotMatch(sql, /@example\.(com|cn)/);
});

test('the database CRUD contract covers UUID updates, idempotency, snapshots, moves, and deletion rules', () => {
  assert.match(sql, /同名验收账户/);
  assert.match(sql, /on conflict \(id\) do update/);
  assert.match(sql, /Metadata-only edit created an unexpected snapshot/);
  assert.match(sql, /asset_updated_at is distinct from now\(\)/);
  assert.match(sql, /Value edit should produce 2 snapshots/);
  assert.match(sql, /Asset was not moved to the target account/);
  assert.match(sql, /when foreign_key_violation/);
  assert.match(sql, /Deleting an asset did not cascade its snapshots/);
  assert.match(sql, /get diagnostics deleted_accounts = row_count/);
  assert.match(sql, /deleted_accounts <> 2/);
});
