import assert from 'node:assert/strict';
import test from 'node:test';

import { mutateWithReadback } from '../src/lib/mutation-reconciliation.js';
import { createSupabaseDataBackend } from '../src/lib/supabase-data.js';

function fakeClient(...results) {
  const calls = [];
  const queue = [...results];

  return {
    calls,
    from(table) {
      calls.push(['from', table]);
      const result = queue.shift() ?? { data: null, error: null };
      const builder = {
        select(...args) {
          calls.push(['select', ...args]);
          return builder;
        },
        eq(...args) {
          calls.push(['eq', ...args]);
          return builder;
        },
        order(...args) {
          calls.push(['order', ...args]);
          return builder;
        },
        insert(...args) {
          calls.push(['insert', ...args]);
          return builder;
        },
        upsert(...args) {
          calls.push(['upsert', ...args]);
          return builder;
        },
        update(...args) {
          calls.push(['update', ...args]);
          return builder;
        },
        delete(...args) {
          calls.push(['delete', ...args]);
          return builder;
        },
        single() {
          calls.push(['single']);
          return Promise.resolve(result);
        },
        maybeSingle() {
          calls.push(['maybeSingle']);
          return Promise.resolve(result);
        },
        then(resolve, reject) {
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

test('Supabase lists are owner-scoped and numeric asset fields are normalized', async () => {
  const client = fakeClient({
    data: [{ id: 'asset-a', principal: '100.10', current_value: '105.25', annual_rate: '3.050000' }],
    error: null,
  });
  const backend = createSupabaseDataBackend(client);

  const [asset] = await backend.listAssets('user-a');

  assert.equal(asset.principal, 100.1);
  assert.equal(asset.current_value, 105.25);
  assert.equal(asset.annual_rate, 3.05);
  assert.ok(client.calls.some((call) => call[0] === 'eq' && call[1] === 'owner_id' && call[2] === 'user-a'));
  assert.ok(client.calls.some((call) => call[0] === 'eq' && call[1] === 'is_archived' && call[2] === false));
});

test('Supabase readback is scoped by UUID and owner without hiding archived rows', async () => {
  const client = fakeClient(
    { data: { id: 'account-a', owner_id: 'user-a', name: '账户', is_archived: false, created_at: '2026-08-22T00:00:00Z', updated_at: '2026-08-22T00:00:00Z' }, error: null },
    { data: { id: 'asset-a', owner_id: 'user-a', principal: '100.00', current_value: '105.25', annual_rate: '3.050000', is_archived: false, created_at: '2026-08-22T00:00:00Z', updated_at: '2026-08-23T00:00:00Z' }, error: null },
  );
  const backend = createSupabaseDataBackend(client);

  const foundAccount = await backend.getAccountById('account-a', 'user-a');
  const foundAsset = await backend.getAssetById('asset-a', 'user-a');

  assert.equal(foundAccount.id, 'account-a');
  assert.equal(foundAsset.current_value, 105.25);
  assert.equal(foundAsset.created_at, '2026-08-22T00:00:00Z');
  const selectedFields = client.calls.filter((call) => call[0] === 'select').map((call) => call[1]);
  assert.ok(selectedFields.every((fields) => fields.includes('created_at') && fields.includes('updated_at')));
  assert.equal(client.calls.filter((call) => call[0] === 'maybeSingle').length, 2);
  assert.equal(client.calls.filter((call) => call[0] === 'eq' && call[1] === 'id').length, 2);
  assert.equal(client.calls.filter((call) => call[0] === 'eq' && call[1] === 'owner_id' && call[2] === 'user-a').length, 2);
  assert.equal(client.calls.some((call) => call[0] === 'eq' && call[1] === 'is_archived'), false);
});

test('Supabase creates rows with the captured owner and ignores protected payload fields', async () => {
  const created = { id: 'account-a', owner_id: 'user-a', name: '账户' };
  const client = fakeClient({ data: created, error: null });
  const backend = createSupabaseDataBackend(client);

  assert.equal(await backend.createAccount({ name: '账户', owner_id: 'user-b', created_at: 'forged' }, 'user-a'), created);
  const insert = client.calls.find((call) => call[0] === 'insert')[1];
  assert.equal(insert.owner_id, 'user-a');
  assert.equal(insert.name, '账户');
  assert.equal(Object.hasOwn(insert, 'created_at'), false);
});

test('Supabase create uses a stable client UUID for idempotent retries', async () => {
  const recordId = '10000000-0000-4000-8000-000000000001';
  const created = { id: recordId, owner_id: 'user-a', name: '账户' };
  const client = fakeClient({ data: created, error: null });
  const backend = createSupabaseDataBackend(client);

  await backend.createAccount({ name: '账户', type: '银行账户' }, 'user-a', recordId);

  const upsert = client.calls.find((call) => call[0] === 'upsert');
  assert.equal(upsert[1].id, recordId);
  assert.equal(upsert[1].owner_id, 'user-a');
  assert.deepEqual(upsert[2], { onConflict: 'id' });
  assert.equal(client.calls.some((call) => call[0] === 'insert'), false);
});

test('Supabase updates are constrained by both UUID and owner UUID', async () => {
  const client = fakeClient({ data: { id: 'asset-a', principal: '1.00', current_value: '2.00', annual_rate: null }, error: null });
  const backend = createSupabaseDataBackend(client);

  await backend.updateAsset('asset-a', { current_value: 2 }, 'user-a');

  assert.ok(client.calls.some((call) => call[0] === 'eq' && call[1] === 'id' && call[2] === 'asset-a'));
  assert.ok(client.calls.some((call) => call[0] === 'eq' && call[1] === 'owner_id' && call[2] === 'user-a'));
});

test('Supabase delete returns the affected UUID and rejects a zero-row result', async () => {
  const client = fakeClient(
    { data: { id: 'account-a' }, error: null },
    { data: null, error: null },
  );
  const backend = createSupabaseDataBackend(client);

  assert.equal(await backend.deleteAccount('account-a', 'user-a'), 'account-a');
  await assert.rejects(() => backend.deleteAsset('missing-asset', 'user-a'), /不存在、已被删除或无权操作/);
});

test('Supabase data errors are propagated without returning a false success', async () => {
  const databaseError = Object.assign(new Error('database unavailable'), { code: '08006' });
  const client = fakeClient({ data: null, error: databaseError });
  const backend = createSupabaseDataBackend(client);

  await assert.rejects(() => backend.listAccounts('user-a'), databaseError);
});

test('a stalled Data API mutation is aborted and returns a recoverable timeout error', async () => {
  let capturedSignal;
  const builder = {
    upsert() { return builder; },
    select() { return builder; },
    single() { return builder; },
    abortSignal(signal) {
      capturedSignal = signal;
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    },
  };
  const backend = createSupabaseDataBackend(
    { from: () => builder },
    { requestTimeoutMs: 10 },
  );

  await assert.rejects(
    () => backend.createAccount({ name: '账户', type: '银行账户' }, 'user-a', 'account-a'),
    (error) => error.code === 'DATA_REQUEST_TIMEOUT' && /请先刷新核对/.test(error.message),
  );
  assert.equal(capturedSignal.aborted, true);
});

test('a lost mutation response is confirmed with one SELECT and never replayed', async () => {
  const pendingResponse = new Promise(() => {});
  const verified = {
    id: 'account-a',
    owner_id: 'user-a',
    name: '账户',
    type: '银行账户',
    is_archived: false,
    created_at: '2026-08-22T00:00:00Z',
    updated_at: '2026-08-22T00:00:00Z',
  };
  const client = fakeClient(pendingResponse, { data: verified, error: null });
  const backend = createSupabaseDataBackend(client, {
    requestTimeoutMs: 5,
    verificationTimeoutMs: 5,
  });

  const outcome = await mutateWithReadback({
    operation: 'create',
    id: verified.id,
    ownerId: verified.owner_id,
    expectedPayload: { name: verified.name, type: verified.type },
    write: () => backend.createAccount(
      { name: verified.name, type: verified.type },
      verified.owner_id,
      verified.id,
    ),
    read: () => backend.getAccountById(verified.id, verified.owner_id),
    isContextCurrent: () => true,
  });

  assert.equal(outcome.recovered, true);
  assert.equal(outcome.value, verified);
  assert.equal(outcome.value.created_at, verified.created_at);
  assert.equal(client.calls.filter((call) => call[0] === 'upsert').length, 1);
  assert.equal(client.calls.filter((call) => call[0] === 'from').length, 2);
});
