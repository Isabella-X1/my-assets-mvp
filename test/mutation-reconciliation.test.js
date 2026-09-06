import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MUTATION_UNCONFIRMED,
  mutateWithReadback,
  recordMatchesExpected,
} from '../src/lib/mutation-reconciliation.js';

const timeoutError = () => Object.assign(new Error('timeout'), { code: 'DATA_REQUEST_TIMEOUT' });

const account = {
  id: 'account-a',
  owner_id: 'user-a',
  name: '工资账户',
  type: '银行账户',
  institution: null,
  last_four: '0012',
  currency: 'CNY',
  notes: null,
  is_archived: false,
};

test('a normal mutation response does not perform a readback', async () => {
  let reads = 0;
  const result = await mutateWithReadback({
    operation: 'update',
    id: account.id,
    ownerId: account.owner_id,
    expectedPayload: { name: account.name },
    write: async () => account,
    read: async () => { reads += 1; return account; },
    isContextCurrent: () => true,
  });

  assert.equal(result.value, account);
  assert.equal(result.recovered, false);
  assert.equal(reads, 0);
});

test('a timed-out create or update is confirmed only by the expected owned row', async () => {
  let writes = 0;
  let reads = 0;
  let verifying = 0;
  const result = await mutateWithReadback({
    operation: 'create',
    id: account.id,
    ownerId: account.owner_id,
    expectedPayload: {
      name: account.name,
      institution: null,
      last_four: '0012',
    },
    write: async () => { writes += 1; throw timeoutError(); },
    read: async () => { reads += 1; return account; },
    isContextCurrent: () => true,
    onVerifying: () => { verifying += 1; },
  });

  assert.equal(result.value, account);
  assert.equal(result.recovered, true);
  assert.equal(writes, 1);
  assert.equal(reads, 1);
  assert.equal(verifying, 1);
});

test('mismatched, missing, or archived rows never become false successes', async () => {
  for (const record of [
    { ...account, name: '旧名称' },
    null,
    { ...account, is_archived: true },
    { ...account, owner_id: 'user-b' },
  ]) {
    await assert.rejects(() => mutateWithReadback({
      operation: 'update',
      id: account.id,
      ownerId: account.owner_id,
      expectedPayload: { name: account.name },
      write: async () => { throw timeoutError(); },
      read: async () => record,
      isContextCurrent: () => true,
    }), (error) => error.code === MUTATION_UNCONFIRMED && /没有自动重试写入/.test(error.message));
  }
});

test('a timed-out delete is confirmed only when the known target is absent', async () => {
  const confirmed = await mutateWithReadback({
    operation: 'delete',
    id: account.id,
    ownerId: account.owner_id,
    targetKnown: true,
    write: async () => { throw timeoutError(); },
    read: async () => null,
    isContextCurrent: () => true,
  });
  assert.deepEqual(confirmed, { value: account.id, recovered: true });

  await assert.rejects(() => mutateWithReadback({
    operation: 'delete',
    id: account.id,
    ownerId: account.owner_id,
    targetKnown: true,
    write: async () => { throw timeoutError(); },
    read: async () => account,
    isContextCurrent: () => true,
  }), (error) => error.code === MUTATION_UNCONFIRMED);
});

test('readback failures remain unconfirmed while authentication failures propagate', async () => {
  await assert.rejects(() => mutateWithReadback({
    operation: 'update',
    id: account.id,
    ownerId: account.owner_id,
    expectedPayload: { name: account.name },
    write: async () => { throw timeoutError(); },
    read: async () => { throw Object.assign(new Error('read timeout'), { code: 'DATA_REQUEST_TIMEOUT' }); },
    isContextCurrent: () => true,
  }), (error) => error.code === MUTATION_UNCONFIRMED);

  const authError = Object.assign(new Error('invalid jwt'), { status: 401 });
  await assert.rejects(() => mutateWithReadback({
    operation: 'update',
    id: account.id,
    ownerId: account.owner_id,
    expectedPayload: { name: account.name },
    write: async () => { throw timeoutError(); },
    read: async () => { throw authError; },
    isContextCurrent: () => true,
  }), authError);
});

test('a stale user context cannot accept a late readback result', async () => {
  let contextChecks = 0;
  await assert.rejects(() => mutateWithReadback({
    operation: 'update',
    id: account.id,
    ownerId: account.owner_id,
    expectedPayload: { name: account.name },
    write: async () => { throw timeoutError(); },
    read: async () => account,
    isContextCurrent: () => (++contextChecks) === 1,
  }), (error) => error.code === 'DATA_REQUEST_TIMEOUT');
});

test('record matching preserves numeric, null, and leading-zero semantics', () => {
  const assetRecord = {
    id: 'asset-a',
    owner_id: 'user-a',
    is_archived: false,
    principal: 1000,
    current_value: 1200.5,
    annual_rate: 3.05,
    maturity_date: null,
    reminder_days: 7,
  };
  assert.equal(recordMatchesExpected(assetRecord, {
    id: 'asset-a',
    ownerId: 'user-a',
    expectedPayload: {
      principal: 1000,
      current_value: 1200.5,
      annual_rate: 3.05,
      maturity_date: null,
      reminder_days: 7,
    },
  }), true);
  assert.equal(recordMatchesExpected({ ...assetRecord, annual_rate: null }, {
    id: 'asset-a',
    ownerId: 'user-a',
    expectedPayload: { annual_rate: 0 },
  }), false);
});
