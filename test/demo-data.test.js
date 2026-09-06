import assert from 'node:assert/strict';
import test from 'node:test';

import { createDemoBackend } from '../src/lib/demo-data.js';

test('demo backend supports isolated CRUD semantics used by the UI', async () => {
  const backend = createDemoBackend();
  const createdAccount = await backend.createAccount({
    name: '测试账户',
    type: '银行账户',
    currency: 'CNY',
    institution: null,
    last_four: null,
    notes: null,
  });

  const createdAsset = await backend.createAsset({
    account_id: createdAccount.id,
    name: '测试资产',
    type: '现金',
    principal: 100,
    current_value: 105,
    annual_rate: 5,
    start_date: null,
    maturity_date: null,
    reminder_days: 7,
    notes: null,
  });

  assert.equal((await backend.listAssets()).find((asset) => asset.id === createdAsset.id).current_value, 105);
  assert.equal((await backend.listSnapshots()).filter((snapshot) => snapshot.asset_id === createdAsset.id).length, 1);

  await backend.updateAsset(createdAsset.id, { current_value: 108 });
  assert.equal((await backend.listAssets()).find((asset) => asset.id === createdAsset.id).current_value, 108);
  assert.equal((await backend.listSnapshots()).filter((snapshot) => snapshot.asset_id === createdAsset.id).length, 2);

  await assert.rejects(() => backend.deleteAccount(createdAccount.id), /仍有资产/);
  await backend.deleteAsset(createdAsset.id);
  await backend.deleteAccount(createdAccount.id);
  assert.equal((await backend.listAccounts()).some((account) => account.id === createdAccount.id), false);
});

test('demo backends do not share mutable state', async () => {
  const first = createDemoBackend();
  const second = createDemoBackend();
  await first.createAccount({ name: '只在第一个实例', type: '银行账户' });

  assert.equal((await first.listAccounts()).length, (await second.listAccounts()).length + 1);
});

test('repeating a create with the same client UUID does not create a duplicate', async () => {
  const backend = createDemoBackend();
  const recordId = '10000000-0000-4000-8000-000000000001';
  const payload = { name: '幂等账户', type: '银行账户', currency: 'CNY' };

  await backend.createAccount(payload, 'demo-user', recordId);
  await backend.createAccount(payload, 'demo-user', recordId);

  assert.equal((await backend.listAccounts()).filter((account) => account.id === recordId).length, 1);
});

test('same-name records are updated and deleted only by UUID', async () => {
  const backend = createDemoBackend();
  const firstId = '10000000-0000-4000-8000-000000000001';
  const secondId = '10000000-0000-4000-8000-000000000002';
  const payload = { name: '同名账户', type: '银行账户', currency: 'CNY' };

  await backend.createAccount(payload, 'demo-user', firstId);
  await backend.createAccount(payload, 'demo-user', secondId);
  await backend.updateAccount(firstId, { institution: '只修改第一条' });

  const afterUpdate = await backend.listAccounts();
  assert.equal(afterUpdate.find((account) => account.id === firstId).institution, '只修改第一条');
  assert.equal(afterUpdate.find((account) => account.id === secondId).institution, undefined);

  await backend.deleteAccount(firstId);
  const afterDelete = await backend.listAccounts();
  assert.equal(afterDelete.some((account) => account.id === firstId), false);
  assert.equal(afterDelete.some((account) => account.id === secondId), true);
});
