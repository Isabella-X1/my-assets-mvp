import assert from 'node:assert/strict';
import test from 'node:test';

import { CSV_COLUMNS, createAssetsCsv, createCompleteBackup } from '../src/lib/export-data.js';

test('complete JSON backup includes accounts, assets, and every snapshot', () => {
  const accounts = [{ id: 'account-1', name: '银行账户' }];
  const assets = [{ id: 'asset-1', account_id: 'account-1', name: '定期存款' }];
  const snapshots = [
    { id: 'snapshot-2', asset_id: 'asset-1', value: 1100 },
    { id: 'snapshot-1', asset_id: 'asset-1', value: 1000 },
  ];
  const backup = createCompleteBackup({
    accounts,
    assets,
    snapshots,
    exportedAt: '2030-02-03T04:05:06.000Z',
  });

  assert.deepEqual(backup, {
    exported_at: '2030-02-03T04:05:06.000Z',
    version: 1,
    accounts,
    assets,
    asset_snapshots: snapshots,
  });
});

test('empty CSV remains a valid BOM-prefixed workbook-friendly header', () => {
  assert.equal(createAssetsCsv([], []), `\uFEFF${CSV_COLUMNS.join(',')}`);
});

test('CSV preserves Chinese and quotes while neutralizing spreadsheet formulas', () => {
  const accounts = [{
    id: 'account-1',
    name: '同名账户',
    institution: '银行,上海',
    last_four: '0012',
  }];
  const assets = [{
    name: '=HYPERLINK("https://example.com")',
    type: '基金',
    account_id: 'account-1',
    principal: 1000,
    current_value: 1100,
    annual_rate: null,
    start_date: '2030-01-01',
    maturity_date: '2030-02-03',
    reminder_days: 7,
    notes: '第一行\r\n第二行,"说明"',
  }];

  const csv = createAssetsCsv(assets, accounts);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.com""\)"/);
  assert.match(csv, /"同名账户 · 银行,上海 · 尾号 0012"/);
  assert.match(csv, /"第一行\r\n第二行,""说明"""/);
  assert.match(csv, /,基金,/);
});
