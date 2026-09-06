import assert from 'node:assert/strict';
import test from 'node:test';

import { createMutationContextTracker } from '../src/lib/mutation-context.js';

test('a mutation result belongs only to the captured user and generation', () => {
  const tracker = createMutationContextTracker();
  const context = tracker.capture('user-a');

  assert.equal(tracker.isCurrent(context, 'user-a'), true);
  assert.equal(tracker.isCurrent(context, 'user-b'), false);
  assert.equal(tracker.isCurrent(context, null), false);
});

test('invalidating user data makes an in-flight result stale even after the same user logs in again', () => {
  const tracker = createMutationContextTracker();
  const oldContext = tracker.capture('user-a');

  tracker.invalidate();

  assert.equal(tracker.isCurrent(oldContext, 'user-a'), false);
  assert.equal(tracker.isCurrent(tracker.capture('user-a'), 'user-a'), true);
});

test('capturing a mutation without an authenticated user is rejected', () => {
  const tracker = createMutationContextTracker();
  assert.throws(() => tracker.capture(null), /登录状态已失效/);
});
