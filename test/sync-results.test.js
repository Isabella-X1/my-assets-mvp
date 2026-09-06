import assert from 'node:assert/strict';
import test from 'node:test';

import { beginDataSync, canExportCompleteBackup, canExportCurrentData } from '../src/lib/sync-results.js';

test('a pending snapshot read does not delay current accounts and assets', async () => {
  const neverSettles = new Promise(() => {});
  const backend = {
    listAccounts: async () => [{ id: 'account-a' }],
    listAssets: async () => [{ id: 'asset-a' }],
    listSnapshots: () => neverSettles,
  };

  const requests = beginDataSync(backend, 'user-a');
  const result = await Promise.race([
    requests.core,
    new Promise((_, reject) => setTimeout(() => reject(new Error('core data was blocked')), 100)),
  ]);

  assert.deepEqual(result.accounts, [{ id: 'account-a' }]);
  assert.deepEqual(result.assets, [{ id: 'asset-a' }]);
});

test('snapshot failures settle separately from required portfolio data', async () => {
  const snapshotError = new Error('snapshot service unavailable');
  const backend = {
    listAccounts: async () => [],
    listAssets: async () => [],
    listSnapshots: async () => { throw snapshotError; },
  };

  const requests = beginDataSync(backend, 'user-a');
  assert.deepEqual(await requests.core, { accounts: [], assets: [] });
  assert.deepEqual(await requests.snapshots, { status: 'rejected', reason: snapshotError });
});

test('an account or asset read failure still blocks an unsafe partial portfolio', async () => {
  const accountError = new Error('accounts unavailable');
  const backend = {
    listAccounts: async () => { throw accountError; },
    listAssets: async () => [],
    listSnapshots: async () => [],
  };

  const requests = beginDataSync(backend, 'user-a');
  await assert.rejects(requests.core, accountError);
});

test('a complete backup is available only after every private dataset is current', () => {
  const current = { dataLoaded: true, dataError: null, snapshotStatus: 'ready', syncing: false };
  assert.equal(canExportCompleteBackup(current), true);
  assert.equal(canExportCompleteBackup({ ...current, snapshotStatus: 'loading' }), false);
  assert.equal(canExportCompleteBackup({ ...current, dataError: new Error('stale') }), false);
  assert.equal(canExportCompleteBackup({ ...current, dataLoaded: false }), false);
  assert.equal(canExportCompleteBackup({ ...current, syncing: true }), false);
});

test('CSV export waits for a current account and asset dataset but not snapshots', () => {
  const current = { dataLoaded: true, dataError: null, syncing: false };
  assert.equal(canExportCurrentData(current), true);
  assert.equal(canExportCurrentData({ ...current, syncing: true }), false);
  assert.equal(canExportCurrentData({ ...current, dataError: 'network failed' }), false);
  assert.equal(canExportCurrentData({ ...current, dataLoaded: false }), false);
});
