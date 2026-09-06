import assert from 'node:assert/strict';
import test from 'node:test';

import { createOperationGuard, requireOnline } from '../src/lib/operation-guard.js';

test('an operation key can only be active once', () => {
  const guard = createOperationGuard();
  const token = guard.tryStart('asset:create');

  assert.ok(token);
  assert.equal(guard.tryStart('asset:create'), null);
  assert.equal(guard.isActive('asset:create'), true);

  assert.equal(guard.finish('asset:create', Symbol('wrong token')), false);
  assert.equal(guard.isActive('asset:create'), true);
  assert.equal(guard.finish('asset:create', token), true);

  assert.equal(guard.isActive('asset:create'), false);
  assert.ok(guard.tryStart('asset:create'));
});

test('different record keys can proceed independently', () => {
  const guard = createOperationGuard();
  assert.ok(guard.tryStart('asset:a'));
  assert.ok(guard.tryStart('asset:b'));
});

test('an old token cannot finish a new operation after reset', () => {
  const guard = createOperationGuard();
  const oldToken = guard.tryStart('asset:create');

  guard.reset();
  const newToken = guard.tryStart('asset:create');

  assert.ok(oldToken);
  assert.ok(newToken);
  assert.notEqual(newToken, oldToken);
  assert.equal(guard.finish('asset:create', oldToken), false);
  assert.equal(guard.isActive('asset:create'), true);
  assert.equal(guard.finish('asset:create', newToken), true);
  assert.equal(guard.isActive('asset:create'), false);
});

test('offline mutations are rejected before reaching a backend', () => {
  assert.doesNotThrow(() => requireOnline(true));
  assert.throws(() => requireOnline(false), /当前离线/);
});
